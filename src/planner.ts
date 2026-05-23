import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import type {
  BodyType,
  ConversionOperation,
  ConversionPlan,
  DetectionResult,
  ScannedFile,
} from "./types.js";

const FEMALE_BODIES: ReadonlySet<BodyType> = new Set([
  "cbbe",
  "3ba",
  "tbd",
  "unp",
  "bhunp",
  "uunp",
  "7base",
]);
const MALE_BODIES: ReadonlySet<BodyType> = new Set([
  "himbo",
  "bodytalk",
  "sos",
  "sam",
]);

function isFemale(bt: BodyType | "unknown"): boolean {
  return bt !== "unknown" && FEMALE_BODIES.has(bt as BodyType);
}

function isMale(bt: BodyType | "unknown"): boolean {
  return bt !== "unknown" && MALE_BODIES.has(bt as BodyType);
}

function baseOperations(
  sourceType: DetectionResult["bodyType"],
  targetType: BodyType,
): ConversionOperation[] {
  return [
    {
      id: "extract",
      name: "Extract source mesh and slider assets",
      description: `Read NIF/TRI/OSP assets and collect morph groups from the ${sourceType} source. Align converted outputs to the ${sourceType} reference body metadata used by BodySlide.`,
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
      description:
        "Run integrity checks for neck, wrist, ankle, and weight-slider transitions. Test at 0% and 100% weight to confirm no mesh tearing.",
    },
  ];
}

function targetSpecificOperations(targetType: BodyType): ConversionOperation[] {
  const info = BODY_TYPE_INFO[targetType];
  const ops: ConversionOperation[] = [];

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

  if (targetType !== "vanilla") {
    ops.push({
      id: "skeleton-compat",
      name: "Validate target skeleton compatibility",
      description: `${targetType.toUpperCase()} expects ${info.skeletonProfile}. ${info.skeletonNotes}`,
    });
  }

  if (targetType === "himbo") {
    ops.push({
      id: "male-proportions",
      name: "Tune male-specific proportions",
      description:
        "Rebalance shoulder, chest, arm, glute, and calf morph channels for HIMBO shape ranges. Male body proportions differ significantly from female bodies, so run in-game fit checks on broad shoulder and chest extremes.",
    });
  }

  if (targetType === "bodytalk") {
    ops.push({
      id: "bodytalk-shape",
      name: "Tune BodyTalk silhouette and slider naming",
      description:
        "BodyTalk outputs often keep older male slider naming. Align chest, abdomen, and thigh proportions to the BodyTalk reference and confirm the generated slider-set naming matches BodyTalk conventions (BT3 / BodyTalkV3 prefixes where applicable).",
    });
  }

  if (targetType === "sos") {
    ops.push({
      id: "sos-seam",
      name: "Preserve SOS pelvis seam and partition",
      description:
        "Validate pelvis seam edge loops and partition slot SBP_52. SOS injects a genital mesh at the waistband; any vertex overlap in the SBP_52 partition area will cause visible tearing at runtime. Confirm HDT-SMP or NiOverride physics XML is present if using SOS Regular.",
    });
  }

  if (targetType === "sam") {
    ops.push({
      id: "sam-morph",
      name: "Map SAM BodyMorph weight/muscle sliders",
      description:
        "SAM uses per-morph weight and muscle multipliers. Export morphs as SAM-compatible .tri deltas and confirm the SAMLightBodyConfig.json registers the new outfit so SAM can apply per-actor shape morphs.",
    });
  }

  if (targetType === "3ba") {
    ops.push({
      id: "3ba-belly",
      name: "Add 3BA belly physics group",
      description:
        "3BA supports a belly physics chain in addition to breast/butt. Confirm NPC Belly is weighted in the mesh and that both NPC Belly and NPC BellyRoot are listed in the CBPC config for full 3BA physics support.",
    });
  }

  if (targetType === "bhunp") {
    ops.push({
      id: "bhunp-bones",
      name: "Verify BHUNP-specific bone naming in physics config",
      description:
        "BHUNP uses a distinct bone naming convention: BHUNP Breast L/R01–03, BHUNP Butt L, BHUNP Butt R (not NPC L/R Breast01-03 like 3BA). BHUNP does not use BreastRoot bones. Confirm every entry in the CBPC .ini or HDT-SMP XML uses BHUNP-prefixed names.",
    });
  }

  if (targetType === "tbd") {
    ops.push({
      id: "tbd-proportions",
      name: "Adjust for TBD larger proportions",
      description:
        "TBD (Touched by Dibella) has noticeably larger bust and hip volume than standard CBBE. Lower the projection weight threshold when building BodySlide output to reduce clipping at bust and hip extremes. Run in-game fit checks at maximum weight slider values.",
    });
  }

  if (targetType === "7base") {
    ops.push({
      id: "7base-legacy",
      name: "Legacy topology cleanup for 7Base",
      description:
        "7Base uses a non-standard topology that differs from both CBBE and UNP. Automated projection results are high-risk; prioritize BodySlide preview plus in-game seam checks at neck, wrist, and ankle points. 7Base Bombshell/Oppai sub-variants have even more extreme proportions.",
    });
  }

  return ops;
}

