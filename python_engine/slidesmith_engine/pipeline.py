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


# ---------------------------------------------------------------------------
# Bone renaming (weight-transfer stage)
# ---------------------------------------------------------------------------

def remap_nif_bone_names(
    nif_path: str | Path,
    bone_remap: dict[str, str],
) -> dict[str, Any]:
    """
    Rename bones inside *nif_path* according to *bone_remap* (``{old: new}``).

    All NiNode blocks whose name matches a key are renamed, which automatically
    updates every NiSkinInstance reference that points to them.

    Returns a result dict with keys:
        ``status``          – ``"pass"`` | ``"skip"`` | ``"error"``
        ``bones_renamed``   – list[str] human-readable descriptions
        ``errors``          – list[str]
        ``message``         – human-readable summary
    """
    nif_path = Path(nif_path)
    result: dict[str, Any] = {
        "status": "skip",
        "bones_renamed": [],
        "errors": [],
        "message": "",
    }

    if not nif_path.is_file():
        result["message"] = f"NIF not found: {nif_path}"
        return result

    if not bone_remap:
        result["status"] = "pass"
        result["message"] = "No bone renaming required."
        return result

    try:
        import pyffi  # noqa: F401 — presence check
        from pyffi.formats.nif import NifFormat
    except ImportError:
        result["status"] = "skip"
        result["message"] = (
            "pyffi is not installed — bone renaming skipped. "
            "Install pyffi to enable automated NIF bone remapping."
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

    # Build a case-insensitive lookup for the remap dict.
    remap_lower: dict[str, str] = {k.lower(): v for k, v in bone_remap.items()}

    bones_renamed: list[str] = []
    for block in data.blocks:
        if not isinstance(block, NifFormat.NiNode):
            continue
        raw_name = _decode(block.name)
        target = bone_remap.get(raw_name) or remap_lower.get(raw_name.lower())
        if target is not None and target != raw_name:
            block.name = _encode_name(target)
            bones_renamed.append(f"{raw_name!r} -> {target!r}")

    result["bones_renamed"] = bones_renamed

    if not bones_renamed:
        result["status"] = "pass"
        result["message"] = "All bones already use target naming — no renaming needed."
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
        result["message"] = f"Bone renaming write failed: {exc}"
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
        f"Bone renaming complete: {len(bones_renamed)} bone(s) renamed in {nif_path.name}."
    )
    return result


def remap_bones_for_output_dir(
    output_path: str | Path,
    bone_remap: dict[str, str],
) -> dict[str, Any]:
    """
    Walk *output_path* for NIF files and apply bone name remapping to each one.
    Returns an aggregated result dict.
    """
    output_path = Path(output_path)
    aggregate: dict[str, Any] = {
        "files_processed": 0,
        "files_modified": 0,
        "files_skipped": 0,
        "files_errored": 0,
        "bones_renamed": [],
        "errors": [],
    }

    if not output_path.is_dir():
        aggregate["errors"].append(f"Output directory not found: {output_path}")
        return aggregate

    if not bone_remap:
        return aggregate

    nif_files = list(output_path.rglob("*.nif")) + list(output_path.rglob("*.NIF"))
    for nif_file in nif_files:
        aggregate["files_processed"] += 1
        res = remap_nif_bone_names(nif_file, bone_remap)
        if res["status"] == "pass" and res["bones_renamed"]:
            aggregate["files_modified"] += 1
            aggregate["bones_renamed"].extend(res["bones_renamed"])
        elif res["status"] in ("skip", "pass"):
            aggregate["files_skipped"] += 1
        elif res["status"] == "error":
            aggregate["files_errored"] += 1
            aggregate["errors"].extend(res.get("errors", []))

    return aggregate


# ---------------------------------------------------------------------------
# Corrective smoothing (corrective-smoothing stage)
# ---------------------------------------------------------------------------

