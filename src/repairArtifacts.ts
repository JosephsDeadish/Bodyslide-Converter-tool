import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
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
  /** Optional Electron userData dir — when set, repairs are also written here
   *  and the reference-DB patch is auto-merged so the Python engine uses it
   *  on the next conversion run. */
  userDataDir?: string;
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
  const idsFor = (predicate: (value: string) => boolean) => [
    ...new Set(
      signals.filter((signal) => predicate(signal.value)).map((s) => s.id),
    ),
  ];

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

/**
 * Known slider-name mappings per body type derived from the reference database.
 * These are used to pre-populate repair scaffolding so TODO placeholders are
 * replaced with real values and the templates are immediately actionable.
 */
const KNOWN_SLIDER_MAPPINGS: Partial<Record<BodyType, Record<string, string>>> =
  {
    cbbe: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    "3ba": {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
      breastHeight: "Breast Height",
      breastDepth: "Breast Depth",
      breastWidth: "Breast Width",
      nippleCurve: "Nipple Curve",
    },
    coco: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    tbd: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    unp: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    bhunp: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    uunp: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    ube: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    "7base": {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Butt",
      breast: "Breasts",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
    },
    himbo: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Glutes",
      breast: "Chest",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
      chestWidth: "Chest Width",
      chestDepth: "Chest Depth",
      shoulderWidth: "Shoulders",
    },
    bodytalk: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Glutes",
      breast: "Chest",
      thigh: "Thigh",
      arm: "Arms",
      calf: "Calves",
      chestWidth: "Chest Width",
      chestDepth: "Chest Depth",
      shoulderWidth: "Shoulders",
    },
    sos: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Glutes",
      breast: "Chest",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
      chestWidth: "Chest Width",
      chestDepth: "Chest Depth",
      shoulderWidth: "Shoulders",
    },
    sam: {
      waist: "Waist",
      belly: "Belly",
      hip: "Hip",
      butt: "Glutes",
      breast: "Chest",
      thigh: "Thighs",
      arm: "Arms",
      calf: "Calves",
      chestWidth: "SAM Chest Width",
      chestDepth: "SAM Chest Depth",
      shoulderWidth: "SAM Shoulders",
    },
    vanilla: { waist: "Waist", belly: "Belly", hip: "Hip", breast: "Breasts" },
  };

/**
 * Known morph-equivalent mappings per body type derived from the reference DB.
 */
const KNOWN_MORPH_EQUIVALENTS: Partial<
  Record<BodyType, Record<string, string>>
> = {
  cbbe: {
    heavy: "CBBE Curvy",
    thin: "CBBE Slim",
    natural: "CBBE Body",
    zapCleavage: "CBBE NeverNude Top",
  },
  "3ba": {
    heavy: "3BA Curvy",
    thin: "3BA Slim",
    muscle: "3BA Athletic",
    pregnancy: "3BA Pregnant",
    zapCleavage: "3BA Zap Cleavage",
    zapBelly: "3BA Zap Belly",
    natural: "3BA Body",
  },
  coco: {
    heavy: "COCO Body Curvy",
    thin: "COCO Body Slim",
    natural: "COCO Body",
    zapBelly: "COCO Zap Belly",
  },
  tbd: {
    heavy: "TBD Curvy",
    thin: "TBD Slim",
    natural: "TBD Body",
    zapBelly: "TBD Zap Belly",
  },
  unp: { heavy: "UNP Curvy", thin: "UNP Slim", natural: "UNP Body" },
  bhunp: {
    heavy: "BHUNP Curvy",
    thin: "BHUNP Slim",
    natural: "BHUNP Body",
    zapBelly: "BHUNP Zap Belly",
  },
  uunp: {
    heavy: "UUNP Curvy",
    thin: "UUNP Slim",
    natural: "UUNP Body",
    zapBelly: "UUNP Zap Belly",
  },
  ube: {
    heavy: "UBE Curvy",
    thin: "UBE Slim",
    natural: "UBE Body",
    zapBelly: "UBE Zap Belly",
  },
  "7base": { heavy: "7Base Curvy", thin: "7Base Slim", natural: "7Base Body" },
  himbo: {
    heavy: "HIMBO Bulk",
    thin: "HIMBO Lean",
    muscle: "HIMBO Muscular",
    pregnancy: "HIMBO Belly",
    zapCleavage: "HIMBO Chest Zap",
    zapBelly: "HIMBO Belly Zap",
    natural: "HIMBO Body",
  },
  bodytalk: {
    heavy: "BodyTalk Bulk",
    thin: "BodyTalk Lean",
    muscle: "BodyTalk Muscular",
    pregnancy: "BodyTalk Belly",
    zapCleavage: "BodyTalk Chest Zap",
    zapBelly: "BodyTalk Belly Zap",
    natural: "BodyTalk Body",
  },
  sos: {
    heavy: "SOS Bulk",
    thin: "SOS Lean",
    muscle: "SOS Muscular",
    pregnancy: "SOS Belly",
    zapCleavage: "SOS Chest Zap",
    zapBelly: "SOS Belly Zap",
    natural: "SOS Body",
  },
  sam: {
    heavy: "SAM Bulk",
    thin: "SAM Lean",
    muscle: "SAM Athletic",
    pregnancy: "SAM Belly",
    zapCleavage: "SAM Chest Zap",
    zapBelly: "SAM Belly Zap",
    natural: "SAM Body",
  },
  vanilla: {
    heavy: "Vanilla Curvy",
    thin: "Vanilla Slim",
    natural: "Vanilla Body",
  },
};