function relationshipOperations(
  sourceType: DetectionResult["bodyType"],
  targetType: BodyType,
): ConversionOperation[] {
  if (sourceType === "unknown") {
    return [];
  }

  const sourceInfo = BODY_TYPE_INFO[sourceType];
  const targetInfo = BODY_TYPE_INFO[targetType];
  const ops: ConversionOperation[] = [];

  if (
    sourceInfo.gender !== "both" &&
    targetInfo.gender !== "both" &&
    sourceInfo.gender !== targetInfo.gender
  ) {
    ops.push({
      id: "cross-gender-shape",
      name: "Retune cross-gender silhouette",
      description: `Adapt the outfit from the ${sourceInfo.gender} ${sourceType} silhouette to the ${targetInfo.gender} ${targetType} silhouette. Focus on ${targetInfo.adaptationFocus.slice(0, 4).join(", ")} and re-balance chest, shoulder, waist, and pelvis proportions.`,
    });
    ops.push({
      id: "cross-gender-assets",
      name: "Rewrite gendered asset markers",
      description:
        "Update BodySlide project names and gendered asset path markers (body, hands, feet, and first-person variants) so the generated outfit resolves to the target gender asset set.",
    });
  } else if (
    sourceInfo.gender === targetInfo.gender &&
    sourceInfo.family !== targetInfo.family &&
    sourceInfo.gender !== "both"
  ) {
    ops.push({
      id: "cross-family-profile",
      name: "Adapt between body-family silhouettes",
      description: `Source and target use different ${sourceInfo.gender} body families. Validate slider projection and seam cleanup for ${targetInfo.adaptationFocus.slice(0, 4).join(", ")}.`,
    });
  }

  if (sourceInfo.topology !== targetInfo.topology) {
    ops.push({
      id: "topology-delta",
      name: "Review topology-driven seam differences",
      description: `Source topology '${sourceInfo.topology}' differs from target topology '${targetInfo.topology}'. Verify neck, wrist, ankle, and weight-slider seam behavior after conversion.`,
    });
  }

  // Cross-physics-family: both bodies have physics but use different bone naming conventions
  const crossPhysicsFamilyPairs = new Set([
    "3ba:bhunp",
    "bhunp:3ba",
    "3ba:tbd",
    "tbd:3ba",
    "bhunp:tbd",
    "tbd:bhunp",
  ]);
  if (
    sourceInfo.physicsSupport &&
    targetInfo.physicsSupport &&
    crossPhysicsFamilyPairs.has(`${sourceType}:${targetType}`)
  ) {
    ops.push({
      id: "cross-physics-family",
      name: "Remap cross-physics-family bone names",
      description: `Both bodies support physics but use different bone naming conventions (${sourceType.toUpperCase()} vs ${targetType.toUpperCase()}). Physics bone names are automatically remapped during conversion (e.g. BHUNP Breast L01 ↔ NPC L Breast01). Verify the generated physics config (.ini or .xml) uses the correct target-body bone names before testing in-game.`,
    });
  }

  return ops;
}