# Bone name patterns (lowercased) that identify each anatomical zone.
_ZONE_BONE_PATTERNS: dict[str, list[str]] = {
    "breast-left":  ["breast l", "breast01 l", "breastroot l", "l breast", "npc lbreastroot", "pectoral l"],
    "breast-right": ["breast r", "breast01 r", "breastroot r", "r breast", "npc rbreastroot", "pectoral r"],
    "belly":        ["belly", "stomach", "abdomen", "bellyroot"],
    "butt-left":    ["butt l", "l butt", "gluteleft"],
    "butt-right":   ["butt r", "r butt", "gluteright"],
    "armpit-left":  ["clavicle l", "upperarm l", "l clavicle", "l upperarm"],
    "armpit-right": ["clavicle r", "upperarm r", "r clavicle", "r upperarm"],
    "elbow-left":   ["forearm l", "l forearm"],
    "elbow-right":  ["forearm r", "r forearm"],
    "knee-left":    ["calf l", "l calf"],
    "knee-right":   ["calf r", "r calf"],
    "crotch":       ["pelvis", "groin", "genital"],
}


def _build_vertex_neighbor_sets(shape: Any) -> dict[int, set[int]]:
    """Build a vertex -> neighbor-vertex adjacency dict from triangle data."""
    neighbors: dict[int, set[int]] = {}
    try:
        n_tris = int(shape.data.num_triangles)
        for i in range(n_tris):
            tri = shape.data.triangles[i]
            try:
                v1, v2, v3 = int(tri.v_1), int(tri.v_2), int(tri.v_3)
            except AttributeError:
                # Some pyffi versions expose the indices differently.
                try:
                    verts = [int(x) for x in tri]
                    v1, v2, v3 = verts[0], verts[1], verts[2]
                except Exception:
                    continue
            for v in (v1, v2, v3):
                if v not in neighbors:
                    neighbors[v] = set()
            neighbors[v1].update({v2, v3})
            neighbors[v2].update({v1, v3})
            neighbors[v3].update({v1, v2})
    except Exception:
        pass
    return neighbors


