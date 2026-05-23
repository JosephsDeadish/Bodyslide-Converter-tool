import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createConversionAudit } from "./audit.js";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { scanModFiles } from "./scanner.js";
import type {
  BodyType,
  ConversionResult,
  DetectionResult,
  ScannedFile,
} from "./types.js";

const TEXT_EXTENSIONS = new Set([".xml", ".osp", ".txt", ".json", ".ini"]);
const MESH_EXTENSIONS = new Set([".nif", ".tri", ".osd"]);

// ── MO2 / Skyrim Data canonical root prefixes ──────────────────────────────
// Any path already rooted under one of these is left exactly where it is.
// Paths that fall outside these roots are remapped to the correct location so
// that Mod Organizer 2 — which treats each mod folder as the Skyrim Data root
// via its virtual file system — can load the files automatically.
const CANONICAL_DATA_PREFIXES: readonly string[] = [
  "meshes/",
  "textures/",
  "calientetools/",
  "scripts/",
  "skse/",
  "interface/",
  "music/",
  "sound/",
  "seq/",
  "strings/",
  "video/",
  "shadersfx/",
  "lodsettings/",
  "grass/",
  "terrain/",
  "facegen/",
];
const DATA_CONTAINER_PREFIXES: readonly string[] = ["data/", "data files/"];

// BodySlide XML slider-group files contain one of these markers at the top.
const BODYSLIDE_SLIDERGROUP_XML_MARKERS: readonly string[] = [
  "<slidergroups",
  "<slidergroup ",
  "<slidergroup>",
];

// BodySlide XML project files (equivalent to .osp) use SliderSetInfo as the root.
const BODYSLIDE_PROJECT_XML_MARKERS: readonly string[] = [
  "<slidersetinfo",
  "<sliderset ",
  "<sliderset>",
];

/**
 * Remaps a rewritten relative path to its canonical Skyrim Data location so
 * that MO2 picks it up automatically when the output folder is set as a mod.
 *
 * Rules (applied only when the path is NOT already under a canonical root):
 *   .osp          → CalienteTools/BodySlide/SliderSets/<filename>
 *   .xml (BS)     → CalienteTools/BodySlide/SliderGroups/<filename>
 *   .nif / .tri   → meshes/<original-relative-path>
 *   everything else → unchanged (non-game asset; kept where it is)
 */
function normalizeToMo2DataPath(
  rewrittenPath: string,
  extension: string,
  preview: string,
): string {
  // Normalise separators to forward-slashes and strip common archive container roots.
  let forward = rewrittenPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  while (
    DATA_CONTAINER_PREFIXES.some((prefix) =>
      forward.toLowerCase().startsWith(prefix),
    )
  ) {
    const matchingPrefix = DATA_CONTAINER_PREFIXES.find((prefix) =>
      forward.toLowerCase().startsWith(prefix),
    );
    if (!matchingPrefix) break;
    forward = forward.slice(matchingPrefix.length);
  }
  const lower = forward.toLowerCase();

  // Already in a canonical data root — preserve path as-is.
  if (
    CANONICAL_DATA_PREFIXES.some((prefix) =>
      lower.startsWith(prefix.toLowerCase()),
    )
  ) {
    return forward;
  }

  // .osp → BodySlide slider-set definition; must live in SliderSets/
  if (extension === ".osp") {
    return `CalienteTools/BodySlide/SliderSets/${basename(forward)}`;
  }

  // .xml → route BodySlide project XMLs (<SliderSetInfo>) to SliderSets/,
  //        route BodySlide group XMLs (<SliderGroups>) to SliderGroups/,
  //        leave all other XMLs (MCM, physics, …) unchanged
  if (extension === ".xml") {
    if (
      BODYSLIDE_PROJECT_XML_MARKERS.some((marker) => preview.includes(marker))
    ) {
      return `CalienteTools/BodySlide/SliderSets/${basename(forward)}`;
    }
    const xmlLooksLikeBodySlideGroup = BODYSLIDE_SLIDERGROUP_XML_MARKERS.some(
      (marker) => preview.includes(marker),
    );
    if (xmlLooksLikeBodySlideGroup) {
      return `CalienteTools/BodySlide/SliderGroups/${basename(forward)}`;
    }
    if (
      /(^|\/)calientetools\/bodyslide\/slidersets\//.test(lower) ||
      /(^|\/)bodyslide\/slidersets\//.test(lower) ||
      /(^|\/)slidersets\//.test(lower)
    ) {
      return `CalienteTools/BodySlide/SliderSets/${basename(forward)}`;
    }
    if (
      /(^|\/)calientetools\/bodyslide\/slidergroups\//.test(lower) ||
      /(^|\/)bodyslide\/slidergroups\//.test(lower) ||
      /(^|\/)slidergroups\//.test(lower)
    ) {
      return `CalienteTools/BodySlide/SliderGroups/${basename(forward)}`;
    }
    return forward;
  }

  // .nif / .tri / .osd → armor/clothing/body meshes must live under meshes/
  if (extension === ".nif" || extension === ".tri" || extension === ".osd") {
    return `meshes/${forward}`;
  }

  // All other file types: keep relative path unchanged.
  return forward;
}

type ConversionPath = {
  label: string;
  namingNotes: string[];
};

const FEMALE_FAMILIES = new Set(["cbbe", "unp"]);
const MALE_FAMILIES = new Set(["male", "addon"]);

