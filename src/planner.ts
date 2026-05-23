import type {
  BodyType,
  ConversionOperation,
  ConversionPlan,
  DetectionResult,
  ScannedFile,
} from "./types.js";

function baseOperations(
  sourceType: DetectionResult["bodyType"],
  targetType: BodyType,
): ConversionOperation[] {
  return [
    {
      id: "extract",
      name: "Extract source mesh and slider assets",
      description: `Read NIF/TRI/OSP assets and collect morph groups from ${sourceType}.`,
    },
    {
      id: "remap",
      name: "Remap reference skeleton and weights",
      description: `Normalize armor/clothing skinning against ${targetType} reference weighting.`,
    },
    {
      id: "project",
      name: "Project morphs to target topology",
      description: `Project source slider deltas to ${targetType} compatible shape keys.`,
    },
    {
      id: "generate",
      name: "Generate Bodyslide slider set",
      description: `Create/patch slider definitions and output preview metadata for ${targetType}.`,
    },
    {
      id: "validate",
      name: "Validate clipping and seam behavior",
      description:
        "Run integrity checks for neck, wrist, ankle, and weight-slider transitions.",
    },
  ];
}

function targetSpecificOperations(targetType: BodyType): ConversionOperation[] {
  if (targetType === "3ba") {
    return [
      {
        id: "physics",
        name: "Generate 3BA physics-compatible groups",
        description:
          "Prepare breast/butt/belly weighting groups expected by 3BA presets.",
      },
    ];
  }

  if (targetType === "himbo") {
    return [
      {
        id: "male",
        name: "Tune male-specific proportions",
        description:
          "Rebalance shoulder/chest/arm morph channels for HIMBO shape ranges.",
      },
    ];
  }

  if (targetType === "sos") {
    return [
      {
        id: "genitals",
        name: "Preserve SOS seam compatibility",
        description:
          "Validate pelvis seam and partition data expected by SOS workflows.",
      },
    ];
  }

  return [];
}

export function createConversionPlan(
  detection: DetectionResult,
  targetType: BodyType,
  files: ScannedFile[],
): ConversionPlan {
  const warnings: string[] = [];

  if (detection.bodyType === "unknown") {
    warnings.push(
      "Body type detection confidence is low; verify source body type before applying outputs.",
    );
  } else if (detection.bodyType === targetType) {
    warnings.push(
      "Source and target body type are the same; conversion may only require slider cleanup.",
    );
  }

  warnings.push(
    "Automated output should be reviewed in Outfit Studio before release.",
  );

  return {
    sourceType: detection.bodyType,
    targetType,
    detectionConfidence: detection.confidence,
    operations: [
      ...baseOperations(detection.bodyType, targetType),
      ...targetSpecificOperations(targetType),
    ],
    warnings,
    filesAnalyzed: files.length,
    generatedAt: new Date().toISOString(),
  };
}