def smooth_nif_corrective_zones(
    nif_path: str | Path,
    active_zones: list[str],
) -> dict[str, Any]:
    """
    Apply Laplacian smoothing to vertices in the specified anatomical zones.

    Zones are identified by the bone weight patterns in ``_ZONE_BONE_PATTERNS``.
    Smoothing is applied only to NiTriShape blocks (LE format).  SE-format
    (BSTriShape) NIFs are reported as skipped.

    Parameters
    ----------
    nif_path:
        Absolute path to the NIF file to process (modified in-place on success).
    active_zones:
        Zone names from ``correctiveSmoothingZones`` that are shared between
        source and target bodies (e.g. ``["breast-left", "breast-right", ...]``).

    Returns
    -------
    dict with keys: status, shapes_processed, vertices_smoothed, errors, message
    """
    nif_path = Path(nif_path)
    result: dict[str, Any] = {
        "status": "skip",
        "shapes_processed": 0,
        "vertices_smoothed": 0,
        "errors": [],
        "message": "",
    }

    if not nif_path.is_file():
        result["message"] = f"NIF not found: {nif_path}"
        return result

    if not active_zones:
        result["status"] = "pass"
        result["message"] = "No corrective zones requested."
        return result

    try:
        import numpy as np  # noqa: F401 — guard
    except ImportError:
        result["status"] = "skip"
        result["message"] = "numpy is not installed — corrective smoothing skipped."
        return result

    try:
        import pyffi  # noqa: F401 — presence check
        from pyffi.formats.nif import NifFormat
    except ImportError:
        result["status"] = "skip"
        result["message"] = (
            "pyffi is not installed — corrective smoothing skipped. "
            "Install pyffi to enable automated NIF processing."
        )
        return result

    import numpy as np  # re-import for use below

    try:
        data = NifFormat.Data()
        with open(nif_path, "rb") as fh:
            data.read(fh)
    except Exception as exc:
        result["status"] = "error"
        result["errors"].append(f"NIF read error: {exc}")
        result["message"] = f"Could not read NIF: {exc}"
        return result

    # Build combined pattern list for all active zones.
    zone_patterns: list[str] = []
    for zone in active_zones:
        zone_patterns.extend(_ZONE_BONE_PATTERNS.get(zone, []))

    total_shapes = 0
    total_smoothed = 0

    _SMOOTH_ITERATIONS = 3
    _SMOOTH_ALPHA = 0.35

    for block in data.blocks:
        if not isinstance(block, NifFormat.NiTriShape):
            continue
        if block.skin_instance is None or block.skin_instance.data is None:
            continue

        try:
            n_verts = int(block.data.num_vertices)
        except Exception:
            continue

        if n_verts == 0:
            continue

        total_shapes += 1

        # --- Build vertex position array ---
        try:
            positions = np.zeros((n_verts, 3), dtype=np.float64)
            for i in range(n_verts):
                v = block.data.vertices[i]
                positions[i] = [float(v.x), float(v.y), float(v.z)]
        except Exception as exc:
            result["errors"].append(f"vertex read error in shape: {exc}")
            continue

        # --- Build neighbor adjacency ---
        neighbors = _build_vertex_neighbor_sets(block)
        if not neighbors:
            continue

        # --- Identify zone vertices by bone weight patterns ---
        zone_verts: set[int] = set()
        skin_inst = block.skin_instance
        skin_data = skin_inst.data
        n_bones = int(skin_inst.num_bones)
        for bi in range(n_bones):
            try:
                bone_ref = skin_inst.bones[bi]
                if bone_ref is None:
                    continue
                bone_name_lower = _norm(bone_ref.name)
                if not any(p in bone_name_lower for p in zone_patterns):
                    continue
                bdata = skin_data.bone_list[bi]
                for j in range(int(bdata.num_vertices)):
                    vw = bdata.vertex_weights[j]
                    if float(vw.weight) > 0.05:
                        vi = int(vw.index)
                        if 0 <= vi < n_verts:
                            zone_verts.add(vi)
            except Exception:
                continue

        if not zone_verts:
            continue

        # --- Laplacian smoothing ---
        smoothed = positions.copy()
        for _ in range(_SMOOTH_ITERATIONS):
            new_pos = smoothed.copy()
            for vi in zone_verts:
                nbrs = neighbors.get(vi, set())
                if not nbrs:
                    continue
                # Only blend with neighbours that are also in the zone so
                # boundary vertices pull toward the interior, not the exterior.
                interior = nbrs & zone_verts
                blend_set = interior if len(interior) >= 2 else nbrs
                nbr_mean = np.mean(smoothed[list(blend_set)], axis=0)
                new_pos[vi] = (1.0 - _SMOOTH_ALPHA) * smoothed[vi] + _SMOOTH_ALPHA * nbr_mean
            smoothed = new_pos

        # Write smoothed positions back.
        changed_count = 0
        for vi in zone_verts:
            try:
                v = block.data.vertices[vi]
                orig = positions[vi]
                smth = smoothed[vi]
                if not np.allclose(orig, smth, atol=1e-6):
                    v.x, v.y, v.z = float(smth[0]), float(smth[1]), float(smth[2])
                    changed_count += 1
            except Exception:
                continue

        total_smoothed += changed_count

    result["shapes_processed"] = total_shapes

    if total_shapes == 0:
        result["status"] = "skip"
        result["message"] = "No skinned NiTriShape blocks found in NIF."
        return result

    if total_smoothed == 0:
        result["status"] = "pass"
        result["message"] = "Corrective smoothing found no vertex adjustments needed."
        return result

    # Write NIF back.
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
        result["message"] = f"Corrective smoothing write failed: {exc}"
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
    result["vertices_smoothed"] = total_smoothed
    result["message"] = (
        f"Corrective smoothing applied {_SMOOTH_ITERATIONS} iterations to "
        f"{total_smoothed} zone vertex(ices) across {total_shapes} shape(s) "
        f"in {nif_path.name}."
    )
    return result