const CROSS_GENDER_NOTES = [
  "Rewrites target aliases plus common female/male asset markers in file names and metadata.",
  "Applies automatic path and metadata adaptation to reduce cross-gender setup work before BodySlide preview and in-game fit checks.",
];

const FAMILY_PATHS = {
  cbbe: {
    label: "CBBE ↔ 3BA ↔ TBD",
    namingNotes: [
      "Uses canonical CBBE-family output aliases in rewritten file names and BodySlide metadata.",
      "Applies automatic CBBE-family metadata harmonization for cleaner in-game fit defaults.",
    ],
  },
  unp: {
    label: "UNP ↔ UUNP ↔ BHUNP ↔ 7Base",
    namingNotes: [
      "Uses canonical UNP-family output aliases, including UUNP/BHUNP/7Base naming signals where available.",
      "UNP-family compatibility mode applies automatic naming and config harmonization; legacy 7Base outputs remain higher-risk.",
    ],
  },
  male: {
    label: "HIMBO ↔ SAM ↔ BodyTalk ↔ SOS",
    namingNotes: [
      "Uses canonical male-body output aliases for HIMBO, SAM, BodyTalk, and SOS style projects.",
      "Male-family compatibility mode applies automatic metadata and physics-reference harmonization where possible.",
    ],
  },
} satisfies Record<"cbbe" | "unp" | "male", ConversionPath>;

const BODY_TYPE_OUTPUT_ALIASES: Record<BodyType, string> = {
  cbbe: "CBBE",
  "3ba": "3BA",
  himbo: "HIMBO",
  bodytalk: "BodyTalk",
  tbd: "TBD",
  sos: "SOS",
  unp: "UNP",
  bhunp: "BHUNP",
  uunp: "UUNP",
  "7base": "7Base",
  sam: "SAM",
  vanilla: "Vanilla",
};

const BODY_TYPE_ALIASES: Record<BodyType, string[]> = {
  cbbe: [
    "cbbe body special",
    "cbbe body",
    "cbbe-body",
    "cbbe_body",
    "cbbebody",
    "cbbe",
    "caliente beautiful bodies",
    "caliente body",
    "calientebody",
    "caliente",
  ],
  "3ba": [
    "cbbe 3bbb amazing body",
    "cbbe 3bbb amazing",
    "cbbe physics body",
    "cbbe physics",
    "3bbb amazing body",
    "3bbb amazing",
    "cbbe 3bbb",
    "cbbe 3ba",
    "cbbe smp body",
    "cbbe smp",
    "cbbe_3ba",
    "cbbe-3ba",
    "cbbe_physics",
    "cbbe-physics",
    "cbbe_smp",
    "cbbe-smp",
    "3bbbbody",
    "3bbb_body",
    "3ba body",
    "3bbb",
    "3ba",
  ],
  himbo: [
    "highly improved male body overhaul",
    "highly improved male body",
    "high poly male body",
    "highpolymalebody",
    "himbo body",
    "himbo-body",
    "himbo",
  ],
  bodytalk: [
    "bodytalk v3",
    "bodytalk v2",
    "bodytalkv3",
    "bodytalkv2",
    "bodytalk body",
    "bodytalk_body",
    "bodytalk3",
    "bodytalk",
    "bt3",
  ],
  tbd: [
    "touched by dibella",
    "touchedbydibella",
    "tbd body",
    "tbd_body",
    "tbd",
  ],
  sos: [
    "schlongs of skyrim",
    "schlongsofskyrim",
    "sos regular",
    "sos light",
    "sos body",
    "sos",
  ],
  unp: [
    "dimonized unp female body",
    "unp female body renewed",
    "dimonized",
    "unpb body",
    "unpb",
    "unp body",
    "unp_body",
    "unp",
  ],
  bhunp: [
    "bonehunger unp 3bbb",
    "bonehunger unp",
    "unp next generation",
    "bhunp 3bbb body",
    "bhunp 3bbb",
    "bhunp body",
    "bhunp_body",
    "bhunp",
  ],
  uunp: [
    "unified unp special",
    "unified unp",
    "uunp special",
    "uunp body",
    "uunp_body",
    "uunp",
  ],
  "7base": [
    "sevenbase bombshell",
    "sevenbase oppai",
    "7base body",
    "7base_body",
    "7base",
    "sevenbase",
    "seven base",
  ],
  sam: [
    "shape atlas for men",
    "sam light body",
    "samlightbase",
    "sam light",
    "samlight",
    "sam body",
    "sam",
  ],
  vanilla: ["base game body", "default body", "vanilla body", "vanilla"],
};

const FEMALE_TO_MALE_MARKERS = [
  ["1stpersonfemalehands", "1stpersonmalehands"],
  ["femalehands", "malehands"],
  ["femalefeet", "malefeet"],
  ["femalebody", "malebody"],
  ["femalehead", "malehead"],
  ["female_", "male_"],
  ["_female", "_male"],
  ["-female", "-male"],
  ["female-", "male-"],
  ["_f_", "_m_"],
  ["-f-", "-m-"],
] as const;

const MALE_TO_FEMALE_MARKERS = FEMALE_TO_MALE_MARKERS.map(
  ([female, male]) => [male, female] as const,
);

function hasFamilyPath(
  family: (typeof BODY_TYPE_INFO)[BodyType]["family"],
): family is keyof typeof FAMILY_PATHS {
  return family in FAMILY_PATHS;
}

