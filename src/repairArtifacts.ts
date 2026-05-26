import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BodyType, PythonEngineRunSummary } from "./types.js";

type RepairIssueId =
  | "missing-nif-mesh"
  | "incomplete-body-metadata"
  | "missing-adapter-profile"
  | "missing-smoothing-profile"
  | "incomplete-morph-mappings"
  | "incomplete-physics-metadata";

type RepairIssue = {
  id: RepairIssueId;
  summary: string;
  stageIds: string[];
};

export type RepairArtifact = {
  relativePath: string;
  description: string;
};

type RepairArtifactGenerationArgs = {
  reportsDir: string;
  sourceBodyType: BodyType;
  targetBodyType: BodyType;
  pythonSummary: PythonEngineRunSummary;
};

function hasMissingNifMessage(value: string): boolean {
  return /no nif mesh/i.test(value);
}

function hasIncompleteMetadataMessage(value: string): boolean {
  return (
    /metadata is incomplete/i.test(value) ||
    /reference metadata/i.test(value) ||
    /canonical vertex map is missing/i.test(value) ||
    /topologyreference/i.test(value) ||
    /canonicalvertexmap/i.test(value) ||
    /body_reference_db/i.test(value) ||
    /populate topology/i.test(value) ||
    /populate overlapping canonical/i.test(value)
  );
}

function hasAdapterProfileMessage(value: string): boolean {
  return (
    /adapter profile/i.test(value) ||
    /adapter entry/i.test(value) ||
    /missing explicit adapter/i.test(value)
  );
}

function hasSmoothingProfileMessage(value: string): boolean {
  return (
    /corrective smoothing zone/i.test(value) ||
    /correctivesmoothingzones/i.test(value)
  );
}

function hasMorphMappingMessage(value: string): boolean {
  return (
    /morphtransfer prerequisites are incomplete/i.test(
      value.replace(/[\s-]+/g, ""),
    ) ||
    /morph validity/i.test(value) ||
    /slider mapping/i.test(value) ||
    /morphequivalents/i.test(value) ||
    /slidermappings/i.test(value)
  );
}

function hasPhysicsMetadataMessage(value: string): boolean {
  return (
    /physics metadata/i.test(value) ||
    /physics marker/i.test(value) ||
    /physics config files .* must be regenerated/i.test(value) ||
    /bone naming convention mismatch/i.test(value) ||
    /missing physics entries in target bonemap/i.test(value) ||
    /softbody deformation/i.test(value)
  );
}

function collectRepairIssues(summary: PythonEngineRunSummary): RepairIssue[] {
  const signals = [
    ...summary.stages.flatMap((stage) => [
      { id: stage.id, value: stage.summary },
      ...stage.details.map((detail) => ({ id: stage.id, value: detail })),
    ]),
    ...summary.qualityGates.map((gate) => ({
      id: `gate:${gate.id}`,
      value: gate.summary,
    })),
    ...summary.warnings.map((warning, index) => ({
      id: `warning:${index + 1}`,
      value: warning,
    })),
  ];
  const idsFor = (predicate: (value: string) => boolean) =>
    [...new Set(signals.filter((signal) => predicate(signal.value)).map((s) => s.id))];

  const missingNifStageIds = idsFor(hasMissingNifMessage);
  const metadataStageIds = idsFor(hasIncompleteMetadataMessage);
  const adapterStageIds = idsFor(hasAdapterProfileMessage);
  const smoothingStageIds = idsFor(hasSmoothingProfileMessage);
  const morphStageIds = idsFor(hasMorphMappingMessage);
  const physicsStageIds = idsFor(hasPhysicsMetadataMessage);

  const issues: RepairIssue[] = [];
  if (missingNifStageIds.length > 0) {
    issues.push({
      id: "missing-nif-mesh",
      summary:
        "No NIF mesh assets were detected for one or more Python core stages.",
      stageIds: missingNifStageIds,
    });
  }
  if (metadataStageIds.length > 0) {
    issues.push({
      id: "incomplete-body-metadata",
      summary:
        "Body-pair reference metadata is incomplete for one or more transfer stages.",
      stageIds: metadataStageIds,
    });
  }
  if (adapterStageIds.length > 0) {
    issues.push({
      id: "missing-adapter-profile",
      summary:
        "High-risk body-pair adapter profiles are missing for one or more transfer stages.",
      stageIds: adapterStageIds,
    });
  }
  if (smoothingStageIds.length > 0) {
    issues.push({
      id: "missing-smoothing-profile",
      summary:
        "Corrective smoothing zones are missing, so deformation cleanup cannot run fully.",
      stageIds: smoothingStageIds,
    });
  }
  if (morphStageIds.length > 0) {
    issues.push({
      id: "incomplete-morph-mappings",
      summary:
        "Morph/slider mappings are incomplete, so zap and TRI transfer automation is degraded.",
      stageIds: morphStageIds,
    });
  }
  if (physicsStageIds.length > 0) {
    issues.push({
      id: "incomplete-physics-metadata",
      summary:
        "Physics metadata is incomplete, so reweighting and physics conversion need follow-up.",
      stageIds: physicsStageIds,
    });
  }
  return issues;
}

function buildBodyMetadataPatchTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  const uniqueBodyTypes = [...new Set([sourceBodyType, targetBodyType])];
  const bodyTemplate = {
    topology: "TODO-topology-family",
    topologyReference: "TODO-reference-project-name",
    canonicalVertexMap: "TODO-canonical-vertex-map",
    skeletonProfile: "TODO-skeleton-profile",
    partitionProfile: "TODO-partition-profile",
    physicsBones: ["TODO-physics-bone"],
    sliderMappings: {
      waist: "TODO-body-slider-name",
      breast: "TODO-body-slider-name",
    },
    boneMap: {
      pelvis: "TODO-body-bone-name",
      spine: "TODO-body-bone-name",
    },
    morphEquivalents: {
      heavy: "TODO-body-morph-name",
      natural: "TODO-body-morph-name",
    },
    correctiveSmoothingZones: [
      "armpit-left",
      "armpit-right",
      "breast-left",
      "breast-right",
      "crotch",
      "elbow-left",
      "elbow-right",
      "knee-left",
      "knee-right",
    ],
    physicsConfig: {
      cbpcCompatible: false,
      hdtSmpCompatible: false,
      softbodySupported: false,
      physicsLevel: "TODO-physics-level",
      boneNamingConvention: "TODO-bone-naming-convention",
      notes: "TODO-physics-notes",
    },
  };

  const bodies = Object.fromEntries(
    uniqueBodyTypes.map((bodyType) => [bodyType, bodyTemplate]),
  );
  const adapters =
    sourceBodyType === targetBodyType
      ? []
      : [
          {
            source: sourceBodyType,
            target: targetBodyType,
            profile: "TODO-adapter-profile-name",
          },
        ];

  return {
    schemaVersion: 3,
    bodies,
    adapters,
  };
}

function buildAdapterProfileTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    adapters: [
      {
        source: sourceBodyType,
        target: targetBodyType,
        profile: "TODO-adapter-profile-name",
      },
    ],
    notes: [
      "Create a body-pair-specific profile for cross-topology, cross-physics, or cross-gender conversions.",
      "Use a reverse-direction upgrade/downgrade profile if the existing profile only exists in the opposite direction.",
    ],
  };
}

function buildCorrectiveSmoothingTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  const uniqueBodyTypes = [...new Set([sourceBodyType, targetBodyType])];
  return {
    schemaVersion: 3,
    bodies: Object.fromEntries(
      uniqueBodyTypes.map((bodyType) => [
        bodyType,
        {
          correctiveSmoothingZones: [
            "armpit-left",
            "armpit-right",
            "breast-left",
            "breast-right",
            "crotch",
            "elbow-left",
            "elbow-right",
            "knee-left",
            "knee-right",
          ],
        },
      ]),
    ),
  };
}

function buildMorphMappingTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  const uniqueBodyTypes = [...new Set([sourceBodyType, targetBodyType])];
  return {
    schemaVersion: 3,
    bodies: Object.fromEntries(
      uniqueBodyTypes.map((bodyType) => [
        bodyType,
        {
          sliderMappings: {
            waist: "TODO-slider-name",
            belly: "TODO-slider-name",
            butt: "TODO-slider-name",
            breast: "TODO-slider-name",
          },
          morphEquivalents: {
            heavy: "TODO-morph-name",
            thin: "TODO-morph-name",
            natural: "TODO-morph-name",
            zapBelly: "TODO-zap-name",
          },
        },
      ]),
    ),
  };
}

function buildPhysicsMetadataTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  const uniqueBodyTypes = [...new Set([sourceBodyType, targetBodyType])];
  return {
    schemaVersion: 3,
    bodies: Object.fromEntries(
      uniqueBodyTypes.map((bodyType) => [
        bodyType,
        {
          physicsBones: ["TODO-physics-bone"],
          boneMap: {
            pelvis: "TODO-body-bone-name",
            belly: "TODO-body-bone-name",
            leftBreast: "TODO-body-bone-name",
            rightBreast: "TODO-body-bone-name",
          },
          physicsConfig: {
            cbpcCompatible: false,
            hdtSmpCompatible: false,
            softbodySupported: false,
            physicsLevel: "TODO-physics-level",
            boneNamingConvention: "TODO-bone-naming-convention",
            notes: "TODO-physics-notes",
          },
        },
      ]),
    ),
  };
}

