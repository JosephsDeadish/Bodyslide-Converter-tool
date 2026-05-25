import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import type {
  BodyType,
  ConversionAudit,
  ConversionAuditCheck,
  DetectionResult,
  ScannedFile,
} from "./types.js";

const MESH_EXTENSIONS = new Set([".nif", ".tri", ".osd"]);

function createCheck(
  id: string,
  title: string,
  status: ConversionAuditCheck["status"],
  summary: string,
  details: string[] = [],
  evidence: string[] = [],
): ConversionAuditCheck {
  return {
    id,
    title,
    status,
    summary,
    details,
    evidence,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function findMatches(haystack: string, values: string[]): string[] {
  const lower = haystack.toLowerCase();
  return values.filter((value) => lower.includes(value.toLowerCase()));
}

function isMesh(file: ScannedFile): boolean {
  return MESH_EXTENSIONS.has(file.extension);
}

function isBodySlideProject(file: ScannedFile): boolean {
  const path = file.relativePath.toLowerCase().replace(/\\/g, "/");
  return (
    file.extension === ".osp" ||
    (file.extension === ".xml" &&
      (path.includes("/slidersets/") ||
        file.preview.includes("<slidersetinfo") ||
        file.preview.includes("<sliderset ")))
  );
}

function isSliderGroup(file: ScannedFile): boolean {
  const path = file.relativePath.toLowerCase().replace(/\\/g, "/");
  return (
    file.extension === ".xml" &&
    (path.includes("/slidergroups/") ||
      file.preview.includes("<slidergroups") ||
      file.preview.includes("<slidergroup "))
  );
}

function isPhysicsConfig(file: ScannedFile): boolean {
  const path = file.relativePath.toLowerCase().replace(/\\/g, "/");
  return (
    (file.extension === ".ini" || file.extension === ".xml") &&
    (path.includes("cbpc") ||
      path.includes("hdt") ||
      path.includes("physics") ||
      file.preview.includes("cbpc") ||
      file.preview.includes("hdtphysicsextensions"))
  );
}

function extractNamedTags(preview: string, tagName: string): string[] {
  const matches = preview.matchAll(
    new RegExp(`<${tagName}\\b[^>]*name=["']([^"']+)["']`, "gi"),
  );
  return [...matches]
    .map((match) => match[1]?.trim())
    .filter(Boolean) as string[];
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

function getMissingWeightPairs(files: ScannedFile[]): string[] {
  const knownPaths = new Set(files.map((file) => file.relativePath));
  const missing: string[] = [];
  for (const file of files) {
    const counterpart = getWeightPairCounterpart(file.relativePath);
    if (counterpart && !knownPaths.has(counterpart)) {
      missing.push(file.relativePath);
    }
  }
  return unique(missing).sort();
}

function collectSliderNames(files: ScannedFile[]): string[] {
  return unique(
    files.flatMap((file) => [
      ...extractNamedTags(file.preview, "slider"),
      ...extractNamedTags(file.preview, "group"),
      ...extractNamedTags(file.preview, "sliderset"),
    ]),
  ).sort();
}

function collectPreviewPaths(files: ScannedFile[]): string[] {
  return files.map((file) => file.relativePath).sort();
}

function buildSourceAssetCheck(
  sourceFiles: ScannedFile[],
  sourceType: DetectionResult["bodyType"],
): ConversionAuditCheck {
  const meshFiles = sourceFiles.filter(isMesh);
  const sliderFiles = sourceFiles.filter(
    (file) =>
      isBodySlideProject(file) ||
      isSliderGroup(file) ||
      file.extension === ".tri" ||
      file.extension === ".osd",
  );
  const sliderNames = collectSliderNames(sourceFiles);
  const status =
    meshFiles.length > 0 && sliderFiles.length > 0 ? "pass" : "attention";

  return createCheck(
    "extract",
    "Extract source mesh and slider assets",
    status,
    `Detected ${meshFiles.length} mesh asset(s) and ${sliderFiles.length} slider asset(s) for ${sourceType}.`,
    sliderNames.length > 0
      ? [`Discovered ${sliderNames.length} named slider/group marker(s).`]
      : ["No named slider/group markers were found in the scanned previews."],
    collectPreviewPaths([...meshFiles.slice(0, 4), ...sliderFiles.slice(0, 4)]),
  );
}

function buildSkeletonCheck(
  outputFiles: ScannedFile[],
  sourceType: BodyType,
  targetType: BodyType,
): ConversionAuditCheck {
  const sourceInfo = BODY_TYPE_INFO[sourceType];
  const targetInfo = BODY_TYPE_INFO[targetType];
  const outputHaystack = outputFiles
    .map((file) => `${file.relativePath}\n${file.preview}`)
    .join("\n");
  const lingeringSourceOnlyBones = sourceInfo.physicsBones.filter(
    (bone) =>
      !targetInfo.physicsBones.includes(bone) &&
      outputHaystack.toLowerCase().includes(bone.toLowerCase()),
  );
  const targetBoneHits = findMatches(outputHaystack, targetInfo.physicsBones);
  const status =
    lingeringSourceOnlyBones.length === 0 &&
    (targetInfo.physicsBones.length === 0 || targetBoneHits.length > 0)
      ? "pass"
      : "attention";

  return createCheck(
    "remap",
    "Remap reference skeleton and bone weights",
    status,
    lingeringSourceOnlyBones.length === 0
      ? `No orphan source-only physics bone names were detected in converted previews for ${targetType.toUpperCase()}.`
      : `Found ${lingeringSourceOnlyBones.length} lingering source-only physics bone reference(s) after conversion.`,
    [
      `Detected ${targetBoneHits.length}/${targetInfo.physicsBones.length} target physics bone marker(s) in converted assets/configs.`,
      ...(lingeringSourceOnlyBones.length > 0
        ? [
            `Source-only bone references still present: ${lingeringSourceOnlyBones.join(", ")}.`,
          ]
        : []),
    ],
    unique([...targetBoneHits, ...lingeringSourceOnlyBones]).slice(0, 12),
  );
}

function buildProjectionCheck(
  sourceType: BodyType,
  targetType: BodyType,
  sourceFiles: ScannedFile[],
  outputFiles: ScannedFile[],
): ConversionAuditCheck {
  const sourceInfo = BODY_TYPE_INFO[sourceType];
  const targetInfo = BODY_TYPE_INFO[targetType];
  const sourceSliderAssets = sourceFiles.filter(
    (file) =>
      isBodySlideProject(file) ||
      file.extension === ".tri" ||
      file.extension === ".osd",
  );
  const outputSliderAssets = outputFiles.filter(
    (file) =>
      isBodySlideProject(file) ||
      file.extension === ".tri" ||
      file.extension === ".osd",
  );
  const sameTopology = sourceInfo.topology === targetInfo.topology;
  const status =
    sameTopology && outputSliderAssets.length >= sourceSliderAssets.length
      ? "pass"
      : "attention";

  return createCheck(
    "project",
    "Project morphs onto target topology",
    status,
    sameTopology
      ? `${sourceType.toUpperCase()} and ${targetType.toUpperCase()} share '${targetInfo.topology}' topology, so slider/morph assets can stay on the same base topology.`
      : `Topology differs (${sourceInfo.topology} → ${targetInfo.topology}); converted slider assets were generated, so verify projection quality in BodySlide preview and in-game.`,
    [
      `Source slider-like assets: ${sourceSliderAssets.length}.`,
      `Converted slider-like assets: ${outputSliderAssets.length}.`,
    ],
    collectPreviewPaths(outputSliderAssets.slice(0, 6)),
  );
}

function buildSliderSetCheck(outputFiles: ScannedFile[]): ConversionAuditCheck {
  const projects = outputFiles.filter(isBodySlideProject);
  const groups = outputFiles.filter(isSliderGroup);
  const missingWeightPairs = getMissingWeightPairs(outputFiles);
  const sliderNames = collectSliderNames(outputFiles);
  const status =
    projects.length > 0 && missingWeightPairs.length === 0
      ? "pass"
      : "attention";

  return createCheck(
    "generate",
    "Generate BodySlide slider set",
    status,
    `Generated ${projects.length} BodySlide project file(s) and ${groups.length} slider-group file(s).`,
    [
      `Named slider/group markers found in output: ${sliderNames.length}.`,
      missingWeightPairs.length === 0
        ? "All detected _0/_1 mesh or morph weight pairs are complete in the output."
        : `Missing output weight-pair counterparts for: ${missingWeightPairs.join(", ")}.`,
    ],
    collectPreviewPaths([...projects.slice(0, 4), ...groups.slice(0, 4)]),
  );
}

function buildSeamCheck(
  sourceType: BodyType,
  targetType: BodyType,
  outputFiles: ScannedFile[],
): ConversionAuditCheck {
  const sourceInfo = BODY_TYPE_INFO[sourceType];
  const targetInfo = BODY_TYPE_INFO[targetType];
  const missingWeightPairs = getMissingWeightPairs(outputFiles);
  const status =
    sourceInfo.topology === targetInfo.topology &&
    missingWeightPairs.length === 0
      ? "pass"
      : "attention";

  return createCheck(
    "validate",
    "Validate clipping and seam integrity",
    status,
    missingWeightPairs.length === 0
      ? "No incomplete weight-slider mesh pairs were detected in the converted output."
      : `Found ${missingWeightPairs.length} incomplete weight-slider output pair(s).`,
    [
      `Topology route: ${sourceInfo.topology} → ${targetInfo.topology}.`,
      "Native validation checks asset completeness and topology risk, but in-game seam/clipping smoke tests are still recommended for neck, wrist, ankle, bust, waist, and hips.",
    ],
  );
}

function buildBodyKnowledgeCheck(
  sourceType: BodyType,
  targetType: BodyType,
): ConversionAuditCheck {
  const sourceInfo = BODY_TYPE_INFO[sourceType];
  const targetInfo = BODY_TYPE_INFO[targetType];
  const crossGender =
    sourceInfo.gender !== targetInfo.gender &&
    sourceInfo.gender !== "both" &&
    targetInfo.gender !== "both";
  const topologyDiffers = sourceInfo.topology !== targetInfo.topology;
  const status: ConversionAuditCheck["status"] =
    crossGender || topologyDiffers ? "attention" : "pass";
  const fitFocus = targetInfo.adaptationFocus.slice(0, 6);

  return createCheck(
    "fit-profile",
    "Validate body-type fit profile",
    status,
    `Target ${targetType.toUpperCase()} fit focus: ${fitFocus.join(", ")}.`,
    [
      `Route context: ${sourceType.toUpperCase()} (${sourceInfo.gender}/${sourceInfo.topology}) → ${targetType.toUpperCase()} (${targetInfo.gender}/${targetInfo.topology}).`,
      `Target skeleton profile: ${targetInfo.skeletonProfile}.`,
      `Skeleton guidance: ${targetInfo.skeletonNotes}`,
      `Target guidance: ${targetInfo.conversionNotes}`,
      ...(crossGender
        ? [
            "Cross-gender conversion detected: run extra in-game checks on chest, shoulder, waist, pelvis, and first-person body-part transitions.",
          ]
        : []),
      ...(topologyDiffers
        ? [
            "Topology differs between source and target: run seam QA at neck, wrists, ankles, and weight extremes using BodySlide preview plus in-game checks.",
          ]
        : []),
    ],
    fitFocus,
  );
}

function buildPhysicsWeightCheck(
  outputFiles: ScannedFile[],
  targetType: BodyType,
) {
  const targetInfo = BODY_TYPE_INFO[targetType];
  if (!targetInfo.physicsSupport) {
    return createCheck(
      "physics-weight",
      `Add physics bone weighting (${targetType.toUpperCase()})`,
      "not-applicable",
      `${targetType.toUpperCase()} does not use physics bone weighting.`,
    );
  }

  const label = targetType.toUpperCase();
  const outputHaystack = outputFiles
    .filter((file) => isMesh(file) || isPhysicsConfig(file))
    .map((file) => `${file.relativePath}\n${file.preview}`)
    .join("\n");
  const hits = findMatches(outputHaystack, targetInfo.physicsBones);
  const status =
    hits.length === targetInfo.physicsBones.length ? "pass" : "attention";

  return createCheck(
    "physics-weight",
    `Add physics bone weighting (${label})`,
    status,
    `Detected ${hits.length}/${targetInfo.physicsBones.length} required ${label} physics bone marker(s) across converted meshes/configs.`,
    hits.length === targetInfo.physicsBones.length
      ? [
          `All required ${label} physics bone chain names were detected in converted assets.`,
        ]
      : [
          `Missing ${label} physics markers: ${targetInfo.physicsBones.filter((bone) => !hits.includes(bone)).join(", ")}.`,
        ],
    hits,
  );
}

function buildPhysicsConfigCheck(
  outputFiles: ScannedFile[],
  targetType: BodyType,
): ConversionAuditCheck {
  const targetInfo = BODY_TYPE_INFO[targetType];
  if (!targetInfo.physicsSupport) {
    return createCheck(
      "physics-config",
      "Verify CBPC / HDT-SMP physics config",
      "not-applicable",
      `${targetType.toUpperCase()} does not require a physics config audit.`,
    );
  }

  const configFiles = outputFiles.filter(isPhysicsConfig);
  const configHaystack = configFiles
    .map((file) => `${file.relativePath}\n${file.preview}`)
    .join("\n");
  const hits = findMatches(configHaystack, targetInfo.physicsBones);
  const missingBones = targetInfo.physicsBones.filter(
    (bone) => !hits.includes(bone),
  );
  const status =
    configFiles.length > 0 && missingBones.length === 0 ? "pass" : "attention";

  return createCheck(
    "physics-config",
    "Verify CBPC / HDT-SMP physics config",
    status,
    configFiles.length > 0
      ? missingBones.length === 0
        ? `Detected ${configFiles.length} converted physics config file(s) with full target-bone coverage (${hits.length}/${targetInfo.physicsBones.length}).`
        : `Detected ${configFiles.length} converted physics config file(s), but only ${hits.length}/${targetInfo.physicsBones.length} required target bone marker(s) were found.`
      : `No converted physics config file was found for ${targetType.toUpperCase()}.`,
    configFiles.length > 0
      ? [
          `Target physics bones referenced in configs: ${hits.length}/${targetInfo.physicsBones.length}.`,
          ...(missingBones.length > 0
            ? [
                `Missing target bone markers in config output: ${missingBones.join(", ")}.`,
              ]
            : []),
        ]
      : [
          "If the outfit depends on local CBPC/HDT-SMP rules, generate or verify the corresponding config before release.",
        ],
    collectPreviewPaths(configFiles.slice(0, 6)),
  );
}

function buildBellyCheck(outputFiles: ScannedFile[], targetType: BodyType) {
  if (targetType !== "3ba" && targetType !== "coco") {
    return createCheck(
      "3ba-belly",
      "Add 3BA/COCO belly physics group",
      "not-applicable",
      "3BA/COCO belly validation is only required when targeting 3BA or COCO.",
    );
  }

  const label = targetType.toUpperCase();
  const haystack = outputFiles
    .filter((file) => isMesh(file) || isPhysicsConfig(file))
    .map((file) => `${file.relativePath}\n${file.preview}`)
    .join("\n");
  const hits = findMatches(haystack, ["NPC Belly", "NPC BellyRoot"]);
  const status = hits.length === 2 ? "pass" : "attention";

  return createCheck(
    "3ba-belly",
    `Add ${label} belly physics group`,
    status,
    hits.length === 2
      ? "Detected both NPC Belly and NPC BellyRoot markers in converted assets/configs."
      : "Could not confirm both NPC Belly and NPC BellyRoot markers in converted assets/configs.",
    hits.length === 2
      ? [
          `${label} belly chain markers were detected for both the mesh/config pass.`,
        ]
      : [
          `${label} belly support needs both NPC Belly and NPC BellyRoot references for full coverage.`,
        ],
    hits,
  );
}

function buildSliderGroupCheck(
  outputFiles: ScannedFile[],
): ConversionAuditCheck {
  const groups = outputFiles.filter(isSliderGroup);
  const projects = outputFiles.filter(isBodySlideProject);
  const status: ConversionAuditCheck["status"] =
    projects.length === 0 || groups.length > 0 ? "pass" : "attention";

  return createCheck(
    "slider-group",
    "BodySlide SliderGroup registration",
    status,
    projects.length === 0
      ? "No BodySlide project files were found; SliderGroup registration is not required."
      : groups.length > 0
        ? `Detected ${groups.length} SliderGroup file(s) — outfit will appear in BodySlide's group list.`
        : "No SliderGroup XML was found. The outfit may not appear in BodySlide's left-hand panel.",
    groups.length === 0 && projects.length > 0
      ? [
          "A SliderGroup XML should be present in CalienteTools/BodySlide/SliderGroups/.",
          "Without it, the converted outfit will be listed under 'Unassigned' in BodySlide.",
          "The converter synthesizes a SliderGroup automatically; if it is missing, check for write errors in the output directory.",
        ]
      : [],
    collectPreviewPaths(groups.slice(0, 4)),
  );
}

function buildCbpcStubCheck(
  outputFiles: ScannedFile[],
  targetType: BodyType,
): ConversionAuditCheck {
  const targetInfo = BODY_TYPE_INFO[targetType];
  if (!targetInfo.physicsSupport) {
    return createCheck(
      "cbpc-stub",
      "CBPC physics config completeness",
      "not-applicable",
      `${targetType.toUpperCase()} does not use CBPC physics; no stub check needed.`,
    );
  }

  const configFiles = outputFiles.filter(isPhysicsConfig);
  const stubFiles = configFiles.filter((f) =>
    f.relativePath.toLowerCase().includes("physicsstub"),
  );
  const originalConfigs = configFiles.filter(
    (f) => !f.relativePath.toLowerCase().includes("physicsstub"),
  );

  const status: ConversionAuditCheck["status"] =
    originalConfigs.length > 0 ? "pass" : "attention";

  return createCheck(
    "cbpc-stub",
    "CBPC physics config completeness",
    status,
    originalConfigs.length > 0
      ? `Source mod included ${originalConfigs.length} physics config file(s); bone remapping was applied.`
      : stubFiles.length > 0
        ? "No source physics config was found — a starter stub was generated. Validate runtime motion in BodySlide preview and in-game after build."
        : "No physics config was found or generated. Add CBPC/HDT-SMP rules manually if runtime physics are required.",
    [
      originalConfigs.length > 0
        ? "Physics config files from the source mod were remapped to target bone names."
        : "If the source outfit lacked physics bone weighting in its NIF meshes, the generated stub alone cannot activate runtime physics.",
      "Confirm generated outputs include target physics bones and pass in-game motion checks.",
    ],
    collectPreviewPaths(configFiles.slice(0, 4)),
  );
}

export function createConversionAudit(
  detection: DetectionResult,
  targetType: BodyType,
  sourceFiles: ScannedFile[],
  outputFiles: ScannedFile[],
): ConversionAudit {
  if (detection.bodyType === "unknown") {
    return {
      overallStatus: "attention",
      checks: [
        createCheck(
          "detect-source",
          "Detect source body type",
          "attention",
          "Source body type is unknown, so full conversion auditing could not be completed.",
        ),
      ],
    };
  }

  const sourceType = detection.bodyType;
  const checks = [
    buildSourceAssetCheck(sourceFiles, sourceType),
    buildSkeletonCheck(outputFiles, sourceType, targetType),
    buildProjectionCheck(sourceType, targetType, sourceFiles, outputFiles),
    buildSliderSetCheck(outputFiles),
    buildSliderGroupCheck(outputFiles),
    buildSeamCheck(sourceType, targetType, outputFiles),
    buildBodyKnowledgeCheck(sourceType, targetType),
    buildPhysicsWeightCheck(outputFiles, targetType),
    buildPhysicsConfigCheck(outputFiles, targetType),
    buildCbpcStubCheck(outputFiles, targetType),
    buildBellyCheck(outputFiles, targetType),
  ];

  return {
    overallStatus: checks.some((check) => check.status === "attention")
      ? "attention"
      : "pass",
    checks,
  };
}