function getGender(bodyType: BodyType): "female" | "male" | "both" {
  return BODY_TYPE_INFO[bodyType].gender;
}

function rewriteGenderMarkers(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  const sourceGender = getGender(source);
  const targetGender = getGender(target);

  if (
    sourceGender === targetGender ||
    sourceGender === "both" ||
    targetGender === "both"
  ) {
    return value;
  }

  const replacements =
    sourceGender === "female" && targetGender === "male"
      ? FEMALE_TO_MALE_MARKERS
      : MALE_TO_FEMALE_MARKERS;

  return replacements.reduce(
    (next, [from, to]) =>
      next.replaceAll(new RegExp(escapeRegExp(from), "gi"), to),
    value,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasPattern(alias: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, "gi");
}

function replaceAliases(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  let next = value;
  const aliases = [...new Set(BODY_TYPE_ALIASES[source])].sort(
    (left, right) => right.length - left.length,
  );

  for (const alias of aliases) {
    const pattern = buildAliasPattern(alias);
    next = next.replace(pattern, BODY_TYPE_OUTPUT_ALIASES[target]);
  }

  return next;
}

// Semantic physics bone mappings for known body type pairs.
// Checked first in replacePhysicsReferences before falling back to index-based matching.
// Source bone names are matched case-insensitively; target bone names are applied verbatim.
const EXPLICIT_PHYSICS_BONE_MAPS: Partial<
  Record<BodyType, Partial<Record<BodyType, Readonly<Record<string, string>>>>>
> = {
  "3ba": {
    bhunp: {
      "NPC L Breast01": "BHUNP Breast L01",
      "NPC R Breast01": "BHUNP Breast R01",
      "NPC L Breast02": "BHUNP Breast L02",
      "NPC R Breast02": "BHUNP Breast R02",
      "NPC L Breast03": "BHUNP Breast L03",
      "NPC R Breast03": "BHUNP Breast R03",
      "NPC LBreastRoot": "BHUNP Breast L01",
      "NPC RBreastRoot": "BHUNP Breast R01",
      "NPC L Butt": "BHUNP Butt L",
      "NPC R Butt": "BHUNP Butt R",
      // NPC Belly is the same bone in both bodies — no remapping needed
      // NPC BellyRoot is 3BA-specific — collapse it to NPC Belly for BHUNP
      "NPC BellyRoot": "NPC Belly",
    },
    // TBD shares the 3BA bone names (minus BreastRoot) — same map applies
    tbd: {
      "NPC LBreastRoot": "NPC L Breast01",
      "NPC RBreastRoot": "NPC R Breast01",
      "NPC BellyRoot": "NPC Belly",
    },
  },
  bhunp: {
    "3ba": {
      "BHUNP Breast L01": "NPC L Breast01",
      "BHUNP Breast R01": "NPC R Breast01",
      "BHUNP Breast L02": "NPC L Breast02",
      "BHUNP Breast R02": "NPC R Breast02",
      "BHUNP Breast L03": "NPC L Breast03",
      "BHUNP Breast R03": "NPC R Breast03",
      "BHUNP Butt L": "NPC L Butt",
      "BHUNP Butt R": "NPC R Butt",
    },
    // TBD shares the same physics bone names as standard CBBE (no BreastRoot)
    tbd: {
      "BHUNP Breast L01": "NPC L Breast01",
      "BHUNP Breast R01": "NPC R Breast01",
      "BHUNP Breast L02": "NPC L Breast02",
      "BHUNP Breast R02": "NPC R Breast02",
      "BHUNP Breast L03": "NPC L Breast03",
      "BHUNP Breast R03": "NPC R Breast03",
      "BHUNP Butt L": "NPC L Butt",
      "BHUNP Butt R": "NPC R Butt",
    },
  },
  tbd: {
    bhunp: {
      "NPC L Breast01": "BHUNP Breast L01",
      "NPC R Breast01": "BHUNP Breast R01",
      "NPC L Breast02": "BHUNP Breast L02",
      "NPC R Breast02": "BHUNP Breast R02",
      "NPC L Breast03": "BHUNP Breast L03",
      "NPC R Breast03": "BHUNP Breast R03",
      "NPC L Butt": "BHUNP Butt L",
      "NPC R Butt": "BHUNP Butt R",
    },
    "3ba": {
      // TBD bones are subset of 3BA; no remapping of names needed
      // but NPC Belly stays as NPC Belly in 3BA too
    },
  },
};

function replacePhysicsReferences(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  if (source === target) return value;

  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];
  let next = value;

  if (sourceInfo.physicsBones.length === 0) return next;

  // Use explicit semantic mapping when available — avoids index-alignment errors.
  const explicitMap = EXPLICIT_PHYSICS_BONE_MAPS[source]?.[target];
  if (explicitMap !== undefined) {
    for (const [sourceBone, targetBone] of Object.entries(explicitMap)) {
      next = next.replaceAll(
        new RegExp(escapeRegExp(sourceBone), "gi"),
        targetBone,
      );
    }
    // Any source physics bones not covered by the explicit map: collapse to
    // static fallbacks when the target has no physics.
    if (targetInfo.physicsBones.length === 0) {
      const mappedKeys = new Set(
        Object.keys(explicitMap).map((k) => k.toLowerCase()),
      );
      for (const sourceBone of sourceInfo.physicsBones) {
        if (!mappedKeys.has(sourceBone.toLowerCase())) {
          const fallback = getStaticFallbackBone(sourceBone);
          next = next.replaceAll(
            new RegExp(escapeRegExp(sourceBone), "gi"),
            fallback,
          );
        }
      }
    }
    return next;
  }

  const canUseIndexedPhysicsMapping =
    targetInfo.physicsBones.length > 0 &&
    sourceInfo.gender === targetInfo.gender &&
    sourceInfo.family === targetInfo.family &&
    sourceInfo.topology === targetInfo.topology;

  // Index-based fallback for same-family/topology pairs without explicit maps.
  if (canUseIndexedPhysicsMapping) {
    const pairCount = Math.min(
      sourceInfo.physicsBones.length,
      targetInfo.physicsBones.length,
    );
    for (let index = 0; index < pairCount; index += 1) {
      const sourceBone = sourceInfo.physicsBones[index];
      const targetBone = targetInfo.physicsBones[index];
      if (!sourceBone || !targetBone) continue;
      next = next.replaceAll(
        new RegExp(escapeRegExp(sourceBone), "gi"),
        targetBone,
      );
    }
  } else {
    // No reliable target mapping exists — collapse source physics bones to static fallbacks.
    for (const sourceBone of sourceInfo.physicsBones) {
      const fallback = getStaticFallbackBone(sourceBone);
      next = next.replaceAll(
        new RegExp(escapeRegExp(sourceBone), "gi"),
        fallback,
      );
    }
  }

  return next;
}

