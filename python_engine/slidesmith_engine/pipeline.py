"""SlideSmith geometry processing pipeline — pyffi NIF bone-weight transfer.

This module handles the programmatic physics bone introduction step that
previously required 4 manual Outfit Studio operations.  It reads the output
NIF files produced by the TypeScript converter, detects missing physics bone
weights, redistributes a proportional share of each anatomy-matched donor bone
to the new physics bones, and writes the modified NIFs in-place.

Supported NIF types
-------------------
* NiTriShape (Skyrim LE, also carried through by some port workflows): full
  bone-addition with weight redistribution and per-vertex normalisation.
* BSTriShape (Skyrim SE / Skyrim AE): detection + bone-recipe JSON output;
  BSSkin::Instance vertex-level manipulation requires the Outfit Studio
  workflow described in the generated recipe file.

Safety model
------------
All file writes go to a temporary path first.  Only a clean, round-trip
readable NIF is swapped over the original.  On any exception the original
file is left untouched.

pyffi compatibility
-------------------
pyffi 2.2.3 uses ``time.clock()`` which was removed in Python 3.8.
We patch it to ``time.perf_counter`` at module load time so pyffi can be
imported on Python 3.8–3.16 without modification.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time as _time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# pyffi compatibility shim — time.clock was removed in Python 3.8
# ---------------------------------------------------------------------------
if not hasattr(_time, "clock"):
    _time.clock = _time.perf_counter  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Anatomy helpers
# ---------------------------------------------------------------------------

_REGION_PATTERNS: list[tuple[frozenset[str], str]] = [
    (frozenset({"breast", "pectoral", "boob", "tit"}), "breast"),
    (frozenset({"belly", "stomach", "abdomen", "navel"}), "belly"),
    (frozenset({"butt", "glute", "buttock", "hip"}), "butt"),
    (frozenset({"genital", "penis", "vagina", "crotch", "groin"}), "genital"),
]

_DONOR_PATTERNS: dict[str, list[str]] = {
    "breast": ["spine2", "spine1", "spine", "chest", "clavicle"],
    "belly": ["spine1", "spine", "pelvis", "abdomen"],
    "butt": ["pelvis", "thigh"],
    "genital": ["pelvis", "groin"],
    "unknown": ["pelvis", "spine"],
}

# Per-region transfer fractions: what fraction of donor bone weight is
# redistributed to the new physics bone.  Tuned so the resulting physics
# influence is anatomically plausible without over-softening the mesh.
_TRANSFER_FRACTION_BY_REGION: dict[str, float] = {
    "breast": 0.35,   # breast/pectoral bones get 35 % of spine2/chest weight
    "belly": 0.30,    # belly/abdomen bones get 30 % of spine1/pelvis weight
    "butt": 0.25,     # butt bones get 25 % of pelvis/thigh weight
    "genital": 0.20,  # genital bones get 20 % of pelvis weight
    "unknown": 0.30,  # fallback
}

# Legacy scalar kept for the formatted message strings below.
_TRANSFER_FRACTION = 0.35


def _decode(raw: Any) -> str:
    """Decode a pyffi name field to a plain Python str."""
    if isinstance(raw, (bytes, bytearray)):
        try:
            s = raw.decode("utf-8")
        except UnicodeDecodeError:
            s = raw.decode("latin-1", errors="replace")
    else:
        s = str(raw)
    return s.strip("\x00").strip()


def _norm(raw: Any) -> str:
    return _decode(raw).lower()


def _physics_anatomy(name_lower: str) -> tuple[str, str]:
    """Return (region, side) for a physics bone name."""
    region = "unknown"
    for patterns, region_name in _REGION_PATTERNS:
        if any(p in name_lower for p in patterns):
            region = region_name
            break

    if " l " in name_lower or "npc l " in name_lower or name_lower.endswith(" l"):
        side = "left"
    elif " r " in name_lower or "npc r " in name_lower or name_lower.endswith(" r"):
        side = "right"
    else:
        side = "center"

    return region, side


def _best_donor_idx(names_lower: list[str], region: str, side: str) -> int | None:
    """Return array-index of the best donor bone for this anatomy region/side."""
    donors = _DONOR_PATTERNS.get(region, _DONOR_PATTERNS["unknown"])

    if side != "center":
        tag = " l " if side == "left" else " r "
        for donor in donors:
            for i, n in enumerate(names_lower):
                if donor in n and tag in n:
                    return i

    for donor in donors:
        for i, n in enumerate(names_lower):
            if donor in n:
                return i

    return None


# ---------------------------------------------------------------------------
# NIF block helpers
# ---------------------------------------------------------------------------

def _find_node_by_name(data: Any, target_lower: str) -> Any | None:
    """Return the first NiNode whose normalised name matches *target_lower*."""
    try:
        from pyffi.formats.nif import NifFormat

        for block in data.blocks:
            if isinstance(block, NifFormat.NiNode) and _norm(block.name) == target_lower:
                return block
    except Exception:
        pass
    return None


def _encode_name(name: str) -> bytes:
    """Return a NUL-terminated UTF-8 byte string suitable for pyffi name fields."""
    return name.encode("utf-8")


def _renormalize_vert_weights(
    skin_data: Any, vert_weights: dict[int, dict[int, float]], n_bones: int
) -> None:
    """
    Read all per-vertex weights across every bone in *skin_data* (original +
    newly added physics bones) and scale them down if any vertex total exceeds
    1.0 by more than floating-point epsilon.  This guards against rounding
    drift from multiple sequential transfer passes without inflating weights
    that are already correct.

    ``n_bones`` is the total bone count including newly added physics bones.
    ``vert_weights`` is the original-bone tracking dict (not modified here).
    """
    # Phase 1 — compute true per-vertex totals over ALL bones (original + new)
    vert_totals: dict[int, float] = {}
    for bi in range(n_bones):
        try:
            bdata = skin_data.bone_list[bi]
        except Exception:
            continue
        for j in range(int(bdata.num_vertices)):
            try:
                vw = bdata.vertex_weights[j]
                vi = int(vw.index)
                vert_totals[vi] = vert_totals.get(vi, 0.0) + float(vw.weight)
            except Exception:
                continue

    # Phase 2 — scale down only if total > 1.0 + epsilon (no inflation pass)
    for bi in range(n_bones):
        try:
            bdata = skin_data.bone_list[bi]
        except Exception:
            continue
        for j in range(int(bdata.num_vertices)):
            try:
                vw = bdata.vertex_weights[j]
                vi = int(vw.index)
                total = vert_totals.get(vi, 0.0)
                if total > 1.001:
                    vw.weight = float(vw.weight) / total
            except Exception:
                continue


# ---------------------------------------------------------------------------
# Core NiTriShape processor
# ---------------------------------------------------------------------------

def _get_or_create_physics_node(
    data: Any,
    nif_format_module: Any,
    phys_name: str,
    donor_node: Any | None,
) -> Any | None:
    """
    Return an existing NiNode for *phys_name* or create one and attach it to
    *donor_node*.  Returns None when creation fails.
    """
    existing = _find_node_by_name(data, phys_name.lower())
    if existing is not None:
        return existing

    try:
        NifFormat = nif_format_module.NifFormat
        new_node = NifFormat.NiNode()
        # pyffi NiNode name is a pyffi SizedString — assign as bytes
        new_node.name = _encode_name(phys_name)

        if donor_node is not None:
            # Copy transforms so the bone sits in the right coordinate space.
            try:
                new_node.translation.x = donor_node.translation.x
                new_node.translation.y = donor_node.translation.y
                new_node.translation.z = donor_node.translation.z
            except Exception:
                pass

        # Attach as child of the donor so the skeleton hierarchy is valid.
        if donor_node is not None:
            try:
                old_c = int(donor_node.num_children)
                donor_node.num_children = old_c + 1
                donor_node.children.update_size()
                donor_node.children[old_c] = new_node
            except Exception:
                pass  # Hierarchy attachment is nice-to-have; not required

        return new_node
    except Exception:
        return None


def _add_bone_to_shape(
    data: Any,
    nif_format_module: Any,
    shape: Any,
    phys_name: str,
    donor_node: Any | None,
    new_vert_weights: dict[int, float],
) -> bool:
    """
    Attempt to add a new physics bone entry to *shape*'s NiSkinInstance and
    NiSkinData.  Returns True on success.
    """
    try:
        skin_inst = shape.skin_instance
        skin_data = skin_inst.data

        phys_node = _get_or_create_physics_node(data, nif_format_module, phys_name, donor_node)
        if phys_node is None:
            return False

        # ---- Extend skin_instance.bones ----
        old_num = int(skin_inst.num_bones)
        skin_inst.num_bones = old_num + 1
        skin_inst.bones.update_size()
        skin_inst.bones[old_num] = phys_node

        # ---- Extend skin_data.bone_list ----
        old_bd = int(skin_data.num_bones)
        skin_data.num_bones = old_bd + 1
        skin_data.bone_list.update_size()
        new_bdata = skin_data.bone_list[old_bd]
        items = sorted(new_vert_weights.items())
        new_bdata.num_vertices = len(items)
        new_bdata.vertex_weights.update_size()
        for j, (vi, w) in enumerate(items):
            new_bdata.vertex_weights[j].index = vi
            new_bdata.vertex_weights[j].weight = w

        return True
    except Exception:
        return False


def _process_ni_tri_shape(
    data: Any,
    nif_module: Any,
    shape: Any,
    physics_bone_names: list[str],
) -> tuple[list[str], list[str], list[str]]:
    """
    Process one NiTriShape, adding any missing physics bones.
    Returns (added, skipped, errors).
    """
    added: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    try:
        skin_inst = shape.skin_instance
        if skin_inst is None or skin_inst.data is None:
            skipped.append("shape has no skin instance")
            return added, skipped, errors

        skin_data = skin_inst.data
        n_bones = int(skin_inst.num_bones)

        # Current bone names (normalised) and node references
        cur_names: list[str] = []
        cur_nodes: list[Any] = []
        for i in range(n_bones):
            bref = skin_inst.bones[i]
            cur_names.append(_norm(bref.name) if bref is not None else "")
            cur_nodes.append(bref)

        # Build per-vertex weight matrix: vi → {bone_idx → weight}
        vert_weights: dict[int, dict[int, float]] = {}
        for bi in range(n_bones):
            bdata = skin_data.bone_list[bi]
            for j in range(int(bdata.num_vertices)):
                vw = bdata.vertex_weights[j]
                vi = int(vw.index)
                w = float(vw.weight)
                if vi not in vert_weights:
                    vert_weights[vi] = {}
                vert_weights[vi][bi] = w

        for phys_name in physics_bone_names:
            phys_low = phys_name.lower()

            if phys_low in cur_names:
                skipped.append(f"{phys_name}: already present")
                continue

            region, side = _physics_anatomy(phys_low)
            donor_idx = _best_donor_idx(cur_names, region, side)
            if donor_idx is None:
                skipped.append(f"{phys_name}: no donor bone found (region={region})")
                continue

            donor_name = cur_names[donor_idx]
            frac = _TRANSFER_FRACTION_BY_REGION.get(region, _TRANSFER_FRACTION_BY_REGION["unknown"])

            # Compute vertex weights from the donor bone
            new_vw: dict[int, float] = {}
            for vi, bmap in vert_weights.items():
                donor_w = bmap.get(donor_idx, 0.0)
                if donor_w > 0.01:
                    new_vw[vi] = donor_w * frac

            if not new_vw:
                skipped.append(f"{phys_name}: donor '{donor_name}' has no vertex weights")
                continue

            # Reduce donor weights so the sum stays normalised
            for vi, transferred in new_vw.items():
                if vi in vert_weights and donor_idx in vert_weights[vi]:
                    vert_weights[vi][donor_idx] = max(
                        0.0, vert_weights[vi][donor_idx] - transferred
                    )

            # Also write back reduced donor weights to the NIF skin data
            bdata_donor = skin_data.bone_list[donor_idx]
            for j in range(int(bdata_donor.num_vertices)):
                vw = bdata_donor.vertex_weights[j]
                vi = int(vw.index)
                if vi in vert_weights and donor_idx in vert_weights[vi]:
                    vw.weight = vert_weights[vi][donor_idx]

            donor_node = cur_nodes[donor_idx] if donor_idx < len(cur_nodes) else None
            success = _add_bone_to_shape(data, nif_module, shape, phys_name, donor_node, new_vw)
            if success:
                cur_names.append(phys_low)
                cur_nodes.append(None)
                added.append(
                    f"{phys_name} ← '{donor_name}' ({len(new_vw)} verts, {frac:.0%} transfer)"
                )
            else:
                errors.append(f"{phys_name}: pyffi array write failed — manual weight painting required")

        # Post-transfer normalisation: ensure each vertex's total influence sums
        # to ≤1.0.  Floating-point drift from multiple transfers can otherwise
        # produce minor over-normalisation that causes visible skinning artefacts.
        _renormalize_vert_weights(skin_data, vert_weights, n_bones + len(added))

    except Exception as exc:
        errors.append(f"shape processing error: {exc}")

    return added, skipped, errors


# ---------------------------------------------------------------------------
# SE NIF bone-recipe helper (BSTriShape NIFs — pyffi cannot modify them)
# ---------------------------------------------------------------------------

def _build_se_bone_recipe(
    nif_path: Path,
    physics_bone_names: list[str],
) -> dict[str, Any]:
    """
    Build a machine-readable bone-weight recipe for a Skyrim SE NIF that
    cannot be modified by pyffi.  The recipe is written to a JSON file
    alongside the NIF and returned as a dict so callers can surface it in
    the pipeline report.

    The recipe describes:
    * which physics bones to add
    * the anatomically-matched donor bone for each
    * the recommended transfer fraction
    * Outfit Studio instructions for applying the weights manually
    """
    recipe_bones: list[dict[str, Any]] = []
    for phys_name in physics_bone_names:
        phys_low = phys_name.lower()
        region, side = _physics_anatomy(phys_low)
        donors = _DONOR_PATTERNS.get(region, _DONOR_PATTERNS["unknown"])
        frac = _TRANSFER_FRACTION_BY_REGION.get(region, _TRANSFER_FRACTION_BY_REGION["unknown"])
        recipe_bones.append(
            {
                "boneName": phys_name,
                "anatomyRegion": region,
                "anatomySide": side,
                "preferredDonorBones": donors,
                "transferFraction": frac,
                "outfitStudioStep": (
                    f"In Outfit Studio: select the shape, open the Bones pane, "
                    f"add '{phys_name}', then copy weights from '{donors[0]}' "
                    f"with influence {frac:.0%} and run Normalize Weights."
                ),
            }
        )

    recipe: dict[str, Any] = {
        "_comment": (
            "SlideSmith SE bone-weight recipe. "
            "pyffi does not support BSTriShape (SE/AE) NIFs. "
            "Apply these weights manually in Outfit Studio or via a "
            "Blender/pynifly automation script."
        ),
        "nifPath": str(nif_path),
        "nifFormat": "BSTriShape (Skyrim SE / AE)",
        "physicsBonesRequired": physics_bone_names,
        "boneRecipe": recipe_bones,
        "outfitStudioWorkflow": [
            "1. Open Outfit Studio and load the converted NIF as the outfit.",
            "2. Load the target reference body (e.g. 3BA body reference).",
            "3. For each bone in boneRecipe: select the shape, open Bones pane, "
            "   right-click → 'Copy Bone Weights' from the donor bone listed.",
            "4. In the Weights pane set the donor blend to the transferFraction value.",
            "5. Run Edit → Normalize Weights to ensure all vertex influences sum to 1.0.",
            "6. Export the NIF to overwrite the converted file.",
        ],
    }

    recipe_path = nif_path.parent / (nif_path.stem + "_physics_recipe.json")
    try:
        recipe_path.write_text(json.dumps(recipe, indent=2, ensure_ascii=False), encoding="utf-8")
        recipe["recipeWrittenTo"] = str(recipe_path)
    except OSError as exc:
        recipe["recipeWriteError"] = str(exc)

    return recipe


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_physics_bone_weights(
    nif_path: str | Path,
    physics_bone_names: list[str],
) -> dict[str, Any]:
    """
    Add *physics_bone_names* to the NiTriShape skin instances inside *nif_path*,
    redistributing weights from anatomically matched donor bones.

    Parameters
    ----------
    nif_path:
        Absolute path to the NIF file to process (modified in-place on success).
    physics_bone_names:
        List of Skyrim bone names to introduce (e.g. ``["NPC L Breast", "NPC R Breast"]``).

    Returns
    -------
    dict with keys:
        ``status``  – ``"pass"`` | ``"partial"`` | ``"skip"`` | ``"error"``
        ``shapes_processed``  – int
        ``bones_added``       – list[str]
        ``bones_skipped``     – list[str]
        ``errors``            – list[str]
        ``message``           – human-readable summary
    """
    nif_path = Path(nif_path)
    result: dict[str, Any] = {
        "status": "skip",
        "shapes_processed": 0,
        "bones_added": [],
        "bones_skipped": [],
        "errors": [],
        "message": "",
    }

    if not nif_path.is_file():
        result["message"] = f"NIF not found: {nif_path}"
        return result

    if not physics_bone_names:
        result["status"] = "pass"
        result["message"] = "No physics bones requested."
        return result

    try:
        import pyffi  # noqa: F401 — presence check
        from pyffi.formats import nif as nif_module
        from pyffi.formats.nif import NifFormat
    except ImportError:
        result["status"] = "skip"
        result["message"] = (
            "pyffi is not installed — physics bone weight transfer skipped. "
            "Install pyffi to enable automated NIF processing."
        )
        return result

    # ---- Read NIF ----
    try:
        data = NifFormat.Data()
        with open(nif_path, "rb") as fh:
            data.read(fh)
    except Exception as exc:
        result["status"] = "error"
        result["errors"].append(f"NIF read error: {exc}")
        result["message"] = f"Could not read NIF: {exc}"
        return result

    # ---- Detect NIF generation ----
    has_ni_tri_shape = any(isinstance(b, NifFormat.NiTriShape) for b in data.blocks)
    has_bs_tri_shape = any(
        hasattr(NifFormat, "BSTriShape") and isinstance(b, NifFormat.BSTriShape)
        for b in data.blocks
    )

    if has_bs_tri_shape and not has_ni_tri_shape:
        recipe = _build_se_bone_recipe(nif_path, physics_bone_names)
        result["status"] = "skip"
        result["message"] = (
            "Skyrim SE (BSTriShape) NIF detected — pyffi does not support SE-format "
            "skinning.  A bone-weight recipe JSON has been written alongside the NIF "
            "for use with Outfit Studio or an SE NIF scripting tool."
        )
        result["se_bone_recipe"] = recipe
        return result

    if not has_ni_tri_shape:
        result["status"] = "skip"
        result["message"] = "No NiTriShape found in NIF — nothing to process."
        return result

    # ---- Process each NiTriShape ----
    all_added: list[str] = []
    all_skipped: list[str] = []
    all_errors: list[str] = []
    shapes_hit = 0

    for block in data.blocks:
        if not isinstance(block, NifFormat.NiTriShape):
            continue
        if block.skin_instance is None:
            continue
        shapes_hit += 1
        added, skipped, errors = _process_ni_tri_shape(
            data, nif_module, block, physics_bone_names
        )
        all_added.extend(added)
        all_skipped.extend(skipped)
        all_errors.extend(errors)

    result["shapes_processed"] = shapes_hit
    result["bones_added"] = all_added
    result["bones_skipped"] = all_skipped
    result["errors"] = all_errors

    if shapes_hit == 0:
        result["status"] = "skip"
        result["message"] = "No skinned NiTriShape blocks found in NIF."
        return result

    if not all_added and not all_errors:
        result["status"] = "pass"
        result["message"] = "All requested physics bones already present."
        return result

    # ---- Write NIF to temp, verify it reads back, then replace original ----
    if all_added:
        tmp_fd, tmp_path = tempfile.mkstemp(
            suffix=".nif", dir=nif_path.parent, prefix=".slidesmith_tmp_"
        )
        try:
            os.close(tmp_fd)
            with open(tmp_path, "wb") as fh:
                data.write(fh)
            # Verify round-trip
            verify_data = NifFormat.Data()
            with open(tmp_path, "rb") as fh:
                verify_data.read(fh)
            shutil.move(tmp_path, nif_path)
        except Exception as exc:
            all_errors.append(f"NIF write/verify error: {exc}")
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    result["bones_added"] = all_added
    result["errors"] = all_errors

    if all_added and not all_errors:
        result["status"] = "pass"
        result["message"] = (
            f"Automated physics bone weight transfer complete: "
            f"{len(all_added)} bone(s) added across {shapes_hit} shape(s)."
        )
    elif all_added:
        result["status"] = "partial"
        result["message"] = (
            f"Physics bone weight transfer partially complete: "
            f"{len(all_added)} bone(s) added, {len(all_errors)} error(s)."
        )
    else:
        result["status"] = "error"
        result["message"] = (
            f"Physics bone weight transfer failed: {'; '.join(all_errors[:2])}"
        )

    return result


def _normalize_shape_skin_weights(shape: Any) -> tuple[int, int]:
    """
    Normalize per-vertex skin weights for one skinned NiTriShape.

    Returns:
        (normalized_vertex_count, clamped_weight_count)
    """
    try:
        skin_inst = shape.skin_instance
        if skin_inst is None or skin_inst.data is None:
            return (0, 0)
        skin_data = skin_inst.data
        n_bones = int(skin_data.num_bones)
    except Exception:
        return (0, 0)

    vertex_entries: dict[int, list[Any]] = {}
    vertex_totals: dict[int, float] = {}
    clamped_weights = 0

    for bi in range(n_bones):
        try:
            bone_data = skin_data.bone_list[bi]
        except Exception:
            continue
        for j in range(int(bone_data.num_vertices)):
            try:
                vw = bone_data.vertex_weights[j]
                vi = int(vw.index)
                weight = float(vw.weight)
                if weight < 0.0:
                    vw.weight = 0.0
                    weight = 0.0
                    clamped_weights += 1
                vertex_entries.setdefault(vi, []).append(vw)
                vertex_totals[vi] = vertex_totals.get(vi, 0.0) + weight
            except Exception:
                continue

    normalized_vertices = 0
    for vi, entries in vertex_entries.items():
        total = vertex_totals.get(vi, 0.0)
        if total <= 0.0 or abs(total - 1.0) <= 0.001:
            continue
        for vw in entries:
            try:
                vw.weight = float(vw.weight) / total
            except Exception:
                continue
        normalized_vertices += 1

    return (normalized_vertices, clamped_weights)


def cleanup_nif_mesh_weights(nif_path: str | Path) -> dict[str, Any]:
    """
    Apply basic mesh cleanup to one NIF:
    - clamp negative skin weights
    - normalize per-vertex skin weight totals
    """
    nif_path = Path(nif_path)
    result: dict[str, Any] = {
        "status": "skip",
        "shapes_processed": 0,
        "shapes_modified": 0,
        "vertices_normalized": 0,
        "weights_clamped": 0,
        "errors": [],
        "message": "",
    }

    if not nif_path.is_file():
        result["message"] = f"NIF not found: {nif_path}"
        return result

    try:
        import pyffi  # noqa: F401 — presence check
        from pyffi.formats.nif import NifFormat
    except ImportError:
        result["message"] = (
            "pyffi is not installed — mesh cleanup skipped. "
            "Install pyffi to enable automated NIF processing."
        )
        return result

    try:
        data = NifFormat.Data()
        with open(nif_path, "rb") as fh:
            data.read(fh)
    except Exception as exc:
        result["status"] = "error"
        result["errors"].append(f"NIF read error: {exc}")
        result["message"] = f"Could not read NIF: {exc}"
        return result

    total_shapes_processed = 0
    total_shapes_modified = 0
    total_vertices_normalized = 0
    total_weights_clamped = 0

    for block in data.blocks:
        if not isinstance(block, NifFormat.NiTriShape):
            continue
        if block.skin_instance is None or block.skin_instance.data is None:
            continue
        total_shapes_processed += 1
        normalized_vertices, clamped_weights = _normalize_shape_skin_weights(block)
        if normalized_vertices > 0 or clamped_weights > 0:
            total_shapes_modified += 1
        total_vertices_normalized += normalized_vertices
        total_weights_clamped += clamped_weights

    result["shapes_processed"] = total_shapes_processed
    result["shapes_modified"] = total_shapes_modified
    result["vertices_normalized"] = total_vertices_normalized
    result["weights_clamped"] = total_weights_clamped

    if total_shapes_processed == 0:
        result["status"] = "skip"
        result["message"] = "No skinned NiTriShape blocks found in NIF."
        return result

    if total_shapes_modified == 0:
        result["status"] = "pass"
        result["message"] = "Mesh cleanup found no weight normalization changes."
        return result

    tmp_fd, tmp_path = tempfile.mkstemp(
        suffix=".nif", dir=nif_path.parent, prefix=".slidesmith_tmp_"
    )
    try:
        os.close(tmp_fd)
        with open(tmp_path, "wb") as fh:
            data.write(fh)
        verify_data = NifFormat.Data()
        with open(tmp_path, "rb") as fh:
            verify_data.read(fh)
        shutil.move(tmp_path, nif_path)
    except Exception as exc:
        result["status"] = "error"
        result["errors"].append(f"NIF write/verify error: {exc}")
        result["message"] = f"Mesh cleanup write failed: {exc}"
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return result
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    result["status"] = "pass"
    result["message"] = (
        "Basic mesh cleanup complete: "
        f"normalized {total_vertices_normalized} vertex weight set(s), "
        f"clamped {total_weights_clamped} negative weight entr"
        f"{'y' if total_weights_clamped == 1 else 'ies'} across "
        f"{total_shapes_modified} of {total_shapes_processed} skinned shape(s)."
    )
    return result


def cleanup_meshes_for_output_dir(output_path: str | Path) -> dict[str, Any]:
    """
    Walk *output_path* for NIF files and apply basic mesh cleanup to each one.
    """
    output_path = Path(output_path)
    aggregate: dict[str, Any] = {
        "files_processed": 0,
        "files_modified": 0,
        "files_skipped": 0,
        "files_errored": 0,
        "vertices_normalized": 0,
        "weights_clamped": 0,
        "errors": [],
    }

    if not output_path.is_dir():
        aggregate["errors"].append(f"Output directory not found: {output_path}")
        return aggregate

    nif_files = list(output_path.rglob("*.nif")) + list(output_path.rglob("*.NIF"))
    for nif_file in nif_files:
        aggregate["files_processed"] += 1
        res = cleanup_nif_mesh_weights(nif_file)
        aggregate["vertices_normalized"] += int(res.get("vertices_normalized", 0))
        aggregate["weights_clamped"] += int(res.get("weights_clamped", 0))
        if res["status"] == "pass" and (
            int(res.get("shapes_modified", 0)) > 0
            or int(res.get("vertices_normalized", 0)) > 0
            or int(res.get("weights_clamped", 0)) > 0
        ):
            aggregate["files_modified"] += 1
        elif res["status"] in ("skip", "pass"):
            aggregate["files_skipped"] += 1
        elif res["status"] in ("partial", "error"):
            aggregate["files_errored"] += 1
            aggregate["errors"].extend(res.get("errors", []))

    return aggregate


def transfer_bones_for_output_dir(
    output_path: str | Path,
    physics_bone_names: list[str],
) -> dict[str, Any]:
    """
    Walk *output_path* for NIF files and apply physics bone weight transfer to
    each one.  Returns an aggregated result dict.
    """
    output_path = Path(output_path)
    aggregate: dict[str, Any] = {
        "files_processed": 0,
        "files_modified": 0,
        "files_skipped": 0,
        "files_errored": 0,
        "bones_added": [],
        "errors": [],
    }

    if not output_path.is_dir():
        aggregate["errors"].append(f"Output directory not found: {output_path}")
        return aggregate

    nif_files = list(output_path.rglob("*.nif")) + list(output_path.rglob("*.NIF"))
    for nif_file in nif_files:
        aggregate["files_processed"] += 1
        res = apply_physics_bone_weights(nif_file, physics_bone_names)
        if res["status"] == "pass" and res["bones_added"]:
            aggregate["files_modified"] += 1
            aggregate["bones_added"].extend(res["bones_added"])
        elif res["status"] in ("skip", "pass"):
            aggregate["files_skipped"] += 1
        elif res["status"] in ("partial", "error"):
            aggregate["files_errored"] += 1
            aggregate["errors"].extend(res.get("errors", []))

    return aggregate
