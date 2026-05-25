import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BodyType, PythonEngineRunSummary } from "./types.js";

type RepairIssueId = "missing-nif-mesh" | "incomplete-body-metadata";

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
    /canonical vertex map is missing/i.test(value) ||
    /populate topology/i.test(value) ||
    /populate overlapping canonical/i.test(value)
  );
}

function collectRepairIssues(summary: PythonEngineRunSummary): RepairIssue[] {
  const missingNifStages = summary.stages.filter(
    (stage) =>
      hasMissingNifMessage(stage.summary) ||
      stage.details.some((detail) => hasMissingNifMessage(detail)),
  );
  const metadataStages = summary.stages.filter(
    (stage) =>
      hasIncompleteMetadataMessage(stage.summary) ||
      stage.details.some((detail) => hasIncompleteMetadataMessage(detail)),
  );

  const issues: RepairIssue[] = [];
  if (missingNifStages.length > 0) {
    issues.push({
      id: "missing-nif-mesh",
      summary:
        "No NIF mesh assets were detected for one or more Python core stages.",
      stageIds: missingNifStages.map((stage) => stage.id),
    });
  }
  if (metadataStages.length > 0) {
    issues.push({
      id: "incomplete-body-metadata",
      summary:
        "Body-pair reference metadata is incomplete for one or more transfer stages.",
      stageIds: metadataStages.map((stage) => stage.id),
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
    sliderMappings: {
      waist: "TODO-body-slider-name",
    },
    boneMap: {
      pelvis: "TODO-body-bone-name",
    },
    morphEquivalents: {
      heavy: "TODO-body-morph-name",
    },
    correctiveSmoothingZones: [
      "armpit-left",
      "armpit-right",
      "crotch",
      "elbow-left",
      "elbow-right",
      "knee-left",
      "knee-right",
    ],
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
    description: "Structured list of detected repair issues and stage coverage.",
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
    "Apply the generated templates in this folder, then rerun conversion.",
  ];
  await writeFile(
    join(repairsDir, checklistFileName),
    `${checklistLines.join("\n")}\n`,
    "utf8",
  );
  artifacts.push({
    relativePath: `_SlideSmith/repairs/${checklistFileName}`,
    description: "Human-readable repair checklist for follow-up conversion runs.",
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

  return artifacts;
}