function buildBodyMetadataPatchTemplate(
  sourceBodyType: BodyType,
  targetBodyType: BodyType,
): Record<string, unknown> {
  const uniqueBodyTypes = [...new Set([sourceBodyType, targetBodyType])];

  const bodies = Object.fromEntries(
    uniqueBodyTypes.map((bodyType) => {
      const info = BODY_TYPE_INFO[bodyType];
      const sliderMappings = KNOWN_SLIDER_MAPPINGS[bodyType] ?? {
        waist: "TODO-slider-name",
        breast: "TODO-slider-name",
      };
      const morphEquivalents = KNOWN_MORPH_EQUIVALENTS[bodyType] ?? {
        heavy: "TODO-morph-name",
        natural: "TODO-morph-name",
      };

      return [
        bodyType,
        {
          topology: info.topology,
          topologyReference: `TODO-reference-project-for-${bodyType}`,
          canonicalVertexMap: `TODO-canonical-vertex-map-for-${bodyType}`,
          skeletonProfile: info.skeletonProfile,
          partitionProfile: `TODO-partition-profile-for-${bodyType}`,
          physicsBones:
            info.physicsBones.length > 0
              ? info.physicsBones
              : ["(none — no physics bones for this body type)"],
          sliderMappings,
          boneMap: {
            pelvis: "NPC Pelvis",
            spine: "NPC Spine",
          },
          morphEquivalents,
          correctiveSmoothingZones: [
            "armpit-left",
            "armpit-right",
            ...(info.gender !== "male"
              ? ["breast-left", "breast-right"]
              : ["pectoral-left", "pectoral-right"]),
            "crotch",
            "elbow-left",
            "elbow-right",
            "knee-left",
            "knee-right",
          ],
          physicsConfig: {
            cbpcCompatible: info.cbpcCompatible,
            hdtSmpCompatible: info.hdtSmpCompatible,
            softbodySupported: false,
            physicsLevel: `TODO-physics-level-for-${bodyType}`,
            boneNamingConvention: "TODO-bone-naming-convention",
            notes: info.conversionNotes.slice(0, 200),
          },
        },
      ];
    }),
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
      uniqueBodyTypes.map((bodyType) => {
        const sliderMappings = KNOWN_SLIDER_MAPPINGS[bodyType] ?? {
          waist: "TODO-slider-name",
          belly: "TODO-slider-name",
          butt: "TODO-slider-name",
          breast: "TODO-slider-name",
        };
        const morphEquivalents = KNOWN_MORPH_EQUIVALENTS[bodyType] ?? {
          heavy: "TODO-morph-name",
          thin: "TODO-morph-name",
          natural: "TODO-morph-name",
          zapBelly: "TODO-zap-name",
        };
        return [bodyType, { sliderMappings, morphEquivalents }];
      }),
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
      uniqueBodyTypes.map((bodyType) => {
        const info = BODY_TYPE_INFO[bodyType];
        const hasPhysics = info.physicsBones.length > 0;
        const physicsBones = hasPhysics
          ? info.physicsBones
          : ["(none — no physics bones for this body type)"];

        // Build a bone-map scaffold using the known first breast/butt/belly bone for this body.
        const firstLeftBreast = info.physicsBones.find(
          (b) => /breast/i.test(b) && /l\b|left/i.test(b),
        );
        const firstRightBreast = info.physicsBones.find(
          (b) => /breast/i.test(b) && /r\b|right/i.test(b),
        );
        const bellyBone =
          info.physicsBones.find((b) => /belly/i.test(b)) ?? null;
        const leftPectoral = info.physicsBones.find(
          (b) => /pectoral/i.test(b) && /l\b|left/i.test(b),
        );
        const rightPectoral = info.physicsBones.find(
          (b) => /pectoral/i.test(b) && /r\b|right/i.test(b),
        );
        const genitalBase = info.physicsBones.find((b) => /genitals/i.test(b));

        const boneMap: Record<string, string> = { pelvis: "NPC Pelvis" };
        if (firstLeftBreast) boneMap.leftBreast = firstLeftBreast;
        if (firstRightBreast) boneMap.rightBreast = firstRightBreast;
        if (bellyBone) boneMap.belly = bellyBone;
        if (leftPectoral) boneMap.leftPectoral = leftPectoral;
        if (rightPectoral) boneMap.rightPectoral = rightPectoral;
        if (genitalBase) boneMap.genitalsBase = genitalBase;

        return [
          bodyType,
          {
            physicsBones,
            boneMap,
            physicsConfig: {
              cbpcCompatible: info.cbpcCompatible,
              hdtSmpCompatible: info.hdtSmpCompatible,
              softbodySupported: false,
              physicsLevel: `TODO-physics-level-for-${bodyType}`,
              boneNamingConvention: `TODO-bone-naming-for-${bodyType}`,
              notes: info.skeletonNotes.slice(0, 200),
            },
          },
        ];
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// User-data dir helpers: write repairs to ~/.slidesmith and auto-merge DB patch
// ---------------------------------------------------------------------------

type ReferenceDbPatch = {
  bodies?: Record<string, unknown>;
  adapters?: unknown[];
};

async function mergeReferenceDbPatch(
  userDataDir: string,
  patch: ReferenceDbPatch,
): Promise<void> {
  const userDbPath = join(userDataDir, "body_reference_db.json");

  // Read existing user DB or start from an empty structure.
  let existing: { bodies?: Record<string, unknown>; adapters?: unknown[] } = {
    bodies: {},
    adapters: [],
  };
  try {
    const raw = await readFile(userDbPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as typeof existing;
    }
  } catch {
    // No existing user DB — starting fresh is fine.
  }

  // Merge bodies: patch entries override existing ones.
  if (patch.bodies && typeof patch.bodies === "object") {
    existing.bodies = { ...(existing.bodies ?? {}), ...patch.bodies };
  }

  // Append new adapters that don't already exist (match on source+target).
  if (Array.isArray(patch.adapters)) {
    const existingAdapters = Array.isArray(existing.adapters)
      ? existing.adapters
      : [];
    const adapterKey = (a: unknown) => {
      if (a && typeof a === "object") {
        const obj = a as Record<string, unknown>;
        return `${String(obj.source ?? "")}:${String(obj.target ?? "")}`;
      }
      return "";
    };
    const existingKeys = new Set(existingAdapters.map(adapterKey));
    for (const adapter of patch.adapters) {
      if (!existingKeys.has(adapterKey(adapter))) {
        existingAdapters.push(adapter);
        existingKeys.add(adapterKey(adapter));
      }
    }
    existing.adapters = existingAdapters;
  }

  await writeFile(userDbPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

async function writeToUserDataDir(
  userDataDir: string,
  fileName: string,
  content: string,
): Promise<void> {
  const repairsDir = join(userDataDir, "repairs");
  await mkdir(repairsDir, { recursive: true });
  await writeFile(join(repairsDir, fileName), content, "utf8");
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
  const checklistContent = `${checklistLines.join("\n")}\n`;
  await writeFile(
    join(repairsDir, checklistFileName),
    checklistContent,
    "utf8",
  );
  artifacts.push({
    relativePath: `_SlideSmith/repairs/${checklistFileName}`,
    description:
      "Human-readable repair checklist for follow-up conversion runs.",
  });
  if (args.userDataDir) {
    await writeToUserDataDir(
      args.userDataDir,
      checklistFileName,
      checklistContent,
    );
  }

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
    const meshContent = `${meshTemplateLines.join("\n")}\n`;
    await writeFile(
      join(repairsDir, meshTemplateFileName),
      meshContent,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${meshTemplateFileName}`,
      description: "Template guidance for restoring missing mesh pair inputs.",
    });
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        meshTemplateFileName,
        meshContent,
      );
    }
  }

  if (issues.some((issue) => issue.id === "incomplete-body-metadata")) {
    const metadataPatchFileName = "body-reference-db.patch.json";
    const patch = buildBodyMetadataPatchTemplate(
      args.sourceBodyType,
      args.targetBodyType,
    );
    const patchJson = `${JSON.stringify(patch, null, 2)}\n`;
    await writeFile(join(repairsDir, metadataPatchFileName), patchJson, "utf8");
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${metadataPatchFileName}`,
      description:
        "Metadata patch scaffold for topology, canonical maps, slider/bone/morph mappings, and adapter profiles.",
    });
    // Auto-merge into the user-data reference DB so the Python engine picks it
    // up on the next conversion run without any manual file copying.
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        metadataPatchFileName,
        patchJson,
      );
      await mergeReferenceDbPatch(
        args.userDataDir,
        patch as ReferenceDbPatch,
      ).catch(() => undefined);
    }
  }

  if (issues.some((issue) => issue.id === "missing-adapter-profile")) {
    const adapterPatchFileName = "adapter-profile-template.json";
    const adapterContent = `${JSON.stringify(
      buildAdapterProfileTemplate(args.sourceBodyType, args.targetBodyType),
      null,
      2,
    )}\n`;
    await writeFile(
      join(repairsDir, adapterPatchFileName),
      adapterContent,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${adapterPatchFileName}`,
      description:
        "Adapter-profile scaffold for high-risk body-pair automation routes.",
    });
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        adapterPatchFileName,
        adapterContent,
      );
    }
  }

  if (issues.some((issue) => issue.id === "missing-smoothing-profile")) {
    const smoothingPatchFileName = "corrective-smoothing-template.json";
    const smoothingContent = `${JSON.stringify(
      buildCorrectiveSmoothingTemplate(
        args.sourceBodyType,
        args.targetBodyType,
      ),
      null,
      2,
    )}\n`;
    await writeFile(
      join(repairsDir, smoothingPatchFileName),
      smoothingContent,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${smoothingPatchFileName}`,
      description:
        "Corrective smoothing-zone scaffold for deformation cleanup coverage.",
    });
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        smoothingPatchFileName,
        smoothingContent,
      );
    }
  }

  if (issues.some((issue) => issue.id === "incomplete-morph-mappings")) {
    const morphPatchFileName = "morph-mapping-template.json";
    const morphContent = `${JSON.stringify(
      buildMorphMappingTemplate(args.sourceBodyType, args.targetBodyType),
      null,
      2,
    )}\n`;
    await writeFile(join(repairsDir, morphPatchFileName), morphContent, "utf8");
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${morphPatchFileName}`,
      description:
        "Slider/morph mapping scaffold for zap, preset, and TRI transfer coverage.",
    });
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        morphPatchFileName,
        morphContent,
      );
    }
  }

  if (issues.some((issue) => issue.id === "incomplete-physics-metadata")) {
    const physicsPatchFileName = "physics-metadata-template.json";
    const physicsContent = `${JSON.stringify(
      buildPhysicsMetadataTemplate(args.sourceBodyType, args.targetBodyType),
      null,
      2,
    )}\n`;
    await writeFile(
      join(repairsDir, physicsPatchFileName),
      physicsContent,
      "utf8",
    );
    artifacts.push({
      relativePath: `_SlideSmith/repairs/${physicsPatchFileName}`,
      description:
        "Physics metadata scaffold for bone remaps, CBPC/HDT-SMP naming, and softbody notes.",
    });
    if (args.userDataDir) {
      await writeToUserDataDir(
        args.userDataDir,
        physicsPatchFileName,
        physicsContent,
      );
    }
  }

  return artifacts;
}