def smooth_zones_for_output_dir(
    output_path: str | Path,
    active_zones: list[str],
) -> dict[str, Any]:
    """
    Walk *output_path* for NIF files and apply corrective zone smoothing.
    Returns an aggregated result dict.
    """
    output_path = Path(output_path)
    aggregate: dict[str, Any] = {
        "files_processed": 0,
        "files_modified": 0,
        "files_skipped": 0,
        "files_errored": 0,
        "vertices_smoothed": 0,
        "errors": [],
    }

    if not output_path.is_dir():
        aggregate["errors"].append(f"Output directory not found: {output_path}")
        return aggregate

    if not active_zones:
        return aggregate

    nif_files = list(output_path.rglob("*.nif")) + list(output_path.rglob("*.NIF"))
    for nif_file in nif_files:
        aggregate["files_processed"] += 1
        res = smooth_nif_corrective_zones(nif_file, active_zones)
        if res["status"] == "pass":
            smoothed = int(res.get("vertices_smoothed", 0))
            if smoothed > 0:
                aggregate["files_modified"] += 1
                aggregate["vertices_smoothed"] += smoothed
            else:
                aggregate["files_skipped"] += 1
        elif res["status"] == "skip":
            aggregate["files_skipped"] += 1
        elif res["status"] == "error":
            aggregate["files_errored"] += 1
            aggregate["errors"].extend(res.get("errors", []))

    return aggregate


# ---------------------------------------------------------------------------
# Surface reprojection (surface-reprojection stage)
# ---------------------------------------------------------------------------

def reproject_surface_for_output_dir(
    output_path: str | Path,
    same_topology: bool,
    source_topology: str,
    target_topology: str,
    bone_remap: dict[str, str],
) -> dict[str, Any]:
    """
    Execute the surface-reprojection pass over all NIFs in *output_path*.

    For **same-topology** conversions the vertex coordinate space is already
    compatible; reprojection is a no-op at the geometry level, so we verify
    the output and run bone renaming as part of the pass.

    For **cross-topology** conversions true nearest-triangle reprojection
    requires reference body mesh files that are not bundled; a best-effort
    vertex-smoothing correction is applied via ``smooth_zones_for_output_dir``
    and the result is annotated with a guidance note.

    Returns a dict with keys:
        ``status``              – ``"pass"`` | ``"partial"`` | ``"skip"`` | ``"error"``
        ``same_topology``       – bool
        ``files_processed``     – int
        ``bones_renamed``       – list[str]
        ``vertices_smoothed``   – int
        ``errors``              – list[str]
        ``message``             – human-readable summary
        ``guidance``            – list[str] of actionable notes
    """
    output_path = Path(output_path)
    result: dict[str, Any] = {
        "status": "skip",
        "same_topology": same_topology,
        "files_processed": 0,
        "bones_renamed": [],
        "vertices_smoothed": 0,
        "errors": [],
        "message": "",
        "guidance": [],
    }

    if not output_path.is_dir():
        result["message"] = f"Output directory not found: {output_path}"
        return result

    nif_files = list(output_path.rglob("*.nif")) + list(output_path.rglob("*.NIF"))
    if not nif_files:
        result["status"] = "skip"
        result["message"] = "No NIF files found in output directory — reprojection skipped."
        return result

    result["files_processed"] = len(nif_files)

    if same_topology:
        # Same topology: vertex space is already correct.  Run bone renaming to
        # ensure the skeleton references the target body's bone convention.
        if bone_remap:
            remap_result = remap_bones_for_output_dir(output_path, bone_remap)
            result["bones_renamed"] = remap_result.get("bones_renamed", [])
            result["errors"].extend(remap_result.get("errors", []))

        result["status"] = "pass" if not result["errors"] else "partial"
        result["message"] = (
            f"Same-topology reprojection pass complete for {len(nif_files)} NIF(s): "
            f"vertex coordinate space is already compatible with target {target_topology!r}."
            + (
                f" Renamed {len(result['bones_renamed'])} bone(s) to target convention."
                if result["bones_renamed"]
                else ""
            )
        )
        return result

    # Cross-topology: apply corrective smoothing as a best-effort vertex
    # correction.  True nearest-triangle reprojection requires bundled
    # reference body NIFs which are not included in this distribution.
    all_zones = list(_ZONE_BONE_PATTERNS.keys())
    smooth_result = smooth_zones_for_output_dir(output_path, all_zones)
    result["vertices_smoothed"] = int(smooth_result.get("vertices_smoothed", 0))
    result["errors"].extend(smooth_result.get("errors", []))

    if bone_remap:
        remap_result = remap_bones_for_output_dir(output_path, bone_remap)
        result["bones_renamed"] = remap_result.get("bones_renamed", [])
        result["errors"].extend(remap_result.get("errors", []))

    result["guidance"] = [
        f"Cross-topology conversion ({source_topology} -> {target_topology}): "
        "full nearest-triangle vertex reprojection requires reference body NIF files. "
        "A corrective smoothing pass has been applied to reduce visible discontinuities.",
        "For best results, open the converted NIF in Outfit Studio, load the target "
        "reference body, and run 'Copy Bone Weights' + 'Normalize Weights' before export.",
    ]
    result["status"] = "partial" if not result["errors"] else "error"
    result["message"] = (
        f"Cross-topology reprojection: corrective smoothing applied to "
        f"{result['vertices_smoothed']} vertex(ices) across {len(nif_files)} NIF(s). "
        f"Manual Outfit Studio verification is recommended."
    )
    return result