export async function generateRepairArtifacts(
  args: RepairArtifactGenerationArgs,
): Promise<RepairArtifact[]> {
  const issues = collectRepairIssues(args.pythonSummary);
  if (issues.length === 0) {
    return [];
  }

  const repairsDir = join(args.reportsDir, "repairs");
  await mkdir(repairsDir, { recursive: true });

  const artifacts: RepairArtifact[] = [];

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceBodyType: args.sourceBodyType,
    targetBodyType: args.targetBodyType,
    issues,
    notes: [
      "These files are generated repair scaffolding to speed up manual asset/data fixes.",
      "Replace TODO values with real body data before using metadata patches.",
    ],
  };
  const manifestFileName = "repair-manifest.json";
  await writeFile(
    join(repairsDir, manifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  artifacts.push({
    relativePath: `_SlideSmith/repairs/${manifestFileName}`,
    description:
      "Structured list of detected repair issues and stage coverage.",
  });

  const checklistFileName = "repair-checklist.txt";
  const checklistLines = [
    "SlideSmith repair checklist",
    "",
    ...issues.map(
      (issue, index) =>
        `${index + 1}. ${issue.summary} (stages: ${issue.stageIds.join(", ")})`,
    ),
    "",
    "Key follow-up areas: reference metadata, adapter profiles, reweighting, morph transfer, physics configs, and smoothing/deform cleanup.",
    "",
    "Apply the generated templates in this folder, then rerun conversion.",
  ];
  await writeFile(
    join(repairsDir, checklistFileName),
    `${checklistLines.join("\n")}\n`,
    "utf8",
  );
  artifacts.push({
    relativePath: `_SlideSmith/repairs/${checklistFileName}`,
    description:
      "Human-readable repair checklist for follow-up conversion runs.",
  });

  if (issues.some((issue) => issue.id === "missing-nif-mesh")) {
    const meshTemplateFileName = "missing-nif-mesh-template.txt";
    const meshTemplateLines = [
      "Create at least one valid NIF mesh pair per outfit/body asset:",
      "  meshes/<mod>/<asset_name>_0.nif",
      "  meshes/<mod>/<asset_name>_1.nif",
      "",
      "If slider data exists, ensure project output paths point to these meshes.",
      "After adding meshes, rerun conversion so smoothing/physics/morph stages can execute fully.",
    ];
    await writeFile(
      join(repairsDir, meshTemplateFileName),
      `${meshTemplateLines.join("\n")}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${meshTemplateFileName}`,
      description: "Template guidance for restoring missing mesh pair inputs.",
    });
  }

  if (issues.some((issue) => issue.id === "incomplete-body-metadata")) {
    const metadataPatchFileName = "body-reference-db.patch.json";
    const patch = buildBodyMetadataPatchTemplate(
      args.sourceBodyType,
      args.targetBodyType,
    );
    await writeFile(
      join(repairsDir, metadataPatchFileName),
      `${JSON.stringify(patch, null, 2)}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${metadataPatchFileName}`,
      description:
        "Metadata patch scaffold for topology, canonical maps, slider/bone/morph mappings, and adapter profiles.",
    });
  }

  if (issues.some((issue) => issue.id === "missing-adapter-profile")) {
    const adapterPatchFileName = "adapter-profile-template.json";
    await writeFile(
      join(repairsDir, adapterPatchFileName),
      `${JSON.stringify(
        buildAdapterProfileTemplate(args.sourceBodyType, args.targetBodyType),
        null,
        2,
      )}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${adapterPatchFileName}`,
      description:
        "Adapter-profile scaffold for high-risk body-pair automation routes.",
    });
  }

  if (issues.some((issue) => issue.id === "missing-smoothing-profile")) {
    const smoothingPatchFileName = "corrective-smoothing-template.json";
    await writeFile(
      join(repairsDir, smoothingPatchFileName),
      `${JSON.stringify(
        buildCorrectiveSmoothingTemplate(
          args.sourceBodyType,
          args.targetBodyType,
        ),
        null,
        2,
      )}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${smoothingPatchFileName}`,
      description:
        "Corrective smoothing-zone scaffold for deformation cleanup coverage.",
    });
  }

  if (issues.some((issue) => issue.id === "incomplete-morph-mappings")) {
    const morphPatchFileName = "morph-mapping-template.json";
    await writeFile(
      join(repairsDir, morphPatchFileName),
      `${JSON.stringify(
        buildMorphMappingTemplate(args.sourceBodyType, args.targetBodyType),
        null,
        2,
      )}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${morphPatchFileName}`,
      description:
        "Slider/morph mapping scaffold for zap, preset, and TRI transfer coverage.",
    });
  }

  if (issues.some((issue) => issue.id === "incomplete-physics-metadata")) {
    const physicsPatchFileName = "physics-metadata-template.json";
    await writeFile(
      join(repairsDir, physicsPatchFileName),
      `${JSON.stringify(
        buildPhysicsMetadataTemplate(args.sourceBodyType, args.targetBodyType),
        null,
        2,
      )}\n`,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${physicsPatchFileName}`,
      description:
        "Physics metadata scaffold for bone remaps, CBPC/HDT-SMP naming, and softbody notes.",
    });
  }

  return artifacts;
}
