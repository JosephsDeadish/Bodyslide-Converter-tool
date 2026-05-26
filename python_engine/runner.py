#!/usr/bin/env python3
"""SlideSmith Python core pipeline runner.

Reads one JSON request from stdin and emits NDJSON progress/complete events to stdout.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time as _time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# pyffi 2.2.3 uses time.clock() which was removed in Python 3.8.
# Patch it before pyffi is imported (via optional_import below).
if not hasattr(_time, "clock"):
    _time.clock = _time.perf_counter  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parent
DEFAULT_REF_DB_PATH = ROOT / "slidesmith_engine" / "references" / "body_reference_db.json"
REF_DB_PATH = Path(os.environ.get("SLIDESMITH_REFERENCE_DB", DEFAULT_REF_DB_PATH)).expanduser()


@dataclass(frozen=True)
class StageDef:
    stage_id: str
    title: str
    message: str


STAGES: list[StageDef] = [
    StageDef("reference-body", "Reference body mapping", "Resolving canonical topology maps."),
    StageDef(
        "surface-reprojection",
        "Surface reprojection",
        "Projecting vertices onto nearest triangle surfaces with barycentric interpolation.",
    ),
    StageDef(
        "weight-transfer",
        "Bone weight transfer",
        "Interpolating bone weights and applying smoothing filters.",
    ),
    StageDef(
        "corrective-smoothing",
        "Corrective smoothing",
        "Applying corrective smoothing to armpits, breasts/chest, crotch, elbows, and knees.",
    ),
    StageDef(
        "mesh-cleanup",
        "Mesh cleanup",
        "Rebuilding normals/tangents and validating mesh consistency.",
    ),
    StageDef(
        "physics-preservation",
        "Physics and partitions",
        "Preserving partitions and physics-specific bone chains.",
    ),
    StageDef(
        "morph-transfer",
        "Delta morph transfer",
        "Transferring slider/zap deltas relative to reference meshes.",
    ),
    StageDef(
        "tri-generation",
        "TRI generation",
        "Generating RaceMenu-compatible TRI payloads from deltas.",
    ),
    StageDef(
        "quality-gates",
        "Quality gate validation",
        "Evaluating partition, weight, morph, TRI, and physics safety gates.",
    ),
]


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def optional_import(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def load_reference_db() -> dict[str, Any]:
    return json.loads(REF_DB_PATH.read_text(encoding="utf-8"))


def is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def to_string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, str] = {}
    for key, item in value.items():
        if isinstance(key, str) and isinstance(item, str):
            output[key] = item
    return output


def paired_mappings(
    source_map: dict[str, str], target_map: dict[str, str]
) -> list[tuple[str, str, str]]:
    pairs: list[tuple[str, str, str]] = []
    for canonical_key, source_value in source_map.items():
        target_value = target_map.get(canonical_key)
        if source_value and target_value:
            pairs.append((canonical_key, source_value, target_value))
    return pairs


def normalize_body_key(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower()


def invert_adapter_profile_direction(profile: str) -> str:
    normalized = profile.strip()
    if "upgrade" in normalized and "downgrade" not in normalized:
        return normalized.replace("upgrade", "downgrade")
    if "downgrade" in normalized and "upgrade" not in normalized:
        return normalized.replace("downgrade", "upgrade")
    return normalized


def adapter_profile(db: dict[str, Any], source: Any, target: Any) -> tuple[str, str]:
    adapters = db.get("adapters", [])
    if not isinstance(adapters, list):
        return ("default", "default")

    source_key = normalize_body_key(source)
    target_key = normalize_body_key(target)
    if not source_key or not target_key:
        return ("default", "default")

    def find_profile(
        expected_source: str, expected_target: str, reverse: bool, source_label: str
    ) -> tuple[str, str] | None:
        for adapter in adapters:
            if not isinstance(adapter, dict):
                continue
            adapter_source = normalize_body_key(adapter.get("source"))
            adapter_target = normalize_body_key(adapter.get("target"))
            profile = adapter.get("profile")
            if (
                adapter_source != expected_source
                or adapter_target != expected_target
                or not is_non_empty_string(profile)
            ):
                continue
            resolved_profile = str(profile).strip()
            if reverse:
                resolved_profile = invert_adapter_profile_direction(resolved_profile)
            return (resolved_profile, source_label)
        return None

    resolution_order = [
        (source_key, target_key, False, "explicit"),
        (source_key, "*", False, "source-wildcard"),
        ("*", target_key, False, "target-wildcard"),
        ("*", "*", False, "global-wildcard"),
        (target_key, source_key, True, "reverse-explicit"),
        (target_key, "*", True, "reverse-source-wildcard"),
        ("*", source_key, True, "reverse-target-wildcard"),
    ]
    for expected_source, expected_target, reverse, source_label in resolution_order:
        found = find_profile(expected_source, expected_target, reverse, source_label)
        if found is not None:
            return found
    return ("default", "default")


def physics_enabled(metadata: Any) -> bool:
    if not isinstance(metadata, dict):
        return False
    physics_bones = metadata.get("physicsBones")
    if isinstance(physics_bones, list) and any(
        is_non_empty_string(bone) for bone in physics_bones
    ):
        return True
    physics_config = metadata.get("physicsConfig")
    if isinstance(physics_config, dict):
        return bool(
            physics_config.get("cbpcCompatible")
            or physics_config.get("hdtSmpCompatible")
            or physics_config.get("softbodySupported")
        )
    return False


def physics_naming_convention(metadata: Any) -> str:
    if not isinstance(metadata, dict):
        return ""
    physics_config = metadata.get("physicsConfig")
    if not isinstance(physics_config, dict):
        return ""
    convention = physics_config.get("boneNamingConvention")
    return convention.strip().lower() if is_non_empty_string(convention) else ""


def requires_explicit_adapter_profile(
    source_meta: Any, target_meta: Any, profile: str
) -> bool:
    if profile != "default":
        return False
    if not isinstance(source_meta, dict) or not isinstance(target_meta, dict):
        return False

    source_topology = source_meta.get("topology")
    target_topology = target_meta.get("topology")
    if source_topology != target_topology:
        return True

    source_partition = source_meta.get("partitionProfile")
    target_partition = target_meta.get("partitionProfile")
    if source_partition != target_partition:
        return True

    source_physics = physics_enabled(source_meta)
    target_physics = physics_enabled(target_meta)
    if source_physics != target_physics:
        return True

    source_naming = physics_naming_convention(source_meta)
    target_naming = physics_naming_convention(target_meta)
    if source_naming and target_naming and source_naming != target_naming:
        return True

    return False


def body_metadata_issues(body_name: Any, metadata: Any) -> list[str]:
    if not isinstance(metadata, dict):
        return [f"{body_name} body metadata is missing from the reference database."]

    missing_fields: list[str] = []
    for field_name in ("topology", "topologyReference", "canonicalVertexMap"):
        if not is_non_empty_string(metadata.get(field_name)):
            missing_fields.append(field_name)

    if not to_string_map(metadata.get("sliderMappings")):
        missing_fields.append("sliderMappings")
    if not to_string_map(metadata.get("boneMap")):
        missing_fields.append("boneMap")
    if not to_string_map(metadata.get("morphEquivalents")):
        missing_fields.append("morphEquivalents")

    if not missing_fields:
        return []

    return [f"{body_name} body metadata is missing {', '.join(missing_fields)}."]


def missing_libraries(libraries: dict[str, bool], *names: str) -> list[str]:
    return [name for name in names if not libraries.get(name, False)]


def has_nif_io_support(libraries: dict[str, bool]) -> bool:
    return libraries.get("pyffi", False)


def missing_nif_io_support(libraries: dict[str, bool]) -> list[str]:
    return [] if has_nif_io_support(libraries) else ["pyffi"]


def mapping_snapshot(req: dict[str, Any], db: dict[str, Any]) -> dict[str, Any]:
    source = req.get("sourceBodyType")
    target = req.get("targetBodyType")
    bodies = db.get("bodies", {})
    source_meta = bodies.get(source, {}) if isinstance(bodies, dict) else {}
    target_meta = bodies.get(target, {}) if isinstance(bodies, dict) else {}
    source_sliders = to_string_map(source_meta.get("sliderMappings"))
    target_sliders = to_string_map(target_meta.get("sliderMappings"))
    source_bones = to_string_map(source_meta.get("boneMap"))
    target_bones = to_string_map(target_meta.get("boneMap"))
    source_morphs = to_string_map(source_meta.get("morphEquivalents"))
    target_morphs = to_string_map(target_meta.get("morphEquivalents"))
    resolved_adapter_profile, adapter_profile_source = adapter_profile(db, source, target)
    return {
        "source": source,
        "target": target,
        "sourceMeta": source_meta,
        "targetMeta": target_meta,
        "sourceSliders": source_sliders,
        "targetSliders": target_sliders,
        "sourceBones": source_bones,
        "targetBones": target_bones,
        "sourceMorphs": source_morphs,
        "targetMorphs": target_morphs,
        "sliderPairs": paired_mappings(source_sliders, target_sliders),
        "bonePairs": paired_mappings(source_bones, target_bones),
        "morphPairs": paired_mappings(source_morphs, target_morphs),
        "adapterProfile": resolved_adapter_profile,
        "adapterProfileSource": adapter_profile_source,
    }


def _run_physics_bone_transfer(
    output_path: str,
    physics_bone_names: list[str],
    libraries: dict[str, bool],
    has_nif: bool,
) -> dict[str, Any]:
    """
    Invoke the pipeline bone-weight transfer on the output directory.
    Returns a result dict with keys: status, message, bones_added, errors.
    """
    if not physics_bone_names:
        return {"status": "pass", "message": "No physics bones to transfer.", "bones_added": [], "errors": []}

    if not has_nif_io_support(libraries):
        return {
            "status": "skip",
            "message": (
                "pyffi is not installed — physics bone weight transfer skipped. "
                "Install pyffi (pip install pyffi) to enable automated NIF processing."
            ),
            "bones_added": [],
            "errors": [],
        }

    if not has_nif:
        return {
            "status": "skip",
            "message": "No NIF files detected in output directory — physics bone transfer skipped.",
            "bones_added": [],
            "errors": [],
        }

    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — physics bone transfer skipped.",
            "bones_added": [],
            "errors": [],
        }

    try:
        from slidesmith_engine.pipeline import transfer_bones_for_output_dir

        result = transfer_bones_for_output_dir(output_path, physics_bone_names)
        modified = result.get("files_modified", 0)
        processed = result.get("files_processed", 0)
        bones_added = result.get("bones_added", [])
        errors = result.get("errors", [])

        if errors:
            return {
                "status": "partial" if modified > 0 else "error",
                "message": (
                    f"Physics bone transfer processed {processed} NIF(s), "
                    f"modified {modified}, encountered {len(errors)} error(s)."
                ),
                "bones_added": bones_added,
                "errors": errors,
            }

        return {
            "status": "pass",
            "message": (
                f"Physics bone weight transfer automated: "
                f"{modified} of {processed} NIF(s) updated with proportional weights "
                "from anatomy-matched donor bones."
            ),
            "bones_added": bones_added,
            "errors": [],
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Physics bone transfer pipeline error: {exc}",
            "bones_added": [],
            "errors": [str(exc)],
        }


def _run_mesh_cleanup(
    output_path: str,
    libraries: dict[str, bool],
    has_nif: bool,
) -> dict[str, Any]:
    """
    Invoke mesh cleanup on output NIF files.
    Returns a result dict with keys:
    status, message, files_processed, files_modified, vertices_normalized,
    weights_clamped, errors.
    """
    if not has_nif:
        return {
            "status": "skip",
            "message": "No NIF files detected in output directory — mesh cleanup skipped.",
            "files_processed": 0,
            "files_modified": 0,
            "vertices_normalized": 0,
            "weights_clamped": 0,
            "errors": [],
        }

    if not has_nif_io_support(libraries):
        return {
            "status": "skip",
            "message": (
                "pyffi is not installed — mesh cleanup skipped. "
                "Install pyffi (pip install pyffi) to enable automated NIF processing."
            ),
            "files_processed": 0,
            "files_modified": 0,
            "vertices_normalized": 0,
            "weights_clamped": 0,
            "errors": [],
        }

    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — mesh cleanup skipped.",
            "files_processed": 0,
            "files_modified": 0,
            "vertices_normalized": 0,
            "weights_clamped": 0,
            "errors": [],
        }

    try:
        from slidesmith_engine.pipeline import cleanup_meshes_for_output_dir

        result = cleanup_meshes_for_output_dir(output_path)
        processed = int(result.get("files_processed", 0))
        modified = int(result.get("files_modified", 0))
        normalized = int(result.get("vertices_normalized", 0))
        clamped = int(result.get("weights_clamped", 0))
        errors = result.get("errors", [])

        if errors:
            return {
                "status": "partial" if modified > 0 else "error",
                "message": (
                    f"Mesh cleanup processed {processed} NIF(s), "
                    f"modified {modified}, encountered {len(errors)} error(s)."
                ),
                "files_processed": processed,
                "files_modified": modified,
                "vertices_normalized": normalized,
                "weights_clamped": clamped,
                "errors": errors,
            }

        return {
            "status": "pass",
            "message": (
                f"Mesh cleanup processed {processed} NIF(s) and modified {modified}. "
                f"Normalized {normalized} vertex weight set(s) and clamped {clamped} negative weight entr"
                f"{'y' if clamped == 1 else 'ies'}."
            ),
            "files_processed": processed,
            "files_modified": modified,
            "vertices_normalized": normalized,
            "weights_clamped": clamped,
            "errors": [],
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Mesh cleanup pipeline error: {exc}",
            "files_processed": 0,
            "files_modified": 0,
            "vertices_normalized": 0,
            "weights_clamped": 0,
            "errors": [str(exc)],
        }


def _run_weight_transfer(
    output_path: str,
    bone_pairs: list[tuple[str, str, str]],
    libraries: dict[str, bool],
    has_nif: bool,
) -> dict[str, Any]:
    """
    Execute bone renaming (weight-transfer stage) over the output directory.
    *bone_pairs* is the output of ``paired_mappings(source_bones, target_bones)`` —
    a list of ``(canonical_key, source_bone_name, target_bone_name)`` tuples.
    Returns a result dict with keys: status, message, bones_renamed, errors.
    """
    if not has_nif:
        return {
            "status": "skip",
            "message": "No NIF files detected — bone weight transfer skipped.",
            "bones_renamed": [],
            "errors": [],
        }

    if not has_nif_io_support(libraries):
        return {
            "status": "skip",
            "message": (
                "pyffi is not installed — bone weight transfer skipped. "
                "Install pyffi (pip install pyffi) to enable automated NIF bone remapping."
            ),
            "bones_renamed": [],
            "errors": [],
        }

    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — bone weight transfer skipped.",
            "bones_renamed": [],
            "errors": [],
        }

    # Build a source→target rename dict from pairs (skip identity mappings).
    bone_remap = {src: tgt for _, src, tgt in bone_pairs if src != tgt}
    if not bone_remap:
        return {
            "status": "pass",
            "message": "Bone names are already aligned between source and target — no renaming needed.",
            "bones_renamed": [],
            "errors": [],
        }

    try:
        from slidesmith_engine.pipeline import remap_bones_for_output_dir

        result = remap_bones_for_output_dir(output_path, bone_remap)
        modified = int(result.get("files_modified", 0))
        processed = int(result.get("files_processed", 0))
        bones_renamed = result.get("bones_renamed", [])
        errors = result.get("errors", [])

        if errors:
            return {
                "status": "partial" if modified > 0 else "error",
                "message": (
                    f"Bone weight transfer processed {processed} NIF(s), "
                    f"modified {modified}, encountered {len(errors)} error(s)."
                ),
                "bones_renamed": bones_renamed,
                "errors": errors,
            }

        return {
            "status": "pass",
            "message": (
                f"Bone weight transfer complete: {len(bones_renamed)} bone rename(s) applied "
                f"across {modified} of {processed} NIF(s)."
            ),
            "bones_renamed": bones_renamed,
            "errors": [],
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Bone weight transfer pipeline error: {exc}",
            "bones_renamed": [],
            "errors": [str(exc)],
        }


def _run_corrective_smoothing_exec(
    output_path: str,
    shared_zones: list[str],
    libraries: dict[str, bool],
    has_nif: bool,
) -> dict[str, Any]:
    """
    Execute corrective smoothing (corrective-smoothing stage) over the output directory.
    *shared_zones* is the list of zone names common to both source and target bodies.
    Returns a result dict with keys: status, message, vertices_smoothed, errors.
    """
    if not has_nif:
        return {
            "status": "skip",
            "message": "No NIF files detected — corrective smoothing skipped.",
            "vertices_smoothed": 0,
            "errors": [],
        }

    if not has_nif_io_support(libraries):
        return {
            "status": "skip",
            "message": (
                "pyffi is not installed — corrective smoothing skipped. "
                "Install pyffi (pip install pyffi) to enable automated NIF processing."
            ),
            "vertices_smoothed": 0,
            "errors": [],
        }

    if missing_libraries(libraries, "numpy"):
        return {
            "status": "skip",
            "message": (
                "numpy is not installed — corrective smoothing skipped. "
                "Install numpy (pip install numpy) to enable zone-based Laplacian smoothing."
            ),
            "vertices_smoothed": 0,
            "errors": [],
        }

    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — corrective smoothing skipped.",
            "vertices_smoothed": 0,
            "errors": [],
        }

    if not shared_zones:
        return {
            "status": "pass",
            "message": "No shared corrective zones between source and target — smoothing not required.",
            "vertices_smoothed": 0,
            "errors": [],
        }

    try:
        from slidesmith_engine.pipeline import smooth_zones_for_output_dir

        result = smooth_zones_for_output_dir(output_path, shared_zones)
        modified = int(result.get("files_modified", 0))
        skipped = int(result.get("files_skipped", 0))
        processed = int(result.get("files_processed", 0))
        vertices_smoothed = int(result.get("vertices_smoothed", 0))
        errors = result.get("errors", [])

        if errors:
            return {
                "status": "partial" if modified > 0 else "error",
                "message": (
                    f"Corrective smoothing processed {processed} NIF(s), "
                    f"modified {modified}, skipped {skipped}, encountered {len(errors)} error(s)."
                ),
                "vertices_smoothed": vertices_smoothed,
                "errors": errors,
            }

        return {
            "status": "pass",
            "message": (
                f"Corrective smoothing applied to {vertices_smoothed} vertex(ices) "
                f"across {modified} of {processed} NIF(s) "
                f"for zone(s): {', '.join(shared_zones)}."
            ),
            "vertices_smoothed": vertices_smoothed,
            "errors": [],
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Corrective smoothing pipeline error: {exc}",
            "vertices_smoothed": 0,
            "errors": [str(exc)],
        }


def _run_surface_reprojection_exec(
    output_path: str,
    source_meta: Any,
    target_meta: Any,
    bone_pairs: list[tuple[str, str, str]],
    libraries: dict[str, bool],
    has_nif: bool,
    missing_reference_maps: list[str],
) -> dict[str, Any]:
    """
    Execute the surface-reprojection stage for the output directory.
    Returns a result dict with keys:
        status, message, same_topology, bones_renamed, vertices_smoothed,
        guidance, errors.
    """
    if not has_nif:
        return {
            "status": "skip",
            "message": "No NIF files detected — surface reprojection skipped.",
            "same_topology": False,
            "bones_renamed": [],
            "vertices_smoothed": 0,
            "guidance": [],
            "errors": [],
        }

    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — surface reprojection skipped.",
            "same_topology": False,
            "bones_renamed": [],
            "vertices_smoothed": 0,
            "guidance": [],
            "errors": [],
        }

    source_topology = source_meta.get("canonicalVertexMap", "") if isinstance(source_meta, dict) else ""
    target_topology = target_meta.get("canonicalVertexMap", "") if isinstance(target_meta, dict) else ""
    same_topology = bool(source_topology and target_topology and source_topology == target_topology)

    bone_remap = {src: tgt for _, src, tgt in bone_pairs if src != tgt}

    try:
        from slidesmith_engine.pipeline import reproject_surface_for_output_dir

        result = reproject_surface_for_output_dir(
            output_path,
            same_topology=same_topology,
            source_topology=source_topology,
            target_topology=target_topology,
            bone_remap=bone_remap,
        )

        return {
            "status": result.get("status", "skip"),
            "message": result.get("message", ""),
            "same_topology": bool(result.get("same_topology", same_topology)),
            "bones_renamed": result.get("bones_renamed", []),
            "vertices_smoothed": int(result.get("vertices_smoothed", 0)),
            "guidance": result.get("guidance", []),
            "errors": result.get("errors", []),
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Surface reprojection pipeline error: {exc}",
            "same_topology": same_topology,
            "bones_renamed": [],
            "vertices_smoothed": 0,
            "guidance": [],
            "errors": [str(exc)],
        }


def _run_morph_transfer_exec(
    output_path: str,
    slider_pairs: list[tuple[str, str, str]],
    morph_pairs: list[tuple[str, str, str]],
    libraries: dict[str, bool],
) -> dict[str, Any]:
    """
    Execute OSD slider/morph name remapping (morph-transfer stage).
    *slider_pairs* and *morph_pairs* are outputs of ``paired_mappings()`` —
    lists of ``(canonical_key, source_name, target_name)`` tuples.
    Returns a result dict with keys:
        status, message, files_processed, files_modified,
        sliders_remapped, morphs_remapped, errors.
    """
    if not output_path:
        return {
            "status": "skip",
            "message": "Output path not provided — morph transfer skipped.",
            "files_processed": 0,
            "files_modified": 0,
            "sliders_remapped": 0,
            "morphs_remapped": 0,
            "errors": [],
        }

    slider_remap = {src: tgt for _, src, tgt in slider_pairs if src != tgt}
    morph_remap = {src: tgt for _, src, tgt in morph_pairs if src != tgt}

    if not slider_remap and not morph_remap:
        return {
            "status": "pass",
            "message": "Slider and morph names are already aligned — no OSD renaming needed.",
            "files_processed": 0,
            "files_modified": 0,
            "sliders_remapped": 0,
            "morphs_remapped": 0,
            "errors": [],
        }

    try:
        from slidesmith_engine.pipeline import remap_morph_sliders_for_output_dir

        result = remap_morph_sliders_for_output_dir(output_path, slider_remap, morph_remap)
        files_processed = int(result.get("files_processed", 0))
        files_modified = int(result.get("files_modified", 0))
        sliders_remapped = int(result.get("sliders_remapped", 0))
        morphs_remapped = int(result.get("morphs_remapped", 0))
        errors = result.get("errors", [])

        if errors:
            return {
                "status": "partial" if files_modified > 0 else "error",
                "message": (
                    f"Morph transfer processed {files_processed} OSD file(s), "
                    f"modified {files_modified}, encountered {len(errors)} error(s)."
                ),
                "files_processed": files_processed,
                "files_modified": files_modified,
                "sliders_remapped": sliders_remapped,
                "morphs_remapped": morphs_remapped,
                "errors": errors,
            }

        return {
            "status": "pass",
            "message": (
                f"Morph transfer complete: {sliders_remapped} slider name(s) and "
                f"{morphs_remapped} morph name(s) remapped across "
                f"{files_modified} of {files_processed} OSD file(s)."
            ),
            "files_processed": files_processed,
            "files_modified": files_modified,
            "sliders_remapped": sliders_remapped,
            "morphs_remapped": morphs_remapped,
            "errors": [],
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Morph transfer pipeline error: {exc}",
            "files_processed": 0,
            "files_modified": 0,
            "sliders_remapped": 0,
            "morphs_remapped": 0,
            "errors": [str(exc)],
        }


def stage_status(
    stage_id: str, req: dict[str, Any], db: dict[str, Any], libraries: dict[str, bool]
) -> tuple[str, str, list[str]]:
    files: list[dict[str, str]] = req.get("files", [])
    mappings = mapping_snapshot(req, db)
    source = mappings["source"]
    target = mappings["target"]
    source_meta = mappings["sourceMeta"]
    target_meta = mappings["targetMeta"]
    source_physics = source_meta.get("physicsBones", []) if isinstance(source_meta, dict) else []
    target_physics = target_meta.get("physicsBones", []) if isinstance(target_meta, dict) else []

    extensions = [f.get("extension", "") for f in files]
    has_nif = ".nif" in extensions
    has_tri = ".tri" in extensions
    slider_assets = sum(1 for ext in extensions if ext in {".tri", ".osd", ".osp", ".xml"})
    reference_issues = body_metadata_issues(str(source), source_meta) + body_metadata_issues(
        str(target), target_meta
    )
    source_map = source_meta.get("canonicalVertexMap") if isinstance(source_meta, dict) else None
    target_map = target_meta.get("canonicalVertexMap") if isinstance(target_meta, dict) else None
    missing_reference_maps: list[str] = []
    if not is_non_empty_string(source_map):
        missing_reference_maps.append(f"Source canonical vertex map is missing for {source}.")
    if not is_non_empty_string(target_map):
        missing_reference_maps.append(f"Target canonical vertex map is missing for {target}.")

    if stage_id == "reference-body":
        if not reference_issues:
            if requires_explicit_adapter_profile(
                source_meta, target_meta, mappings["adapterProfile"]
            ):
                return (
                    "attention",
                    "Reference metadata is present, but this high-risk pair has no explicit adapter profile.",
                    [
                        f"Missing explicit adapter profile for high-risk conversion pair {source} -> {target}.",
                        "Add a body-specific adapter profile entry to body_reference_db.json adapters for reliable surface/weight/morph transfer behavior.",
                    ],
                )
            topology_source = (
                source_meta.get("topologyReference", source_meta.get("topology", "unknown"))
                if isinstance(source_meta, dict)
                else "unknown"
            )
            topology_target = (
                target_meta.get("topologyReference", target_meta.get("topology", "unknown"))
                if isinstance(target_meta, dict)
                else "unknown"
            )
            return (
                "pass",
                f"Reference mapping resolved for {source} -> {target} using adapter profile '{mappings['adapterProfile']}'.",
                [
                    f"Source topology reference: {topology_source}",
                    f"Target topology reference: {topology_target}",
                    f"Adapter profile source: {mappings.get('adapterProfileSource', 'default')}",
                    f"Source canonical vertex map: {source_map}",
                    f"Target canonical vertex map: {target_map}",
                    f"Slider mappings: {len(mappings['sliderPairs'])} shared canonical keys",
                    f"Bone mappings: {len(mappings['bonePairs'])} shared canonical keys",
                    f"Morph equivalents: {len(mappings['morphPairs'])} shared canonical keys",
                ],
            )
        return (
            "attention",
            "Reference body metadata is incomplete for this pair.",
            reference_issues
            + [
                "Populate topology, topologyReference, canonicalVertexMap, sliderMappings, boneMap, and morphEquivalents for both source and target bodies.",
                "Prefer explicit adapter profiles for high-risk cross-family conversions.",
            ],
        )

    if stage_id == "surface-reprojection":
        source_topology_str = source_meta.get("topology", "") if isinstance(source_meta, dict) else ""
        target_topology_str = target_meta.get("topology", "") if isinstance(target_meta, dict) else ""
        cross_topology = bool(
            source_topology_str and target_topology_str and source_topology_str != target_topology_str
        )
        vanilla_source = source_topology_str == "vanilla"
        output_path_str = req.get("outputPath", "")

        exec_result = _run_surface_reprojection_exec(
            output_path_str,
            source_meta,
            target_meta,
            mappings["bonePairs"],
            libraries,
            has_nif,
            missing_reference_maps,
        )

        exec_status = exec_result.get("status", "skip")
        exec_message = exec_result.get("message", "")
        exec_details: list[str] = []

        if exec_message:
            exec_details.append(exec_message)
        exec_details.extend(exec_result.get("guidance", []))
        if exec_result.get("bones_renamed"):
            exec_details.append(
                f"Bones renamed: {', '.join(exec_result['bones_renamed'][:10])}"
                + ("…" if len(exec_result["bones_renamed"]) > 10 else "")
            )
        if int(exec_result.get("vertices_smoothed", 0)) > 0:
            exec_details.append(
                f"Corrective smoothing applied to {exec_result['vertices_smoothed']} vertex(ices)."
            )
        exec_details.extend(str(e) for e in exec_result.get("errors", [])[:5])

        if vanilla_source:
            exec_details.append(
                "Vanilla topology detected: the source outfit uses Bethesda's original vertex layout. "
                "A full re-weight pass in Outfit Studio against the target reference body is required "
                "before BodySlide slider outputs will be accurate."
            )
        elif cross_topology:
            exec_details.append(
                f"Cross-topology conversion ({source_topology_str} → {target_topology_str}): "
                "verify weighting quality in Outfit Studio after conversion."
            )

        if exec_status in ("pass", "partial"):
            summary = (
                "Surface reprojection executed on mesh assets."
                if exec_status == "pass"
                else "Surface reprojection executed in partial/fallback mode."
            )
            return (exec_status, summary, exec_details or ["Reprojection pass complete."])

        if exec_status == "skip":
            attention_details: list[str] = []
            if not has_nif:
                attention_details.append("No NIF mesh detected for surface reprojection.")
                attention_details.append("Stage executed with metadata-only fallback.")
            attention_details.extend(missing_reference_maps)
            missing_libs = [
                *missing_nif_io_support(libraries),
                *missing_libraries(libraries, "numpy"),
            ]
            if missing_libs:
                attention_details.append(
                    f"Missing required Python libraries for nearest-surface reprojection: {', '.join(missing_libs)}. "
                    "Install them to enable automated NIF processing."
                )
            if vanilla_source:
                attention_details.append(
                    "Vanilla topology detected: re-weight in Outfit Studio against the target reference body."
                )
            elif cross_topology:
                attention_details.append(
                    f"Cross-topology ({source_topology_str} → {target_topology_str}): "
                    "manual weight verification in Outfit Studio is strongly recommended."
                )
            return (
                "attention",
                "Surface reprojection is running in degraded fallback mode.",
                attention_details or exec_details,
            )

        return (
            "attention",
            "Surface reprojection encountered errors.",
            exec_details or ["Check output directory and Python environment."],
        )

    if stage_id == "weight-transfer":
        bone_pairs = mappings["bonePairs"]
        output_path_str = req.get("outputPath", "")

        transfer_result = _run_weight_transfer(output_path_str, bone_pairs, libraries, has_nif)
        transfer_status = transfer_result.get("status", "skip")
        transfer_message = transfer_result.get("message", "")
        transfer_details: list[str] = []
        if transfer_message:
            transfer_details.append(transfer_message)
        if transfer_result.get("bones_renamed"):
            transfer_details.append(
                f"Bone renames applied: {', '.join(transfer_result['bones_renamed'][:10])}"
                + ("…" if len(transfer_result["bones_renamed"]) > 10 else "")
            )
        transfer_details.extend(str(e) for e in transfer_result.get("errors", [])[:5])

        if transfer_status == "pass":
            transfer_details.append(
                f"Bone-weight interpolation map contains {len(bone_pairs)} canonical bone chain(s)."
            )
            return (
                "pass",
                "Weight transfer executed: bone names remapped to target convention.",
                transfer_details,
            )

        if transfer_status == "partial":
            return (
                "attention",
                "Weight transfer partially completed — review errors.",
                transfer_details,
            )

        # skip or error: fall back to metadata-only report with guidance
        fallback_details: list[str] = list(transfer_details)
        if not has_nif:
            fallback_details.append("A NIF mesh is required for nearest-surface weight interpolation.")
        if not bone_pairs:
            fallback_details.append(
                "Populate overlapping canonical boneMap entries for both bodies to enable weight interpolation."
            )
        fallback_details.extend(missing_reference_maps)
        missing_libs = [*missing_nif_io_support(libraries)]
        if missing_libs:
            fallback_details.append(
                f"Missing Python libraries for weight transfer: {', '.join(missing_libs)}. "
                "Install pyffi to enable automated NIF bone remapping."
            )
        fallback_details.append("Bone remap quality may require manual verification.")
        return (
            "attention",
            "Weight transfer metadata is incomplete for this body pair.",
            fallback_details,
        )

    if stage_id == "corrective-smoothing":
        source_zones = source_meta.get("correctiveSmoothingZones", []) if isinstance(source_meta, dict) else []
        target_zones = target_meta.get("correctiveSmoothingZones", []) if isinstance(target_meta, dict) else []
        shared_zones = (
            sorted(set(source_zones) & set(target_zones))
            if isinstance(source_zones, list) and isinstance(target_zones, list)
            else []
        )
        unique_to_target = (
            sorted(set(target_zones) - set(source_zones))
            if isinstance(source_zones, list) and isinstance(target_zones, list)
            else []
        )
        output_path_str = req.get("outputPath", "")

        smooth_result = _run_corrective_smoothing_exec(output_path_str, shared_zones, libraries, has_nif)
        smooth_status = smooth_result.get("status", "skip")
        smooth_message = smooth_result.get("message", "")
        smooth_details: list[str] = []
        if smooth_message:
            smooth_details.append(smooth_message)
        if shared_zones:
            smooth_details.append(f"Shared corrective zones: {', '.join(shared_zones)}")
        if unique_to_target:
            smooth_details.append(
                f"Target-only zones (no source reference — smoothing skipped for these): {', '.join(unique_to_target)}"
            )
        smooth_details.extend(str(e) for e in smooth_result.get("errors", [])[:5])

        if smooth_status == "pass":
            return (
                "pass",
                f"Corrective smoothing executed for {len(shared_zones)} shared zone(s).",
                smooth_details or ["All smoothing zones resolved."],
            )

        if smooth_status == "partial":
            return (
                "attention",
                "Corrective smoothing partially completed — review errors.",
                smooth_details,
            )

        # skip/error: fall back to metadata report with guidance
        fallback_details: list[str] = list(smooth_details)
        if not has_nif:
            fallback_details.append(
                "Corrective smoothing skipped because no NIF mesh was found. "
                "Armpit, breast/chest, crotch, elbow, and knee zones could not be evaluated."
            )
        missing_libs = missing_libraries(libraries, "numpy")
        if missing_libs:
            fallback_details.append(
                f"Missing Python libraries for corrective smoothing: {', '.join(missing_libs)}. "
                "Install numpy (pip install numpy) to enable zone-based Laplacian smoothing."
            )
        if not shared_zones:
            fallback_details.append(
                "Populate correctiveSmoothingZones in body_reference_db.json for both source and target bodies."
            )
        return (
            "attention",
            "Corrective smoothing is running in fallback mode.",
            fallback_details or ["Corrective smoothing could not be applied."],
        )

    if stage_id == "mesh-cleanup":
        advanced_cleanup_libraries = missing_libraries(libraries, "trimesh", "pyvista")
        output_path_str = req.get("outputPath", "")
        cleanup_result = _run_mesh_cleanup(output_path_str, libraries, has_nif)
        details: list[str] = [cleanup_result["message"], "Mesh validation checks queued."]

        if advanced_cleanup_libraries:
            details.append(
                "Advanced normals/tangents cleanup checks are unavailable: "
                f"{', '.join(advanced_cleanup_libraries)} missing."
            )

        if cleanup_result["errors"]:
            details.extend(str(error) for error in cleanup_result["errors"][:5])

        if cleanup_result["status"] == "pass":
            if advanced_cleanup_libraries:
                return (
                    "attention",
                    "Basic mesh cleanup executed; advanced cleanup features are unavailable.",
                    details,
                )
            return ("pass", "Mesh cleanup executed on output NIF assets.", details)

        return (
            "attention",
            "Mesh cleanup is running in compatibility mode.",
            details,
        )

    if stage_id == "physics-preservation":
        source_bones = len(source_physics) if isinstance(source_physics, list) else 0
        target_bones = len(target_physics) if isinstance(target_physics, list) else 0
        if source_bones == 0 and target_bones == 0:
            return (
                "pass",
                "Physics preservation is not required for this body pair.",
                [
                    "No physics chains detected in metadata.",
                    "Both source and target are static (non-physics) bodies — no CBPC/HDT-SMP config generation needed.",
                ],
            )
        # Physics introduction: source has no physics bones, target requires them.
        if source_bones == 0 and target_bones > 0:
            target_physics_names = [b for b in target_physics if isinstance(b, str) and b]
            target_cfg = target_meta.get("physicsConfig") if isinstance(target_meta, dict) else None
            cbpc_compat = isinstance(target_cfg, dict) and bool(target_cfg.get("cbpcCompatible"))
            hdt_compat = isinstance(target_cfg, dict) and bool(target_cfg.get("hdtSmpCompatible"))
            softbody = isinstance(target_cfg, dict) and bool(target_cfg.get("softbodySupported"))
            physics_systems = ", ".join(
                s for s, flag in [("CBPC", cbpc_compat), ("HDT-SMP", hdt_compat)] if flag
            )
            has_genital_bones = any("genital" in b.lower() for b in target_physics_names)
            has_pectoral_bones = any("pectoral" in b.lower() for b in target_physics_names)
            has_breast_bones = any("breast" in b.lower() for b in target_physics_names)
            has_belly_bones = any("belly" in b.lower() for b in target_physics_names)
            bone_naming = target_cfg.get("boneNamingConvention") if isinstance(target_cfg, dict) else None

            # --- Attempt automated physics bone weight transfer via pipeline ---
            output_path_str = req.get("outputPath", "")
            transfer_result = _run_physics_bone_transfer(
                output_path_str, target_physics_names, libraries, has_nif
            )

            partition_notes: list[str] = []
            if has_genital_bones:
                partition_notes.append(
                    "Partition note: SOS physics requires partition slot SBP 52 (Pelvis) to be clean. "
                    "Verify no extra partition slots overlap the genital region before exporting."
                )
            if has_pectoral_bones:
                partition_notes.append(
                    "Partition note: Male pectoral physics (NPC L/R Pectoral) are HDT-SMP only — "
                    "no CBPC .ini entry is needed for pectoral bones. "
                    "Ensure the HDT-SMP XML stub lists 'NPC L Pectoral' and 'NPC R Pectoral'."
                )
            if has_breast_bones and has_belly_bones:
                partition_notes.append(
                    "Partition note: Female breast+belly physics require NiSkinData partitions for "
                    "each physics bone group. For softbody targets, ensure the NIF has a separate "
                    "NiSkinData partition per bone (not merged)."
                )
            if physics_systems:
                partition_notes.append(
                    f"Target physics systems: {physics_systems}. "
                    "CBPC .ini and/or HDT-SMP XML stubs are synthesized automatically at conversion time."
                )
            if softbody:
                partition_notes.append(
                    "Target supports softbody (per-vertex HDT-SMP deformation): "
                    "an HDT-SMP XML config with per-vertex skin data is required for full softbody output. "
                    "The synthesized stub is a starting point — fine-tune per-vertex weights as needed."
                )
            if bone_naming:
                partition_notes.append(f"Target bone naming convention: {bone_naming}")

            if transfer_result["status"] == "pass":
                intro_details = [
                    f"Automated physics bone weight transfer completed: "
                    f"{target_bones} bone(s) introduced for {target}.",
                    f"Physics bones added: {', '.join(target_physics_names)}",
                    transfer_result["message"],
                    *[f"  \u2713 {b}" for b in transfer_result.get("bones_added", [])],
                    *partition_notes,
                ]
                return (
                    "pass",
                    f"Physics bone introduction automated: {target_bones} bone(s) transferred to output NIF(s).",
                    intro_details,
                )

            if transfer_result["status"] == "partial":
                intro_details = [
                    f"Physics bone transfer partially completed for {target}.",
                    f"Physics bones requested: {', '.join(target_physics_names)}",
                    transfer_result["message"],
                    *[f"  \u2713 {b}" for b in transfer_result.get("bones_added", [])],
                    *[f"  \u2717 {e}" for e in transfer_result.get("errors", [])],
                    *partition_notes,
                ]
                return (
                    "attention",
                    f"Physics bone introduction partially automated: review errors above.",
                    intro_details,
                )

            # Transfer was skipped (no pyffi, SE NIF, etc.) or failed
            intro_details = [
                f"Target body requires {target_bones} physics bone(s) absent from the source mesh.",
                f"Physics bones to add: {', '.join(target_physics_names)}",
                transfer_result["message"],
                *partition_notes,
                "A physics metadata repair scaffold (physics-metadata-template.json) with pre-filled "
                "bone names has been written to _SlideSmith/repairs/ for reference.",
            ]
            return (
                "attention",
                f"Physics bone introduction required: {target_bones} bone(s) need weight assignment.",
                intro_details,
            )
        required_libraries = missing_nif_io_support(libraries)
        if not has_nif:
            return (
                "attention",
                "Physics metadata is present but no NIF mesh was found for preservation.",
                [f"Source physics bones: {source_bones}", f"Target physics bones: {target_bones}"],
            )
        if required_libraries:
            return (
                "attention",
                "Physics metadata is present but NIF IO support is unavailable.",
                [
                    f"Missing required Python libraries for physics preservation: {', '.join(required_libraries)}.",
                    f"Source physics bones: {source_bones}",
                    f"Target physics bones: {target_bones}",
                ],
            )
        bone_map_values = set(mappings["targetBones"].values())
        unresolved = [
            bone
            for bone in target_physics
            if isinstance(bone, str) and bone and bone not in bone_map_values
        ]
        if unresolved:
            return (
                "attention",
                "Physics metadata is present but target boneMap coverage is incomplete.",
                [
                    f"Missing physics entries in target boneMap: {', '.join(unresolved)}",
                    f"Source physics bones: {source_bones}",
                    f"Target physics bones: {target_bones}",
                ],
            )

        # Build informational detail lines from physicsConfig if present.
        detail_lines: list[str] = [
            f"Source physics bones: {source_bones}",
            f"Target physics bones: {target_bones}",
        ]
        source_cfg = source_meta.get("physicsConfig") if isinstance(source_meta, dict) else None
        target_cfg = target_meta.get("physicsConfig") if isinstance(target_meta, dict) else None

        def physics_config_summary(cfg: Any, label: str) -> list[str]:
            if not isinstance(cfg, dict):
                return []
            lines: list[str] = []
            level = cfg.get("physicsLevel")
            convention = cfg.get("boneNamingConvention")
            cbpc = cfg.get("cbpcCompatible")
            hdt = cfg.get("hdtSmpCompatible")
            softbody = cfg.get("softbodySupported")
            if level:
                lines.append(f"{label} physics level: {level}")
            if convention:
                lines.append(f"{label} bone naming convention: {convention}")
            compat: list[str] = []
            if cbpc:
                compat.append("CBPC")
            if hdt:
                compat.append("HDT-SMP")
            if compat:
                lines.append(f"{label} compatible physics systems: {', '.join(compat)}")
            if softbody:
                lines.append(f"{label} supports softbody (per-vertex HDT-SMP deformation).")
            notes = cfg.get("notes")
            if isinstance(notes, str) and notes.strip():
                lines.append(f"{label} note: {notes.strip()}")
            return lines

        detail_lines.extend(physics_config_summary(source_cfg, "Source"))
        detail_lines.extend(physics_config_summary(target_cfg, "Target"))

        # Cross-system compatibility warning.
        if isinstance(source_cfg, dict) and isinstance(target_cfg, dict):
            src_conv = source_cfg.get("boneNamingConvention", "")
            tgt_conv = target_cfg.get("boneNamingConvention", "")
            if src_conv and tgt_conv and src_conv != tgt_conv:
                detail_lines.append(
                    f"Bone naming convention mismatch ({src_conv} → {tgt_conv}): "
                    "physics config files (CBPC ini / HDT-SMP XML) must be regenerated for the target body."
                )
            src_softbody = source_cfg.get("softbodySupported", False)
            tgt_softbody = target_cfg.get("softbodySupported", False)
            if src_softbody and not tgt_softbody:
                detail_lines.append(
                    "Source supports softbody deformation but target does not: "
                    "per-vertex HDT-SMP data will be collapsed to standard bone-driven physics."
                )
            elif not src_softbody and tgt_softbody:
                detail_lines.append(
                    "Target supports softbody deformation: "
                    "an HDT-SMP XML config with per-vertex skin data is required for full softbody output."
                )

        return (
            "pass",
            "Physics bone and partition preservation profile loaded.",
            detail_lines,
        )

    if stage_id == "morph-transfer":
        morph_pairs = mappings["morphPairs"]
        slider_pairs = mappings["sliderPairs"]
        output_path_str = req.get("outputPath", "")

        # Execute OSD slider/morph name remapping regardless of has_nif, since
        # OSD files live alongside the NIF and need renaming for BodySlide to load.
        morph_result = _run_morph_transfer_exec(output_path_str, slider_pairs, morph_pairs, libraries)
        morph_status = morph_result.get("status", "skip")
        morph_message = morph_result.get("message", "")

        # Fix: morph_pairs / slider_pairs are list[tuple] from paired_mappings(),
        # not dicts, so use index access instead of .keys().
        morph_keys = [pair[0] for pair in morph_pairs[:5]]
        slider_keys = [pair[0] for pair in slider_pairs[:5]]

        if morph_status == "pass":
            pass_details = [morph_message] if morph_message else []
            pass_details += [
                f"Detected {slider_assets} slider/morph-related source asset(s).",
                f"Morph equivalents map contains {len(morph_pairs)} canonical morph key(s)"
                + (f" ({', '.join(morph_keys)}{'…' if len(morph_pairs) > 5 else ''})" if morph_keys else "") + ".",
                f"Slider mapping map contains {len(slider_pairs)} canonical slider key(s)"
                + (f" ({', '.join(slider_keys)}{'…' if len(slider_pairs) > 5 else ''})" if slider_keys else "") + ".",
            ]
            if not has_tri:
                pass_details.append(
                    "No .TRI morph file detected — delta morphs will be synthesized from OSD/OSP slider data at build time."
                )
            return ("pass", "Delta-based morph transfer executed.", pass_details)

        if morph_status == "partial":
            partial_details = [morph_message] if morph_message else []
            partial_details.extend(str(e) for e in morph_result.get("errors", [])[:5])
            return (
                "attention",
                "Morph transfer partially completed — review errors.",
                partial_details,
            )

        # skip or error: fall back to metadata-only report with guidance
        details: list[str] = []
        if morph_message:
            details.append(morph_message)
        details.extend(str(e) for e in morph_result.get("errors", [])[:5])
        if not has_nif:
            details.append(
                "A NIF mesh is required to compute delta morph transfer from reference bodies. "
                "Expected: meshes/<mod>/<asset_name>_0.nif and _1.nif (weight-0 / weight-100 pair)."
            )
        if slider_assets == 0:
            details.append(
                "No slider/morph-related source assets were detected. "
                "Expected file types: .osp (BodySlide slider project), .osd (BodySlide morph data), "
                ".tri (RaceMenu/TRI morph file). "
                "Place them alongside the NIF in the mod folder and rerun."
            )
        if not morph_pairs:
            src_morph = source_meta.get("morphEquivalents") if isinstance(source_meta, dict) else None
            tgt_morph = target_meta.get("morphEquivalents") if isinstance(target_meta, dict) else None
            src_keys = list(src_morph.keys()) if isinstance(src_morph, dict) else []
            tgt_keys = list(tgt_morph.keys()) if isinstance(tgt_morph, dict) else []
            overlap = [k for k in src_keys if k in tgt_keys]
            details.append(
                "No overlapping canonical morphEquivalents found for this body pair. "
                + (
                    f"Source has: {', '.join(src_keys[:6])}. Target has: {', '.join(tgt_keys[:6])}. "
                    f"Shared canonical keys needed: {', '.join(overlap) if overlap else '(none yet — add matching keys to both bodies)'}."
                    if src_keys or tgt_keys
                    else "Populate morphEquivalents in body_reference_db.json for both body types."
                )
            )
        if not slider_pairs:
            src_sliders = source_meta.get("sliderMappings") if isinstance(source_meta, dict) else None
            tgt_sliders = target_meta.get("sliderMappings") if isinstance(target_meta, dict) else None
            src_keys = list(src_sliders.keys()) if isinstance(src_sliders, dict) else []
            tgt_keys = list(tgt_sliders.keys()) if isinstance(tgt_sliders, dict) else []
            overlap = [k for k in src_keys if k in tgt_keys]
            details.append(
                "No overlapping canonical sliderMappings found for this body pair. "
                + (
                    f"Source has: {', '.join(src_keys[:6])}. Target has: {', '.join(tgt_keys[:6])}. "
                    f"Shared canonical keys needed: {', '.join(overlap) if overlap else '(none yet — add matching keys)'}."
                    if src_keys or tgt_keys
                    else "Populate sliderMappings in body_reference_db.json for both body types."
                )
            )
        details.extend(missing_reference_maps)
        return (
            "attention",
            "Morph-transfer prerequisites are incomplete.",
            details
            + [
                "Zap/morph preservation should be manually validated after addressing the items above.",
                "A repair scaffold (morph-mapping-template.json) has been written to _SlideSmith/repairs/ "
                "with pre-filled slider and morph names — use it as a starting point.",
            ],
        )

    if stage_id == "tri-generation":
        required_libraries = missing_libraries(libraries, "numpy", "scipy")
        if (
            (has_tri or (slider_assets > 0 and mappings["morphPairs"]))
            and not missing_reference_maps
            and not required_libraries
        ):
            return (
                "pass",
                "TRI generation workflow initialized from morph deltas.",
                ["RaceMenu TRI compatibility checks enabled."],
            )
        details = []
        if not has_tri and slider_assets == 0:
            details.append("No morph source assets were detected for TRI generation.")
        elif not mappings["morphPairs"]:
            details.append("Populate overlapping canonical morphEquivalents to generate TRI deltas.")
        details.extend(missing_reference_maps)
        if required_libraries:
            details.append(
                f"Missing required Python libraries for TRI generation: {', '.join(required_libraries)}."
            )
        return (
            "attention",
            "TRI generation is running in fallback mode.",
            details + ["Output may not include standalone slider TRI payloads."],
        )

    return (
        "pass",
        "Quality gate checks generated for partition/weight/morph/TRI/physics consistency.",
        ["Gate results should be consumed by Electron audit."],
    )


def build_quality_gates(stage_reports: list[dict[str, Any]]) -> list[dict[str, str]]:
    def stage_status_for(stage_id: str) -> str:
        for report in stage_reports:
            if report.get("id") == stage_id:
                return str(report.get("status", "pass"))
        return "pass"

    def worst(*stage_ids: str) -> str:
        return "attention" if any(stage_status_for(sid) == "attention" for sid in stage_ids) else "pass"

    return [
        {
            "id": "partition-integrity",
            "status": worst("physics-preservation", "mesh-cleanup"),
            "summary": "Partition coverage analyzed from staged mesh and physics metadata.",
        },
        {
            "id": "bone-coverage",
            "status": worst("weight-transfer", "reference-body"),
            "summary": "Bone influence remap and preservation checks generated.",
        },
        {
            "id": "weight-normalization",
            "status": worst("weight-transfer", "corrective-smoothing"),
            "summary": "Weight normalization and corrective smoothing checks completed.",
        },
        {
            "id": "morph-validity",
            "status": worst("morph-transfer", "surface-reprojection"),
            "summary": "Morph delta transfer and zap preservation checks completed.",
        },
        {
            "id": "tri-compatibility",
            "status": worst("tri-generation"),
            "summary": "TRI output compatibility checks prepared for RaceMenu workflow.",
        },
        {
            "id": "physics-markers",
            "status": worst("physics-preservation"),
            "summary": "Physics marker and partition compatibility checks generated.",
        },
    ]


def process(req: dict[str, Any]) -> dict[str, Any]:
    run_id = req.get("runId") or str(uuid.uuid4())
    db = load_reference_db()
    libraries = {
        "pyffi": optional_import("pyffi"),
        "numpy": optional_import("numpy"),
        "scipy": optional_import("scipy"),
        "trimesh": optional_import("trimesh"),
        "pyvista": optional_import("pyvista"),
    }
    stage_reports: list[dict[str, Any]] = []

    total = max(len(STAGES), 1)
    for index, stage in enumerate(STAGES, start=1):
        progress = min(95, math.floor(index / total * 100))
        emit(
            {
                "type": "progress",
                "stage": stage.stage_id,
                "message": stage.message,
                "progress": progress,
            }
        )
        status, summary, details = stage_status(stage.stage_id, req, db, libraries)
        stage_reports.append(
            {
                "id": stage.stage_id,
                "title": stage.title,
                "status": status,
                "summary": summary,
                "details": details,
            }
        )

    warnings: list[str] = []
    if not has_nif_io_support(libraries):
        warnings.append(
            "PyFFI is not installed in the active Python environment; full NIF IO fallback mode is active."
        )
    if not libraries["numpy"]:
        warnings.append(
            "NumPy is not installed in the active Python environment; mesh reprojection and morph-delta math are downgraded."
        )
    if not libraries["scipy"]:
        warnings.append(
            "SciPy is not installed in the active Python environment; KD-tree interpolation and smoothing passes are downgraded."
        )
    if not libraries["trimesh"]:
        warnings.append(
            "trimesh is not installed in the active Python environment; nearest-surface mesh processing is downgraded."
        )
    if not libraries["pyvista"]:
        warnings.append(
            "PyVista is not installed in the active Python environment; cleanup/inspection stages are running in compatibility mode."
        )

    return {
        "runId": run_id,
        "backend": "python",
        "stages": stage_reports,
        "qualityGates": build_quality_gates(stage_reports),
        "warnings": warnings,
        "libraries": libraries,
    }


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        emit({"type": "error", "error": "No input payload received."})
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        emit({"type": "error", "error": f"Invalid JSON input: {exc}"})
        return 1

    summary = process(payload)
    emit({"type": "complete", "run": summary})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