# ---------------------------------------------------------------------------
# Morph/slider name remapping (morph-transfer stage)
# ---------------------------------------------------------------------------

def remap_morph_sliders_for_output_dir(
    output_path: str | Path,
    slider_remap: dict[str, str],
    morph_remap: dict[str, str],
) -> dict[str, Any]:
    """
    Walk *output_path* for OSD files and remap slider/morph names.

    Text-format OSD files (UTF-8 XML) are parsed with string replacement.
    Binary OSD files are scanned for known slider name byte-strings and
    replaced in-place using fixed-width substitution where lengths match,
    or skipped conservatively when they do not.

    Returns a dict with keys:
        ``files_processed``, ``files_modified``, ``sliders_remapped``,
        ``morphs_remapped``, ``errors``.
    """
    output_path = Path(output_path)
    aggregate: dict[str, Any] = {
        "files_processed": 0,
        "files_modified": 0,
        "sliders_remapped": 0,
        "morphs_remapped": 0,
        "errors": [],
    }

    if not output_path.is_dir():
        aggregate["errors"].append(f"Output directory not found: {output_path}")
        return aggregate

    combined_remap: dict[str, str] = {**slider_remap, **morph_remap}
    if not combined_remap:
        return aggregate

    osd_files = list(output_path.rglob("*.osd")) + list(output_path.rglob("*.OSD"))
    for osd_file in osd_files:
        aggregate["files_processed"] += 1
        sliders_hit = 0
        morphs_hit = 0
        try:
            raw = osd_file.read_bytes()
            # Heuristic: if the file decodes cleanly as UTF-8 and contains XML
            # markup it is a text-format OSD that we can safely string-replace.
            try:
                text = raw.decode("utf-8")
                is_text = "<" in text and ">" in text
            except UnicodeDecodeError:
                text = None
                is_text = False

            if is_text and text is not None:
                new_text = text
                for old_name, new_name in slider_remap.items():
                    count_before = new_text.count(old_name)
                    if count_before > 0:
                        new_text = new_text.replace(old_name, new_name)
                        sliders_hit += count_before
                for old_name, new_name in morph_remap.items():
                    count_before = new_text.count(old_name)
                    if count_before > 0:
                        new_text = new_text.replace(old_name, new_name)
                        morphs_hit += count_before
                if new_text != text:
                    osd_file.write_bytes(new_text.encode("utf-8"))
                    aggregate["files_modified"] += 1
            else:
                # Binary OSD: attempt byte-level string replacement.
                # Only replace when source and target have the same byte length
                # to avoid corrupting binary offsets/counts in the file header.
                new_raw = raw
                modified = False
                for old_name, new_name in combined_remap.items():
                    old_b = old_name.encode("utf-8")
                    new_b = new_name.encode("utf-8")
                    if old_b in new_raw and len(old_b) == len(new_b):
                        new_raw = new_raw.replace(old_b, new_b)
                        sliders_hit += raw.count(old_b)
                        modified = True
                if modified:
                    osd_file.write_bytes(new_raw)
                    aggregate["files_modified"] += 1

        except Exception as exc:
            aggregate["errors"].append(f"{osd_file.name}: {exc}")
            continue

        aggregate["sliders_remapped"] += max(0, sliders_hit)
        aggregate["morphs_remapped"] += max(0, morphs_hit)

    return aggregate
