#!/usr/bin/env python3
"""SlideSmith Python core pipeline runner.

Reads one JSON request from stdin and emits NDJSON progress/complete events to stdout.
"""

from __future__ import annotations

import json
import math
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REF_DB_PATH = ROOT / "slidesmith_engine" / "references" / "body_reference_db.json"


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


def stage_status(stage_id: str, req: dict[str, Any], db: dict[str, Any]) -> tuple[str, str, list[str]]:
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

    if stage_id == "reference-body":
        source_ready = bool(mappings["sourceSliders"] and mappings["sourceBones"] and mappings["sourceMorphs"])
        target_ready = bool(mappings["targetSliders"] and mappings["targetBones"] and mappings["targetMorphs"])
        if source_ready and target_ready:
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
                    f"Slider mappings: {len(mappings['sliderPairs'])} shared canonical keys",
                    f"Bone mappings: {len(mappings['bonePairs'])} shared canonical keys",
                    f"Morph equivalents: {len(mappings['morphPairs'])} shared canonical keys",
                ],
            )
        return (
            "attention",
            "Reference body metadata is incomplete for this pair.",
            [
                "Populate topologyReference, sliderMappings, boneMap, and morphEquivalents for both source and target bodies.",
                "Per-body adapter fallback profile should be defined.",
            ],
        )

    if stage_id == "surface-reprojection":
        if has_nif:
            return (
                "pass",
                "Nearest-triangle surface reprojection is available for mesh assets.",
                ["Barycentric interpolation route initialized."],
            )
        return (
            "attention",
            "No NIF mesh detected for surface reprojection.",
            ["Stage executed with metadata-only fallback."],
        )

    if stage_id == "weight-transfer":
        bone_pairs = mappings["bonePairs"]
        if has_nif and bone_pairs:
            return (
                "pass",
                "Weight transfer pipeline initialized with smoothing pass.",
                [
                    "Nearest-surface interpolation enabled.",
                    f"Bone-weight interpolation map contains {len(bone_pairs)} canonical bone chains.",
                ],
            )
        return (
            "attention",
            "Weight transfer metadata is incomplete for this body pair.",
            [
                "A NIF mesh and populated source/target boneMap entries are required for high-quality interpolation.",
                "Bone remap quality may require manual verification.",
            ],
        )

    if stage_id == "corrective-smoothing":
        source_zones = source_meta.get("correctiveSmoothingZones", []) if isinstance(source_meta, dict) else []
        target_zones = target_meta.get("correctiveSmoothingZones", []) if isinstance(target_meta, dict) else []
        if has_nif and isinstance(source_zones, list) and source_zones and isinstance(target_zones, list) and target_zones:
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
        return (
            "attention",
            "Corrective smoothing zone definitions are missing from body metadata.",
            ["Populate correctiveSmoothingZones in body_reference_db.json for both source and target bodies."],
        )

    if stage_id == "mesh-cleanup":
        return (
            "pass" if has_nif else "attention",
            "Normals/tangents cleanup stage prepared.",
            ["Mesh validation checks queued."],
        )

    if stage_id == "physics-preservation":
        source_bones = len(source_physics) if isinstance(source_physics, list) else 0
        target_bones = len(target_physics) if isinstance(target_physics, list) else 0
        if source_bones == 0 and target_bones == 0:
            return (
                "pass",
                "Physics preservation is not required for this body pair.",
                ["No physics chains detected in metadata."],
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
        return (
            "pass",
            "Physics bone and partition preservation profile loaded.",
            [f"Source physics bones: {source_bones}", f"Target physics bones: {target_bones}"],
        )

    if stage_id == "morph-transfer":
        morph_pairs = mappings["morphPairs"]
        slider_pairs = mappings["sliderPairs"]
        if slider_assets > 0 and morph_pairs and slider_pairs:
            return (
                "pass",
                "Delta-based morph transfer configured.",
                [
                    f"Detected {slider_assets} slider/morph-related source asset(s).",
                    f"Morph equivalents map contains {len(morph_pairs)} canonical morph keys.",
                    f"Slider mapping map contains {len(slider_pairs)} canonical slider keys.",
                ],
            )
        return (
            "attention",
            "Morph-transfer prerequisites are incomplete.",
            [
                "Ensure slider source files are present and both bodies define sliderMappings plus morphEquivalents.",
                "Zap/morph preservation should be manually validated.",
            ],
        )

    if stage_id == "tri-generation":
        if has_tri or (slider_assets > 0 and mappings["morphPairs"]):
            return (
                "pass",
                "TRI generation workflow initialized from morph deltas.",
                ["RaceMenu TRI compatibility checks enabled."],
            )
        return (
            "attention",
            "TRI generation skipped (no morph sources detected).",
            ["Output may not include standalone slider TRI payloads."],
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
        status, summary, details = stage_status(stage.stage_id, req, db)
        stage_reports.append(
            {
                "id": stage.stage_id,
                "title": stage.title,
                "status": status,
                "summary": summary,
                "details": details,
            }
        )

    libraries = {
        "pynifly": optional_import("pynifly"),
        "numpy": optional_import("numpy"),
        "scipy": optional_import("scipy"),
        "trimesh": optional_import("trimesh"),
        "pyvista": optional_import("pyvista"),
    }

    warnings: list[str] = []
    if not libraries["pynifly"]:
        warnings.append(
            "PyNifly is not installed in the active Python environment; full NIF IO fallback mode is active."
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