function getWeightPairCounterpart(relativePath: string): string | null {
  if (/_0\.(nif|osd|tri)$/i.test(relativePath)) {
    return relativePath.replace(/_0\.(nif|osd|tri)$/i, "_1.$1");
  }
  if (/_1\.(nif|osd|tri)$/i.test(relativePath)) {
    return relativePath.replace(/_1\.(nif|osd|tri)$/i, "_0.$1");
  }
  return null;
}

export function createConversionPlan(
  detection: DetectionResult,
  targetType: BodyType,
  files: ScannedFile[],
): ConversionPlan {
  const warnings: string[] = [];
  const sourceType = detection.bodyType;

  // Unknown source
  if (sourceType === "unknown") {
    warnings.push(
      "Body type detection returned 'unknown'. Manually verify the source body type before applying any conversion outputs.",
    );
  }

  // Same source and target
  if (sourceType === targetType) {
    warnings.push(
      "Source and target body type are identical. Conversion may only require slider cleanup or mesh re-projection.",
    );
  }

  // Low confidence
  if (detection.confidence < 0.55) {
    warnings.push(
      `Detection confidence is low (${Math.round(detection.confidence * 100)}%). Review ranked candidates before committing conversion outputs.`,
    );
  }

  // Cross-gender warning
  const crossGender =
    (isFemale(sourceType) && isMale(targetType)) ||
    (isMale(sourceType) && isFemale(targetType));
  if (crossGender) {
    const fromGender = isFemale(sourceType) ? "female" : "male";
    const toGender = isFemale(targetType) ? "female" : "male";
    warnings.push(
      `Cross-gender conversion detected (${fromGender} → ${toGender}). Body proportions differ significantly; run extended in-game fit checks because clipping risk is higher than same-gender conversions.`,
    );
  }

  // Physics collapse warning (source has physics, target does not)
  if (sourceType !== "unknown") {
    const srcInfo = BODY_TYPE_INFO[sourceType as BodyType];
    const tgtInfo = BODY_TYPE_INFO[targetType];
    if (srcInfo?.physicsSupport && !tgtInfo.physicsSupport) {
      warnings.push(
        `Source body '${sourceType}' uses physics chain bones that do not exist in '${targetType}'. Collapse physics-chain bone weights back to the nearest static bone (e.g. NPC Spine2 for breast, NPC Pelvis for butt) before finalizing.`,
      );
    }
    if (!srcInfo?.physicsSupport && tgtInfo.physicsSupport) {
      warnings.push(
        `Target body '${targetType}' requires physics chain bones that are absent in the source. Verify that generated configs include the required target physics bones listed in the plan operations.`,
      );
    }
  }

  // Topology note: 3BA shares CBBE topology
  if (
    (sourceType === "cbbe" && targetType === "3ba") ||
    (sourceType === "3ba" && targetType === "cbbe")
  ) {
    warnings.push(
      "3BA shares the same base mesh topology as CBBE. Mesh re-projection is not required; only physics bone weighting and CBPC config updates are needed.",
    );
  }

  const knownPaths = new Set(files.map((file) => file.relativePath));
  const missingWeightPairCount = files.reduce((count, file) => {
    const counterpart = getWeightPairCounterpart(file.relativePath);
    if (!counterpart) return count;
    return knownPaths.has(counterpart) ? count : count + 1;
  }, 0);
  if (missingWeightPairCount > 0) {
    warnings.push(
      `Detected ${missingWeightPairCount} mesh file(s) with only one Skyrim weight variant. Skyrim SE expects paired _0/_1 meshes for weight-slider support; missing counterparts should be generated or manually exported.`,
    );
  }

  warnings.push(
    "Automated conversion outputs should always be smoke-tested in-game before release; prioritize BodySlide preview and in-game seam checks for high-risk topology or cross-gender edge cases.",
  );

  return {
    sourceType,
    targetBodyType: targetType,
    detectionConfidence: detection.confidence,
    operations: [
      ...baseOperations(sourceType, targetType),
      ...relationshipOperations(sourceType, targetType),
      ...targetSpecificOperations(targetType),
    ],
    warnings,
    filesAnalyzed: files.length,
    generatedAt: new Date().toISOString(),
  };
}