function getStaticFallbackBone(physicsBoneName: string): string {
  const bone = physicsBoneName.toLowerCase();
  if (bone.includes("breast")) return "NPC Spine2";
  if (bone.includes("butt")) return "NPC Pelvis";
  if (bone.includes("belly")) return "NPC Belly";
  if (bone.includes("genitals")) return "NPC Pelvis";
  return "NPC Spine2";
}

// ── XML / text helpers for BodySlide synthesis ─────────────────────────────

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c] ?? c,
  );
}

// Matches a `name="…"` or `name='…'` attribute inside a <SliderSet …> opening tag.
const SLIDERSET_NAME_RE = /<SliderSet\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi;

function extractSliderSetNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(SLIDERSET_NAME_RE)) {
    if (match[1]) names.push(match[1].trim());
  }
  return names;
}

function makeBodySlideDisplayName(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildSliderSetDisplayName(
  key: string,
  targetAlias: string,
  includeParentContext = false,
): string {
  const segments = key.split("/").filter(Boolean);
  const baseName = segments.at(-1) ?? key;
  const withContext =
    includeParentContext && segments.length > 1
      ? `${segments.at(-2)} ${baseName}`
      : baseName;
  const displayNameRaw = makeBodySlideDisplayName(withContext);
  return displayNameRaw.toLowerCase().startsWith(targetAlias.toLowerCase())
    ? displayNameRaw
    : `${targetAlias} ${displayNameRaw}`;
}

type SliderSetMeshGroup = {
  key: string;
  lowWeightPath: string | null;
  highWeightPath: string | null;
};

function collectSliderSetMeshGroups(
  convertedFiles: ConversionResult["convertedFiles"],
): SliderSetMeshGroup[] {
  const groups = new Map<string, SliderSetMeshGroup>();
  for (const file of convertedFiles) {
    if (
      file.kind !== "mesh" ||
      !file.outputPath.toLowerCase().endsWith(".nif")
    ) {
      continue;
    }
    const lower = file.outputPath.toLowerCase();
    const lowMatch = lower.match(/^(.*)_0\.nif$/);
    const highMatch = lower.match(/^(.*)_1\.nif$/);
    const key = (lowMatch?.[1] ?? highMatch?.[1] ?? lower).toLowerCase();
    const group = groups.get(key) ?? {
      key: file.outputPath.replace(/_0\.nif$/i, "").replace(/_1\.nif$/i, ""),
      lowWeightPath: null,
      highWeightPath: null,
    };
    if (lowMatch) {
      group.lowWeightPath = file.outputPath;
    } else if (highMatch) {
      group.highWeightPath = file.outputPath;
    } else {
      group.lowWeightPath ??= file.outputPath;
      group.highWeightPath ??= file.outputPath;
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

/**
 * Synthesizes a BodySlide SliderSet .osp project when converted output includes
 * meshes but no BodySlide project definition files. This enables BodySlide-only
 * workflows without requiring separate manual project-authoring steps.
 */
async function synthesizeMissingSliderSetProject(
  outputDir: string,
  targetBodyType: BodyType,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<number> {
  const hasProject = convertedFiles.some(
    (f) =>
      f.kind === "text" &&
      (f.outputPath.endsWith(".osp") ||
        (f.outputPath.endsWith(".xml") &&
          /\/slidersets\//i.test(f.outputPath))),
  );
  if (hasProject) return 0;

  const meshGroups = collectSliderSetMeshGroups(convertedFiles);
  if (meshGroups.length === 0) return 0;

  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[targetBodyType];
  const baseDisplayNames = meshGroups.map((group) =>
    buildSliderSetDisplayName(group.key, targetAlias),
  );
  const baseDisplayNameCounts = new Map<string, number>();
  for (const name of baseDisplayNames) {
    const lower = name.toLowerCase();
    baseDisplayNameCounts.set(
      lower,
      (baseDisplayNameCounts.get(lower) ?? 0) + 1,
    );
  }
  const sliderSetEntries = meshGroups
    .map((group, index) => {
      const baseDisplayName = baseDisplayNames[index] ?? "";
      const needsContext =
        (baseDisplayNameCounts.get(baseDisplayName.toLowerCase()) ?? 0) > 1;
      const displayName = needsContext
        ? buildSliderSetDisplayName(group.key, targetAlias, true)
        : baseDisplayName;
      const lowPath = group.lowWeightPath ?? group.highWeightPath;
      const highPath = group.highWeightPath ?? group.lowWeightPath;
      if (!lowPath || !highPath) return "";
      return [
        `  <SliderSet name="${escapeXml(displayName)}">`,
        `    <OutputPath>${escapeXml(lowPath)}</OutputPath>`,
        `    <OutputPathLow>${escapeXml(lowPath)}</OutputPathLow>`,
        `    <OutputPathHigh>${escapeXml(highPath)}</OutputPathHigh>`,
        "  </SliderSet>",
      ].join("\n");
    })
    .filter(Boolean);

  if (sliderSetEntries.length === 0) return 0;

  const fileName = `${targetAlias}_AutoConverted.osp`;
  const outputRelPath = `CalienteTools/BodySlide/SliderSets/${fileName}`;
  const outputAbsPath = join(
    outputDir,
    "CalienteTools",
    "BodySlide",
    "SliderSets",
    fileName,
  );

  const ospContent = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<SliderSetInfo>",
    ...sliderSetEntries,
    "</SliderSetInfo>",
    "",
  ].join("\n");

  await mkdir(dirname(outputAbsPath), { recursive: true });
  await writeFile(outputAbsPath, ospContent, "utf8");

  convertedFiles.push({
    sourcePath: "(native post-process)",
    outputPath: outputRelPath,
    kind: "text",
    action: "synthesized",
  });

  return sliderSetEntries.length;
}

/**
 * Synthesizes a BodySlide SliderGroup XML into the output directory whenever
 * the conversion produced BodySlide project files (OSP / SliderSetInfo XML)
 * but no SliderGroup XML.  Without a group registration BodySlide cannot list
 * the converted outfit in its left-hand panel.
 */
async function synthesizeMissingSliderGroup(
  outputDir: string,
  targetBodyType: BodyType,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<void> {
  const projectFiles = convertedFiles.filter(
    (f) =>
      f.kind === "text" &&
      (f.outputPath.endsWith(".osp") ||
        (f.outputPath.endsWith(".xml") &&
          /\/slidersets\//i.test(f.outputPath))),
  );
  const hasSliderGroup = convertedFiles.some(
    (f) =>
      f.kind === "text" &&
      f.outputPath.endsWith(".xml") &&
      /\/slidergroups\//i.test(f.outputPath),
  );

  if (projectFiles.length === 0 || hasSliderGroup) return;

  // Extract slider-set names from the already-written converted project files.
  const setNames: string[] = [];
  for (const file of projectFiles) {
    const absPath = join(outputDir, ...file.outputPath.split("/"));
    const content = await readFile(absPath, "utf8").catch(() => "");
    setNames.push(...extractSliderSetNames(content));
  }

  const uniqueNames = [...new Set(setNames)];
  if (uniqueNames.length === 0) return;

  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[targetBodyType];
  const groupName = `${targetAlias} Outfits`;
  const memberLines = uniqueNames
    .map((name) => `        <Member name="${escapeXml(name)}"/>`)
    .join("\n");
  const xmlContent = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<SliderGroups>",
    `    <Group name="${escapeXml(groupName)}">`,
    memberLines,
    "    </Group>",
    "</SliderGroups>",
    "",
  ].join("\n");

  const fileName = `${targetAlias}_Outfits.xml`;
  const outputRelPath = `CalienteTools/BodySlide/SliderGroups/${fileName}`;
  const outputAbsPath = join(
    outputDir,
    "CalienteTools",
    "BodySlide",
    "SliderGroups",
    fileName,
  );

  await mkdir(dirname(outputAbsPath), { recursive: true });
  await writeFile(outputAbsPath, xmlContent, "utf8");

  convertedFiles.push({
    sourcePath: "(native post-process)",
    outputPath: outputRelPath,
    kind: "text",
    action: "synthesized",
  });
}

// Default CBPC weights used when generating a physics config stub.
// These represent safe starting values that match typical community conventions.
const CBPC_BREAST_DEFAULT = "0.600";
const CBPC_BUTT_DEFAULT = "0.450";
const CBPC_BELLY_DEFAULT = "0.300";
const CBPC_BREASTROOT_DEFAULT = "1.000";

function cbpcDefaultWeight(boneName: string): string {
  const lower = boneName.toLowerCase();
  if (lower.includes("breastroot")) return CBPC_BREASTROOT_DEFAULT;
  if (lower.includes("breast")) return CBPC_BREAST_DEFAULT;
  if (lower.includes("butt")) return CBPC_BUTT_DEFAULT;
  if (lower.includes("belly")) return CBPC_BELLY_DEFAULT;
  return CBPC_BREAST_DEFAULT;
}

/**
 * Generates a CBPC physics config stub when the conversion targets a physics-
 * capable body but the source mod contained no existing physics config file.
 *
 * The stub is deliberately minimal and commented so the user knows it is a
 * starting point; they can tune weights with CBPC Physics Tuner in-game.
 */
async function synthesizeMissingCbpcStub(
  outputDir: string,
  targetBodyType: BodyType,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<void> {
  const targetInfo = BODY_TYPE_INFO[targetBodyType];
  if (!targetInfo.physicsSupport || targetInfo.physicsBones.length === 0) {
    return;
  }

  // Skip if at least one physics config file already came from the source mod.
  const hasPhysicsConfig = convertedFiles.some(
    (f) =>
      f.action !== "synthesized" &&
      /cbpc|hdt|physics/i.test(f.outputPath.toLowerCase()),
  );
  if (hasPhysicsConfig) return;

  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[targetBodyType];
  const boneEntries = targetInfo.physicsBones
    .map((bone) => `${bone}=${cbpcDefaultWeight(bone)}`)
    .join("\n");

  const iniContent = [
    `; Auto-generated CBPC physics stub for ${targetAlias}`,
    `; Created by SlideSmith — ${new Date().toISOString()}`,
    ";",
    "; This file registers the standard physics bones for this outfit with CBPC.",
    "; Default weight values are community-convention starting points.",
    "; Tune them in-game with CBPC Physics Tuner or edit this file directly.",
    ";",
    `; Required mod: ${targetInfo.referenceProject}`,
    "; Required mod: CBPC — Physics with Collisions for SSE and VR",
    ";   (https://www.nexusmods.com/skyrimspecialedition/mods/21224)",
    ";",
    "; NOTE: Physics on NIF meshes also requires that the outfit shapes carry",
    "; bone weights for the bones listed below.  If the outfit was converted",
    "; from a non-physics source those weights may be missing and runtime",
    "; physics can remain static until the mesh includes target-bone weights.",
    "",
    boneEntries,
    "",
  ].join("\n");

  const fileName = `${targetAlias}_PhysicsStub.ini`;
  const outputRelPath = `SKSE/Plugins/CBPC/${fileName}`;
  const outputAbsPath = join(outputDir, "SKSE", "Plugins", "CBPC", fileName);

  await mkdir(dirname(outputAbsPath), { recursive: true });
  await writeFile(outputAbsPath, iniContent, "utf8");

  convertedFiles.push({
    sourcePath: "(native post-process)",
    outputPath: outputRelPath,
    kind: "text",
    action: "synthesized",
  });
}

function getWeightPairSuffixInfo(path: string): {
  matched: "_0" | "_1";
  counterpart: "_0" | "_1";
  extension: string;
} | null {
  if (/_0\.(nif|osd|tri)$/i.test(path)) {
    const ext = path.slice(path.lastIndexOf("."));
    return { matched: "_0", counterpart: "_1", extension: ext };
  }

  if (/_1\.(nif|osd|tri)$/i.test(path)) {
    const ext = path.slice(path.lastIndexOf("."));
    return { matched: "_1", counterpart: "_0", extension: ext };
  }

  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function synthesizeMissingWeightMeshes(
  outputDir: string,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<number> {
  const knownOutputPaths = new Set(
    convertedFiles.map((file) => file.outputPath),
  );
  const synthCandidates = convertedFiles.filter(
    (file) =>
      file.kind === "mesh" &&
      /\.(nif|osd|tri)$/i.test(file.outputPath.toLowerCase()),
  );
  let synthesizedCount = 0;

  for (const file of synthCandidates) {
    const suffixInfo = getWeightPairSuffixInfo(file.outputPath);
    if (!suffixInfo) continue;

    const counterpartOutputPath = file.outputPath.replace(
      new RegExp(`${suffixInfo.matched}\\${suffixInfo.extension}$`, "i"),
      `${suffixInfo.counterpart}${suffixInfo.extension}`,
    );
    if (knownOutputPaths.has(counterpartOutputPath)) {
      continue;
    }

    const sourceAbsolutePath = join(outputDir, file.outputPath);
    const counterpartAbsolutePath = join(outputDir, counterpartOutputPath);

    if (await pathExists(counterpartAbsolutePath)) {
      knownOutputPaths.add(counterpartOutputPath);
      continue;
    }

    await mkdir(dirname(counterpartAbsolutePath), { recursive: true });
    await copyFile(sourceAbsolutePath, counterpartAbsolutePath);
    knownOutputPaths.add(counterpartOutputPath);
    convertedFiles.push({
      sourcePath: file.sourcePath,
      outputPath: counterpartOutputPath,
      kind: "mesh",
      action: "synthesized",
    });
    synthesizedCount += 1;
  }

  return synthesizedCount;
}

function rewriteRelativePath(
  relativePath: string,
  source: BodyType,
  target: BodyType,
): string {
  return relativePath
    .split(/[\\/]/)
    .map((segment) =>
      replaceAliases(
        rewriteGenderMarkers(segment, source, target),
        source,
        target,
      ),
    )
    .join("/");
}

function getConversionPath(
  source: BodyType,
  target: BodyType,
): {
  mode: ConversionResult["conversionMode"];
  label: string;
  preferredOutputAlias: string;
  namingNotes: string[];
} {
  if (source === target) {
    return {
      mode: "native",
      label: "Same-body output",
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: [
        `Uses the canonical ${BODY_TYPE_OUTPUT_ALIASES[target]} alias for generated file names and rewritten metadata.`,
      ],
    };
  }

  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];

  if (
    (sourceInfo.family === targetInfo.family &&
      hasFamilyPath(sourceInfo.family)) ||
    (FEMALE_FAMILIES.has(sourceInfo.family) &&
      FEMALE_FAMILIES.has(targetInfo.family) &&
      sourceInfo.gender === "female" &&
      targetInfo.gender === "female")
  ) {
    const family =
      sourceInfo.family === targetInfo.family
        ? sourceInfo.family
        : "female-cross-family";
    if (family !== "female-cross-family") {
      const path = FAMILY_PATHS[family as keyof typeof FAMILY_PATHS];
      if (path) {
        return {
          mode: "compatibility",
          label: path.label,
          preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
          namingNotes: path.namingNotes,
        };
      }
    }

    return {
      mode: "compatibility",
      label: "Cross-family female adaptation",
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: [
        "Rewrites target aliases across female-body metadata, output paths, and BodySlide assets.",
        "Automatically harmonizes known female-body naming and config references to reduce manual cleanup.",
      ],
    };
  }

  if (
    (sourceInfo.family === targetInfo.family &&
      hasFamilyPath(sourceInfo.family)) ||
    (MALE_FAMILIES.has(sourceInfo.family) &&
      MALE_FAMILIES.has(targetInfo.family) &&
      sourceInfo.gender === "male" &&
      targetInfo.gender === "male")
  ) {
    const path = FAMILY_PATHS.male;
    return {
      mode: "compatibility",
      label: path.label,
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: path.namingNotes,
    };
  }

  return {
    mode: "compatibility",
    label:
      sourceInfo.gender === "both" || targetInfo.gender === "both"
        ? "Vanilla compatibility adaptation"
        : "Cross-gender outfit adaptation",
    preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
    namingNotes:
      sourceInfo.gender === "both" || targetInfo.gender === "both"
        ? [
            "Rewrites target aliases across vanilla-style asset names and BodySlide metadata.",
            "Vanilla compatibility mode applies automatic metadata adaptation for quicker drop-in testing.",
          ]
        : CROSS_GENDER_NOTES,
  };
}

function createWarnings(
  detection: DetectionResult,
  source: BodyType,
  target: BodyType,
  path: ReturnType<typeof getConversionPath>,
): string[] {
  const warnings = [...path.namingNotes];
  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];
  const highRiskConversion =
    detection.confidence < 0.55 ||
    sourceInfo.gender !== targetInfo.gender ||
    sourceInfo.topology !== targetInfo.topology;

  if (detection.confidence < 0.55) {
    warnings.push(
      `Detection confidence is low (${Math.round(detection.confidence * 100)}%). Review output meshes before release.`,
    );
  }

  if (source !== target) {
    warnings.push(
      highRiskConversion
        ? `Native conversion is running in compatibility mode for '${source}' → '${target}' via ${path.label}. Automatic body-path, naming, and config adaptation was applied, but this route is high-risk and should still be manually checked for final seam quality.`
        : `Native conversion is running in compatibility mode for '${source}' → '${target}' via ${path.label}. Automatic body-path, naming, and config adaptation was applied; run BodySlide preview and in-game checks for final fit validation.`,
    );
  }

  if (targetInfo.physicsSupport) {
    warnings.push(
      `${target.toUpperCase()} uses physics-aware assets. This native pass remaps known physics references in text configs where possible; verify runtime behavior if the source mod ships custom physics rules.`,
    );
  }

  if (sourceInfo.physicsSupport !== targetInfo.physicsSupport) {
    warnings.push(
      sourceInfo.physicsSupport
        ? `Source body '${source}' includes physics-aware data that '${target}' does not. Physics bones in text configs were collapsed to static fallback bones where detected.`
        : `Target body '${target}' expects physics-aware data that '${source}' does not include. Native output was prepared for the target naming scheme, but custom physics presets may still be needed.`,
    );
  }

  const explicitPhysicsMap = EXPLICIT_PHYSICS_BONE_MAPS[source]?.[target];
  const canUseIndexedPhysicsMapping =
    sourceInfo.gender === targetInfo.gender &&
    sourceInfo.family === targetInfo.family &&
    sourceInfo.topology === targetInfo.topology;
  if (
    sourceInfo.physicsSupport &&
    targetInfo.physicsSupport &&
    explicitPhysicsMap === undefined &&
    !canUseIndexedPhysicsMapping
  ) {
    warnings.push(
      `No direct physics-bone map exists for '${source}' → '${target}'. Native conversion collapsed unmatched source physics references to static fallback bones instead of forcing potentially incorrect target-chain remaps.`,
    );
  }

  if (
    sourceInfo.gender !== targetInfo.gender &&
    sourceInfo.gender !== "both" &&
    targetInfo.gender !== "both"
  ) {
    warnings.push(
      `Cross-gender adaptation rewrote common ${sourceInfo.gender} asset markers to ${targetInfo.gender} markers so the generated outfit is labelled for the ${target.toUpperCase()} target body.`,
    );
  }

  if (sourceInfo.topology !== targetInfo.topology) {
    warnings.push(
      `Source topology '${sourceInfo.topology}' differs from target topology '${targetInfo.topology}'. Review ${targetInfo.adaptationFocus.slice(0, 3).join(", ")} before release.`,
    );
  }

  if (sourceInfo.family === "addon" || targetInfo.family === "addon") {
    warnings.push(
      "Addon-style body support (for example SOS) keeps partition-sensitive meshes intact. Verify slot assignments and exposed seams before release.",
    );
  }

  const fitFocus = targetInfo.adaptationFocus.slice(0, 5).join(", ");
  if (fitFocus.length > 0) {
    warnings.push(`Target fit focus for ${target.toUpperCase()}: ${fitFocus}.`);
  }
  const targetKnowledgeSummary =
    targetInfo.conversionNotes.split(/(?<=\.)\s+/)[0] ??
    targetInfo.conversionNotes;
  warnings.push(
    `Target body knowledge note (${target.toUpperCase()}): ${targetKnowledgeSummary}`,
  );

  return warnings;
}

export async function convertMod(
  _inputDir: string,
  outputDir: string,
  files: ScannedFile[],
  detection: DetectionResult,
  targetBodyType: BodyType,
): Promise<ConversionResult> {
  if (detection.bodyType === "unknown") {
    throw new Error(
      "Cannot run native conversion when the source body type is unknown. Please choose a mod with detectable body-type assets first.",
    );
  }

  const sourceBodyType = detection.bodyType;
  const conversionPath = getConversionPath(sourceBodyType, targetBodyType);

  await mkdir(outputDir, { recursive: true });

  const convertedFiles: ConversionResult["convertedFiles"] = [];
  const skippedFiles: ConversionResult["skippedFiles"] = [];

  for (const file of files) {
    const rewrittenRelativePath = normalizeToMo2DataPath(
      rewriteRelativePath(file.relativePath, sourceBodyType, targetBodyType),
      file.extension,
      file.preview,
    );
    const outputPath = join(outputDir, rewrittenRelativePath);
    await mkdir(dirname(outputPath), { recursive: true });

    if (TEXT_EXTENSIONS.has(file.extension)) {
      const content = await readFile(file.absolutePath, "utf8");
      const nextContent = replaceAliases(
        replacePhysicsReferences(
          rewriteGenderMarkers(content, sourceBodyType, targetBodyType),
          sourceBodyType,
          targetBodyType,
        ),
        sourceBodyType,
        targetBodyType,
      );
      await writeFile(outputPath, nextContent, "utf8");
      convertedFiles.push({
        sourcePath: file.relativePath,
        outputPath: rewrittenRelativePath,
        kind: "text",
        action: nextContent === content ? "copied" : "rewritten",
      });
      continue;
    }

    if (MESH_EXTENSIONS.has(file.extension)) {
      await copyFile(file.absolutePath, outputPath);
      convertedFiles.push({
        sourcePath: file.relativePath,
        outputPath: rewrittenRelativePath,
        kind: "mesh",
        action: "copied",
      });
      continue;
    }

    await copyFile(file.absolutePath, outputPath);
    skippedFiles.push({
      sourcePath: file.relativePath,
      outputPath: rewrittenRelativePath,
      reason: "Copied without body-specific changes.",
    });
  }

  const synthesizedWeightMeshes = await synthesizeMissingWeightMeshes(
    outputDir,
    convertedFiles,
  );
  if (synthesizedWeightMeshes > 0) {
    skippedFiles.push({
      sourcePath: "(native post-process)",
      outputPath: "(generated weight pairs)",
      reason: `Synthesized ${synthesizedWeightMeshes} missing weight-pair mesh counterpart(s) to improve in-game slider completeness.`,
    });
  }

  const synthesizedSliderSets = await synthesizeMissingSliderSetProject(
    outputDir,
    targetBodyType,
    convertedFiles,
  );
  if (synthesizedSliderSets > 0) {
    skippedFiles.push({
      sourcePath: "(native post-process)",
      outputPath: "(generated bodyslide slidersets)",
      reason: `Synthesized ${synthesizedSliderSets} BodySlide SliderSet entr${synthesizedSliderSets === 1 ? "y" : "ies"} from converted meshes so the outfit appears directly in BodySlide.`,
    });
  }

  // Synthesize a BodySlide SliderGroup XML when project files exist but no
  // group file was part of the source mod.  Without a group registration
  // BodySlide cannot list the outfit in its left-hand panel.
  await synthesizeMissingSliderGroup(outputDir, targetBodyType, convertedFiles);

  // Synthesize a CBPC physics config stub when the target body supports
  // physics but the source mod contained no physics config files at all.
  await synthesizeMissingCbpcStub(outputDir, targetBodyType, convertedFiles);

  const outputFiles = await scanModFiles(outputDir);
  const audit = createConversionAudit(
    detection,
    targetBodyType,
    files,
    outputFiles,
  );
  const warnings = [
    ...createWarnings(
      detection,
      sourceBodyType,
      targetBodyType,
      conversionPath,
    ),
    ...(audit.overallStatus === "attention"
      ? [
          "Conversion audit flagged follow-up items. Review the conversion audit section in the summary/report before shipping the generated output.",
        ]
      : []),
  ];

  return {
    sourceBodyType,
    targetBodyType,
    conversionMode: conversionPath.mode,
    conversionPath: conversionPath.label,
    preferredOutputAlias: conversionPath.preferredOutputAlias,
    namingNotes: conversionPath.namingNotes,
    audit,
    detectionConfidence: detection.confidence,
    convertedFiles,
    skippedFiles,
    warnings,
    filesAnalyzed: files.length,
    generatedAt: new Date().toISOString(),
  };
}
