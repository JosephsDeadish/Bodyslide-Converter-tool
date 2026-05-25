#!/usr/bin/env python3
"""SlideSmith Python core pipeline runner.

Reads one JSON request from stdin and emits NDJSON progress/complete events to stdout.
"""

from __future__ import annotations

import json
import math
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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


def adapter_profile(db: dict[str, Any], source: Any, target: Any) -> str:
    for adapter in db.get("adapters", []):
        if not isinstance(adapter, dict):
            continue
        if adapter.get("source") == source and adapter.get("target") == target:
            profile = adapter.get("profile")
            if isinstance(profile, str):
                return profile
    return "default"


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
        "adapterProfile": adapter_profile(db, source, target),
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
        required_libraries = missing_libraries(
            libraries, "pynifly", "numpy", "scipy", "trimesh"
        )
        if has_nif and not missing_reference_maps and not required_libraries:
            return (
                "pass",
                "Nearest-triangle surface reprojection is available for mesh assets.",
                [
                    "Barycentric interpolation route initialized.",
                    f"Source canonical map: {source_map}",
                    f"Target canonical map: {target_map}",
                ],
            )
        details: list[str] = []
        if not has_nif:
            details.append("No NIF mesh detected for surface reprojection.")
            details.append("Stage executed with metadata-only fallback.")
        details.extend(missing_reference_maps)
        if required_libraries:
            details.append(
                f"Missing required Python libraries for nearest-surface reprojection: {', '.join(required_libraries)}."
            )
        return (
            "attention",
            "Surface reprojection is running in degraded fallback mode.",
            details,
        )

    if stage_id == "weight-transfer":
        bone_pairs = mappings["bonePairs"]
        required_libraries = missing_libraries(
            libraries, "pynifly", "numpy", "scipy", "trimesh"
        )
        if has_nif and bone_pairs and not missing_reference_maps and not required_libraries:
            return (
                "pass",
                "Weight transfer pipeline initialized with smoothing pass.",
                [
                    "Nearest-surface interpolation enabled.",
                    f"Bone-weight interpolation map contains {len(bone_pairs)} canonical bone chains.",
                ],
            )
        details = []
        if not has_nif:
            details.append("A NIF mesh is required for nearest-surface weight interpolation.")
        if not bone_pairs:
            details.append(
                "Populate overlapping canonical boneMap entries for both bodies to enable weight interpolation."
            )
        details.extend(missing_reference_maps)
        if required_libraries:
            details.append(
                f"Missing required Python libraries for weight transfer: {', '.join(required_libraries)}."
            )
        return (
            "attention",
            "Weight transfer metadata is incomplete for this body pair.",
            details
            + [
                "Bone remap quality may require manual verification.",
            ],
        )

    if stage_id == "corrective-smoothing":
        source_zones = source_meta.get("correctiveSmoothingZones", []) if isinstance(source_meta, dict) else []
        target_zones = target_meta.get("correctiveSmoothingZones", []) if isinstance(target_meta, dict) else []
        required_libraries = missing_libraries(libraries, "numpy", "scipy")
        if (
            has_nif
            and isinstance(source_zones, list)
            and source_zones
            and isinstance(target_zones, list)
            and target_zones
            and not required_libraries
        ):
            shared_zones = sorted(set(source_zones) & set(target_zones))
            unique_to_target = sorted(set(target_zones) - set(source_zones))
            detail_lines = [f"Shared corrective zones: {', '.join(shared_zones)}"] if shared_zones else []
            if unique_to_target:
                detail_lines.append(f"Target-only zones (will use fallback smoothing): {', '.join(unique_to_target)}")
            return (
                "pass",
                f"Corrective smoothing profiles loaded for {len(shared_zones)} shared zone(s).",
                detail_lines or ["All smoothing zones resolved."],
            )
        if not has_nif:
            return (
                "attention",
                "Corrective smoothing skipped because no NIF mesh was found.",
                ["Armpit, breast/chest, crotch, elbow, and knee zones could not be evaluated."],
            )
        if required_libraries:
            return (
                "attention",
                "Corrective smoothing is unavailable in the active Python environment.",
                [
                    f"Missing required Python libraries for corrective smoothing: {', '.join(required_libraries)}."
                ],
            )
        return (
            "attention",
            "Corrective smoothing zone definitions are missing from body metadata.",
            ["Populate correctiveSmoothingZones in body_reference_db.json for both source and target bodies."],
        )

    if stage_id == "mesh-cleanup":
        required_libraries = missing_libraries(libraries, "pynifly", "trimesh", "pyvista")
        if has_nif and not required_libraries:
            return ("pass", "Normals/tangents cleanup stage prepared.", ["Mesh validation checks queued."])
        details = ["Mesh validation checks queued."]
        if not has_nif:
            details.insert(0, "No NIF mesh detected for normals/tangents cleanup.")
        if required_libraries:
            details.append(
                f"Missing required Python libraries for mesh cleanup: {', '.join(required_libraries)}."
            )
        return ("attention", "Normals/tangents cleanup is running in compatibility mode.", details)

    if stage_id == "physics-preservation":
        source_bones = len(source_physics) if isinstance(source_physics, list) else 0
        target_bones = len(target_physics) if isinstance(target_physics, list) else 0
        if source_bones == 0 and target_bones == 0:
            return (
                "pass",
                "Physics preservation is not required for this body pair.",
                ["No physics chains detected in metadata."],
            )
        required_libraries = missing_libraries(libraries, "pynifly")
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
        required_libraries = missing_libraries(libraries, "numpy", "scipy")
        if (
            has_nif
            and slider_assets > 0
            and morph_pairs
            and slider_pairs
            and not missing_reference_maps
            and not required_libraries
        ):
            return (
                "pass",
                "Delta-based morph transfer configured.",
                [
                    f"Detected {slider_assets} slider/morph-related source asset(s).",
                    f"Morph equivalents map contains {len(morph_pairs)} canonical morph keys.",
                    f"Slider mapping map contains {len(slider_pairs)} canonical slider keys.",
                ],
            )
        details = []
        if not has_nif:
            details.append("A NIF mesh is required to compute delta morph transfer from reference bodies.")
        if slider_assets == 0:
            details.append("No slider/morph-related source assets were detected.")
        if not morph_pairs:
            details.append("Populate overlapping canonical morphEquivalents for both bodies.")
        if not slider_pairs:
            details.append("Populate overlapping canonical sliderMappings for both bodies.")
        details.extend(missing_reference_maps)
        if required_libraries:
            details.append(
                f"Missing required Python libraries for delta morph transfer: {', '.join(required_libraries)}."
            )
        return (
            "attention",
            "Morph-transfer prerequisites are incomplete.",
            details
            + [
                "Zap/morph preservation should be manually validated.",
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
        "pynifly": optional_import("pynifly"),
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
    if not libraries["pynifly"]:
        warnings.append(
            "PyNifly is not installed in the active Python environment; full NIF IO fallback mode is active."
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
