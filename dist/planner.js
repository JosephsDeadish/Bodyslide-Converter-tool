import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
const FEMALE_BODIES = new Set([
    "cbbe",
    "3ba",
    "tbd",
    "unp",
    "bhunp",
    "uunp",
    "7base",
]);
const MALE_BODIES = new Set(["himbo", "sos", "sam"]);
function isFemale(bt) {
    return bt !== "unknown" && FEMALE_BODIES.has(bt);
}
function isMale(bt) {
    return bt !== "unknown" && MALE_BODIES.has(bt);
}
function baseOperations(sourceType, targetType) {
    return [
        {
            id: "extract",
            name: "Extract source mesh and slider assets",
            description: `Read NIF/TRI/OSP assets and collect morph groups from the ${sourceType} source. Load into Outfit Studio using the ${sourceType} reference body.`,
        },
        {
            id: "remap",
            name: "Remap reference skeleton and bone weights",
            description: `Normalize armor/clothing skinning against the ${targetType} reference skeleton. Ensure all bone names match the ${targetType} hierarchy and no orphan weight groups remain.`,
        },
        {
            id: "project",
            name: "Project morphs onto target topology",
            description: `Project source slider deltas onto the ${targetType} reference mesh. Adjust projection threshold to avoid clipping on bust, waist, and hip areas. Rebuild OSP slider sets for ${targetType}.`,
        },
        {
            id: "generate",
            name: "Generate BodySlide slider set",
            description: `Create or patch the .osp slider definition file and .xml project file for ${targetType}. Validate that all expected sliders (min/max) are present.`,
        },
        {
            id: "validate",
            name: "Validate clipping and seam integrity",
            description: "Run integrity checks for neck, wrist, ankle, and weight-slider transitions. Test at 0% and 100% weight to confirm no mesh tearing.",
        },
    ];
}
function targetSpecificOperations(targetType) {
    const info = BODY_TYPE_INFO[targetType];
    const ops = [];
    if (info.physicsSupport && info.physicsBones.length > 0) {
        ops.push({
            id: "physics-weight",
            name: `Add physics bone weighting (${targetType.toUpperCase()})`,
            description: `Assign skinning weights to physics chain bones: ${info.physicsBones.slice(0, 6).join(", ")}${info.physicsBones.length > 6 ? ` …and ${info.physicsBones.length - 6} more` : ""}. Required for CBPC/HDT-SMP to drive breast/butt motion.`,
        });
        ops.push({
            id: "physics-config",
            name: "Verify CBPC / HDT-SMP physics config",
            description: `Confirm the physics config file (CBPC.ini or hdtPhysicsExtensions .xml) references the correct bone names for ${targetType.toUpperCase()}. Missing entries will cause stiff or broken physics at runtime.`,
        });
    }
    if (targetType === "himbo") {
        ops.push({
            id: "male-proportions",
            name: "Tune male-specific proportions",
            description: "Rebalance shoulder, chest, and arm morph channels for HIMBO shape ranges. Male body proportions differ significantly from female bodies; manual vertex touch-up in Outfit Studio is recommended.",
        });
    }
    if (targetType === "sos") {
        ops.push({
            id: "sos-seam",
            name: "Preserve SOS pelvis seam and partition",
            description: "Validate pelvis seam edge loops and partition slot SBP_52. SOS injects a genital mesh; any vertex overlap in the partition area will cause visible tearing at runtime.",
        });
    }
    if (targetType === "sam") {
        ops.push({
            id: "sam-morph",
            name: "Map SAM BodyMorph weight/muscle sliders",
            description: "SAM uses per-morph weight and muscle multipliers. Export morphs as SAM-compatible .tri deltas and confirm the SAMLightBodyConfig.json references the new outfit.",
        });
    }
    if (targetType === "3ba") {
        ops.push({
            id: "3ba-belly",
            name: "Add 3BA belly physics group",
            description: "3BA supports a belly physics chain in addition to breast/butt. Confirm belly bone (NPC Belly) is weighted and present in the CBPC config for full 3BA physics support.",
        });
    }
    return ops;
}
export function createConversionPlan(detection, targetType, files) {
    const warnings = [];
    const sourceType = detection.bodyType;
    // Unknown source
    if (sourceType === "unknown") {
        warnings.push("Body type detection returned 'unknown'. Manually verify the source body type before applying any conversion outputs.");
    }
    // Same source and target
    if (sourceType === targetType) {
        warnings.push("Source and target body type are identical. Conversion may only require slider cleanup or mesh re-projection.");
    }
    // Low confidence
    if (detection.confidence < 0.55) {
        warnings.push(`Detection confidence is low (${Math.round(detection.confidence * 100)}%). Review ranked candidates before committing conversion outputs.`);
    }
    // Cross-gender warning
    const crossGender = (isFemale(sourceType) && isMale(targetType)) ||
        (isMale(sourceType) && isFemale(targetType));
    if (crossGender) {
        const fromGender = isFemale(sourceType) ? "female" : "male";
        const toGender = isFemale(targetType) ? "female" : "male";
        warnings.push(`Cross-gender conversion detected (${fromGender} → ${toGender}). Body proportions differ significantly; extensive manual mesh editing in Outfit Studio is expected. Clipping issues are very likely without per-vertex adjustment.`);
    }
    // Physics collapse warning (source has physics, target does not)
    if (sourceType !== "unknown") {
        const srcInfo = BODY_TYPE_INFO[sourceType];
        const tgtInfo = BODY_TYPE_INFO[targetType];
        if (srcInfo?.physicsSupport && !tgtInfo.physicsSupport) {
            warnings.push(`Source body '${sourceType}' uses physics chain bones that do not exist in '${targetType}'. Collapse physics-chain bone weights back to the nearest static bone (e.g. NPC Spine2 for breast, NPC Pelvis for butt) before finalizing.`);
        }
        if (!srcInfo?.physicsSupport && tgtInfo.physicsSupport) {
            warnings.push(`Target body '${targetType}' requires physics chain bones that are absent in the source. After projection, manually assign weights to the physics bones listed in the plan operations above.`);
        }
    }
    // Topology note: 3BA shares CBBE topology
    if ((sourceType === "cbbe" && targetType === "3ba") ||
        (sourceType === "3ba" && targetType === "cbbe")) {
        warnings.push("3BA shares the same base mesh topology as CBBE. Mesh re-projection is not required; only physics bone weighting and CBPC config updates are needed.");
    }
    warnings.push("All automated outputs should be reviewed and tested in Outfit Studio and in-game before release.");
    return {
        sourceType,
        targetBodyType: targetType,
        detectionConfidence: detection.confidence,
        operations: [
            ...baseOperations(sourceType, targetType),
            ...targetSpecificOperations(targetType),
        ],
        warnings,
        filesAnalyzed: files.length,
        generatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=planner.js.map