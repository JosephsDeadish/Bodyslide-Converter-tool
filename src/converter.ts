import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
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
const UTF8_REPLACEMENT_CHAR_RE = /\uFFFD/g;

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
const FOMOD_METADATA_PREFIX = "fomod/";

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

const BODYSLIDE_SLIDERSET_PATH_MARKERS: readonly string[] = [
  "calientetools/bodyslide/slidersets/",
  "bodyslide/slidersets/",
  "slidersets/",
];
const BODYSLIDE_SLIDERGROUP_PATH_MARKERS: readonly string[] = [
  "calientetools/bodyslide/slidergroups/",
  "bodyslide/slidergroups/",
  "slidergroups/",
];
const BODYSLIDE_SHAPEDATA_PATH_MARKERS: readonly string[] = [
  "calientetools/bodyslide/shapedata/",
  "bodyslide/shapedata/",
  "shapedata/",
];

function extractBodySlideSubpath(
  forwardPath: string,
  markers: readonly string[],
): string | null {
  const normalized = forwardPath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  for (const marker of markers) {
    const lowerMarker = marker.toLowerCase();
    if (lower.startsWith(lowerMarker)) {
      const suffix = normalized.slice(marker.length).replace(/^\/+/, "");
      return suffix.length > 0 ? suffix : null;
    }
    const embeddedMarker = `/${lowerMarker}`;
    const markerIndex = lower.indexOf(embeddedMarker);
    if (markerIndex >= 0) {
      const suffix = normalized
        .slice(markerIndex + embeddedMarker.length)
        .replace(/^\/+/, "");
      return suffix.length > 0 ? suffix : null;
    }
  }
  return null;
}

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

  // Strip embedded Data/ roots inside installer option folders
  // (for example "00 Core/Data/meshes/...").
  for (const prefix of DATA_CONTAINER_PREFIXES) {
    const marker = `/${prefix.toLowerCase()}`;
    const markerIndex = forward.toLowerCase().indexOf(marker);
    if (markerIndex >= 0) {
      forward = forward.slice(markerIndex + marker.length);
      break;
    }
  }
  const lower = forward.toLowerCase();
  const isBodySlideProjectFile = extension === ".osp" || extension === ".xml";
  const shapeDataSubpathForMesh =
    extension === ".nif" || extension === ".tri" || extension === ".osd"
      ? extractBodySlideSubpath(forward, BODYSLIDE_SHAPEDATA_PATH_MARKERS)
      : null;

  // Installer packs sometimes nest canonical Data roots under option folders.
  // Preserve the canonical root segment rather than nesting under meshes/<wrapper>/...
  for (const prefix of CANONICAL_DATA_PREFIXES) {
    const canonicalMarker = `/${prefix.toLowerCase()}`;
    const canonicalIndex = lower.indexOf(canonicalMarker);
    if (canonicalIndex >= 0) {
      return forward.slice(canonicalIndex + 1);
    }
  }

  // Already in a canonical data root — preserve path as-is.
  if (
    !isBodySlideProjectFile &&
    !shapeDataSubpathForMesh &&
    CANONICAL_DATA_PREFIXES.some((prefix) =>
      lower.startsWith(prefix.toLowerCase()),
    )
  ) {
    return forward;
  }

  // .osp → BodySlide slider-set definition; must live in SliderSets/
  if (extension === ".osp") {
    const sliderSetSubpath = extractBodySlideSubpath(
      forward,
      BODYSLIDE_SLIDERSET_PATH_MARKERS,
    );
    return `CalienteTools/BodySlide/SliderSets/${sliderSetSubpath ?? basename(forward)}`;
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
      const sliderSetSubpath = extractBodySlideSubpath(
        forward,
        BODYSLIDE_SLIDERSET_PATH_MARKERS,
      );
      return `CalienteTools/BodySlide/SliderSets/${sliderSetSubpath ?? basename(forward)}`;
    }
    if (
      /(^|\/)calientetools\/bodyslide\/slidergroups\//.test(lower) ||
      /(^|\/)bodyslide\/slidergroups\//.test(lower) ||
      /(^|\/)slidergroups\//.test(lower)
    ) {
      const sliderGroupSubpath = extractBodySlideSubpath(
        forward,
        BODYSLIDE_SLIDERGROUP_PATH_MARKERS,
      );
      return `CalienteTools/BodySlide/SliderGroups/${sliderGroupSubpath ?? basename(forward)}`;
    }
    return forward;
  }

  // .nif / .tri / .osd → armor/clothing/body meshes must live under meshes/
  if (extension === ".nif" || extension === ".tri" || extension === ".osd") {
    const shapeDataSubpath =
      shapeDataSubpathForMesh ??
      extractBodySlideSubpath(forward, BODYSLIDE_SHAPEDATA_PATH_MARKERS);
    if (shapeDataSubpath) {
      return `CalienteTools/BodySlide/ShapeData/${shapeDataSubpath}`;
    }
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
  ube: "UBE",
  "7base": "7Base",
  sam: "SAM",
  vanilla: "Vanilla",
};

const BODY_TYPE_LEGACY_ALIASES: Record<BodyType, string[]> = {
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
    "cbbe 3ba physics",
    "cbbe 3ba softbody",
    "3ba softbody",
    "3bbb softbody",
    "cbbe_3ba",
    "cbbe-3ba",
    "cbbe_physics",
    "cbbe-physics",
    "cbbe_smp",
    "cbbe-smp",
    "3bbbbody",
    "3bbb_body",
    "3ba body",
    "3ba body amazing",
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
    "himbo v5",
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
    "bt2",
  ],
  tbd: [
    "touched by dibella",
    "touchedbydibella",
    "tbd body",
    "tbd softbody",
    "tbd_body",
    "tbd se",
    "tbd",
  ],
  sos: [
    "schlongs of skyrim",
    "schlongsofskyrim",
    "sos regular",
    "sos light",
    "sos body",
    "sos ae",
    "sos",
  ],
  unp: [
    "dimonized unp female body",
    "unp female body renewed",
    "unpb renewed",
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
    "bhunp softbody",
    "bhunp_body",
    "bhunp v3",
    "bhunp",
  ],
  uunp: [
    "unified unp special",
    "unified unp",
    "uunp special",
    "uunp softbody",
    "uunp body",
    "uunp_body",
    "uunp",
  ],
  ube: [
    "unified body enhancer",
    "ube body",
    "ube 2.0",
    "ube softbody",
    "ube physics",
    "uunp ube",
    "ube_body",
    "ube",
  ],
  "7base": [
    "sevenbase bombshell",
    "sevenbase oppai",
    "7b bombshell",
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
    "sam high poly conversion",
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

function buildBoundedPattern(value: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(value)}(?![a-z0-9])`, "gi");
}

function buildAliasPattern(alias: string): RegExp {
  return buildBoundedPattern(alias);
}

function expandAliasForms(alias: string): string[] {
  const normalized = alias.trim().toLowerCase();
  if (normalized === "") {
    return [];
  }

  const compact = normalized.replaceAll(/[ _-]+/g, "");
  const dashed = normalized.replaceAll(/[ _]+/g, "-");
  const underscored = normalized.replaceAll(/[ -]+/g, "_");
  return [...new Set([normalized, compact, dashed, underscored])];
}

function getBodyTypeAliases(bodyType: BodyType): string[] {
  const info = BODY_TYPE_INFO[bodyType];
  const aliasSeeds = [
    bodyType,
    BODY_TYPE_OUTPUT_ALIASES[bodyType],
    ...info.aliases,
    ...info.commonVariants,
    ...BODY_TYPE_LEGACY_ALIASES[bodyType],
  ];
  return [
    ...new Set(
      aliasSeeds.flatMap(expandAliasForms).filter((value) => value.length > 0),
    ),
  ].sort((left, right) => right.length - left.length);
}

function replaceAliases(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  let next = value;
  const aliases = getBodyTypeAliases(source);

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
    // UUNP uses standard NPC naming; collapse 3BA-specific BreastRoot/BellyRoot
    uunp: {
      "NPC LBreastRoot": "NPC L Breast01",
      "NPC RBreastRoot": "NPC R Breast01",
      "NPC BellyRoot": "NPC Belly",
    },
    // UBE uses same NPC naming as UUNP
    ube: {
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
    // UUNP uses the same NPC naming convention as 3BA/TBD
    uunp: {
      "BHUNP Breast L01": "NPC L Breast01",
      "BHUNP Breast R01": "NPC R Breast01",
      "BHUNP Breast L02": "NPC L Breast02",
      "BHUNP Breast R02": "NPC R Breast02",
      "BHUNP Breast L03": "NPC L Breast03",
      "BHUNP Breast R03": "NPC R Breast03",
      "BHUNP Butt L": "NPC L Butt",
      "BHUNP Butt R": "NPC R Butt",
    },
    // UBE uses the same NPC naming convention as UUNP
    ube: {
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
    // UUNP shares same NPC bone naming as TBD — no name remapping needed
    uunp: {},
    // UBE shares same NPC bone naming as TBD
    ube: {},
  },
  uunp: {
    // UUNP → BHUNP: rename NPC-prefixed bones to BHUNP-prefixed names
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
    // TBD shares same NPC bone naming as UUNP — no name remapping needed
    tbd: {},
    // 3BA: UUNP has same NPC Breast01-03/Butt/Belly naming; no rename but no BreastRoot/BellyRoot to generate
    "3ba": {},
    // UBE: identical bone names to UUNP — no remapping needed
    ube: {},
  },
  ube: {
    // UBE → BHUNP: same remapping as UUNP (identical bone naming)
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
    // TBD, 3BA, UUNP all share the same NPC bone naming as UBE
    tbd: {},
    "3ba": {},
    uunp: {},
  },
};

type PhysicsBoneGroup =
  | "breast-root"
  | "breast"
  | "butt"
  | "belly"
  | "genitals"
  | "scrotum"
  | "other";
type PhysicsBoneSide = "left" | "right" | null;
type PhysicsRemapKind = "explicit" | "semantic" | "indexed" | "fallback";

type PhysicsBoneDescriptor = {
  name: string;
  group: PhysicsBoneGroup;
  side: PhysicsBoneSide;
  stage: number | null;
};

type PhysicsRemapStep = {
  sourceBone: string;
  sourceAliases: readonly string[];
  targetBone: string;
  kind: PhysicsRemapKind;
};

type PhysicsRemapPlan = {
  steps: PhysicsRemapStep[];
};

const PHYSICS_BONE_SOURCE_ALIASES: Partial<
  Record<BodyType, Partial<Record<string, readonly string[]>>>
> = {
  "3ba": {
    "NPC L Breast01": [
      "NPC L Breast",
      "NPC LBreast01",
      "NPC L PreBreast",
      "NPC L PreBreast01",
      "NPC LPreBreast01",
    ],
    "NPC R Breast01": [
      "NPC R Breast",
      "NPC RBreast01",
      "NPC R PreBreast",
      "NPC R PreBreast01",
      "NPC RPreBreast01",
    ],
    "NPC L Breast02": [
      "NPC LBreast02",
      "NPC L PreBreast02",
      "NPC LPreBreast02",
    ],
    "NPC R Breast02": [
      "NPC RBreast02",
      "NPC R PreBreast02",
      "NPC RPreBreast02",
    ],
    "NPC L Breast03": [
      "NPC LBreast03",
      "NPC L PreBreast03",
      "NPC LPreBreast03",
    ],
    "NPC R Breast03": [
      "NPC RBreast03",
      "NPC R PreBreast03",
      "NPC RPreBreast03",
    ],
    "NPC L Butt": [
      "NPC LButt",
      "NPC L Butt01",
      "NPC LButt01",
      "NPC L Butt02",
      "NPC LButt02",
    ],
    "NPC R Butt": [
      "NPC RButt",
      "NPC R Butt01",
      "NPC RButt01",
      "NPC R Butt02",
      "NPC RButt02",
    ],
    "NPC LBreastRoot": ["NPC L BreastRoot", "NPC L Breast Root"],
    "NPC RBreastRoot": ["NPC R BreastRoot", "NPC R Breast Root"],
    "NPC Belly": ["NPC Belly01", "NPC Belly 01"],
    "NPC BellyRoot": ["NPC Belly Root", "NPC BellyRoot01", "NPC Belly Root01"],
  },
  tbd: {
    "NPC L Breast01": ["NPC L Breast", "NPC LBreast01"],
    "NPC R Breast01": ["NPC R Breast", "NPC RBreast01"],
    "NPC L Breast02": ["NPC LBreast02"],
    "NPC R Breast02": ["NPC RBreast02"],
    "NPC L Breast03": ["NPC LBreast03"],
    "NPC R Breast03": ["NPC RBreast03"],
    "NPC L Butt": ["NPC LButt", "NPC L Butt01", "NPC LButt01"],
    "NPC R Butt": ["NPC RButt", "NPC R Butt01", "NPC RButt01"],
  },
  uunp: {
    "NPC L Breast01": [
      "NPC L Breast",
      "NPC LBreast01",
      "NPC L UUNP Breast 01",
      "NPC LUUNPBreast01",
      "NPC L UBE Breast 01",
      "NPC LUBEBreast01",
    ],
    "NPC R Breast01": [
      "NPC R Breast",
      "NPC RBreast01",
      "NPC R UUNP Breast 01",
      "NPC RUUNPBreast01",
      "NPC R UBE Breast 01",
      "NPC RUBEBreast01",
    ],
    "NPC L Breast02": [
      "NPC LBreast02",
      "NPC L UUNP Breast 02",
      "NPC LUUNPBreast02",
      "NPC L UBE Breast 02",
      "NPC LUBEBreast02",
    ],
    "NPC R Breast02": [
      "NPC RBreast02",
      "NPC R UUNP Breast 02",
      "NPC RUUNPBreast02",
      "NPC R UBE Breast 02",
      "NPC RUBEBreast02",
    ],
    "NPC L Breast03": [
      "NPC LBreast03",
      "NPC L UUNP Breast 03",
      "NPC LUUNPBreast03",
      "NPC L UBE Breast 03",
      "NPC LUBEBreast03",
    ],
    "NPC R Breast03": [
      "NPC RBreast03",
      "NPC R UUNP Breast 03",
      "NPC RUUNPBreast03",
      "NPC R UBE Breast 03",
      "NPC RUBEBreast03",
    ],
    "NPC L Butt": [
      "NPC LButt",
      "NPC L Butt01",
      "NPC LButt01",
      "NPC L UUNP Glute 01",
      "NPC LUUNPGlute01",
    ],
    "NPC R Butt": [
      "NPC RButt",
      "NPC R Butt01",
      "NPC RButt01",
      "NPC R UUNP Glute 01",
      "NPC RUUNPGlute01",
    ],
    "NPC Belly": ["NPC Belly01", "NPC Belly 01"],
  },
  ube: {
    "NPC L Breast01": [
      "NPC L Breast",
      "NPC LBreast01",
      "NPC L UBE Breast 01",
      "NPC LUBEBreast01",
      "NPC L UUNP Breast 01",
      "NPC LUUNPBreast01",
    ],
    "NPC R Breast01": [
      "NPC R Breast",
      "NPC RBreast01",
      "NPC R UBE Breast 01",
      "NPC RUBEBreast01",
      "NPC R UUNP Breast 01",
      "NPC RUUNPBreast01",
    ],
    "NPC L Breast02": [
      "NPC LBreast02",
      "NPC L UBE Breast 02",
      "NPC LUBEBreast02",
      "NPC L UUNP Breast 02",
      "NPC LUUNPBreast02",
    ],
    "NPC R Breast02": [
      "NPC RBreast02",
      "NPC R UBE Breast 02",
      "NPC RUBEBreast02",
      "NPC R UUNP Breast 02",
      "NPC RUUNPBreast02",
    ],
    "NPC L Breast03": [
      "NPC LBreast03",
      "NPC L UBE Breast 03",
      "NPC LUBEBreast03",
      "NPC L UUNP Breast 03",
      "NPC LUUNPBreast03",
    ],
    "NPC R Breast03": [
      "NPC RBreast03",
      "NPC R UBE Breast 03",
      "NPC RUBEBreast03",
      "NPC R UUNP Breast 03",
      "NPC RUUNPBreast03",
    ],
    "NPC L Butt": [
      "NPC LButt",
      "NPC L Butt01",
      "NPC LButt01",
      "NPC L UUNP Glute 01",
      "NPC LUUNPGlute01",
    ],
    "NPC R Butt": [
      "NPC RButt",
      "NPC R Butt01",
      "NPC RButt01",
      "NPC R UUNP Glute 01",
      "NPC RUUNPGlute01",
    ],
    "NPC Belly": ["NPC Belly01", "NPC Belly 01"],
  },
  bhunp: {
    "BHUNP Breast L01": ["BHUNP Breast L", "BHUNPBreastL01"],
    "BHUNP Breast R01": ["BHUNP Breast R", "BHUNPBreastR01"],
    "BHUNP Breast L02": ["BHUNPBreastL02"],
    "BHUNP Breast R02": ["BHUNPBreastR02"],
    "BHUNP Breast L03": ["BHUNPBreastL03"],
    "BHUNP Breast R03": ["BHUNPBreastR03"],
    "BHUNP Butt L": ["BHUNPButtL", "BHUNP Butt L01"],
    "BHUNP Butt R": ["BHUNPButtR", "BHUNP Butt R01"],
  },
};

function getSourcePhysicsAliases(
  sourceType: BodyType,
  sourceBone: string,
): readonly string[] {
  const aliases = PHYSICS_BONE_SOURCE_ALIASES[sourceType]?.[sourceBone] ?? [];
  return [sourceBone, ...aliases];
}

function detectPhysicsBoneSide(lowerBoneName: string): PhysicsBoneSide {
  if (
    /\bleft\b/.test(lowerBoneName) ||
    /\bl\b/.test(lowerBoneName) ||
    /(^|[^a-z])l(?=breast|butt|genitals|scrotum)/.test(lowerBoneName) ||
    /\bbreast[\s_-]*l\b/.test(lowerBoneName) ||
    /\bbutt[\s_-]*l\b/.test(lowerBoneName) ||
    /\bgenitals\w*\s*l/.test(lowerBoneName) ||
    /\bscrotum\w*[\s_-]*l\b/.test(lowerBoneName)
  ) {
    return "left";
  }
  if (
    /\bright\b/.test(lowerBoneName) ||
    /\br\b/.test(lowerBoneName) ||
    /(^|[^a-z])r(?=breast|butt|genitals|scrotum)/.test(lowerBoneName) ||
    /\bbreast[\s_-]*r\b/.test(lowerBoneName) ||
    /\bbutt[\s_-]*r\b/.test(lowerBoneName) ||
    /\bgenitals\w*\s*r/.test(lowerBoneName) ||
    /\bscrotum\w*[\s_-]*r\b/.test(lowerBoneName)
  ) {
    return "right";
  }
  return null;
}

function parsePhysicsBoneDescriptor(boneName: string): PhysicsBoneDescriptor {
  const lower = boneName.toLowerCase();
  const side = detectPhysicsBoneSide(lower);
  let group: PhysicsBoneGroup = "other";
  if (lower.includes("scrotum")) {
    group = "scrotum";
  } else if (lower.includes("genitals")) {
    group = "genitals";
  } else if (lower.includes("belly")) {
    group = "belly";
  } else if (lower.includes("butt")) {
    group = "butt";
  } else if (/breast[\s_-]*root/.test(lower)) {
    group = "breast-root";
  } else if (lower.includes("breast")) {
    group = "breast";
  }

  const stageMatch = lower.match(/(?:^|[^0-9])0?([1-3])(?![0-9])/);
  const stage =
    group === "breast" || group === "breast-root"
      ? Number(stageMatch?.[1] ?? "1")
      : null;

  return { name: boneName, group, side, stage };
}

function pickMatchingBone(
  descriptors: PhysicsBoneDescriptor[],
  matcher: (descriptor: PhysicsBoneDescriptor) => boolean,
): string | null {
  return descriptors.find(matcher)?.name ?? null;
}

function findSemanticPhysicsTargetBone(
  sourceBone: string,
  targetBones: readonly string[],
): string | null {
  const sourceDescriptor = parsePhysicsBoneDescriptor(sourceBone);
  const targetDescriptors = targetBones.map(parsePhysicsBoneDescriptor);
  const matchesSide = (descriptor: PhysicsBoneDescriptor) =>
    sourceDescriptor.side === null || descriptor.side === sourceDescriptor.side;
  switch (sourceDescriptor.group) {
    case "breast-root":
      return (
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast-root" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" &&
            matchesSide(descriptor) &&
            descriptor.stage === 1,
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" && descriptor.stage === 1,
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "breast",
        )
      );
    case "breast":
      return (
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" &&
            matchesSide(descriptor) &&
            descriptor.stage === sourceDescriptor.stage,
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "breast" &&
            descriptor.stage === sourceDescriptor.stage,
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "breast",
        )
      );
    case "butt":
      return (
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "butt" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "butt",
        )
      );
    case "belly":
      return pickMatchingBone(
        targetDescriptors,
        (descriptor) => descriptor.group === "belly",
      );
    case "scrotum":
      return (
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "scrotum" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "scrotum",
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "genitals",
        )
      );
    case "genitals":
      return (
        pickMatchingBone(
          targetDescriptors,
          (descriptor) =>
            descriptor.group === "genitals" && matchesSide(descriptor),
        ) ??
        pickMatchingBone(
          targetDescriptors,
          (descriptor) => descriptor.group === "genitals",
        )
      );
    default:
      return null;
  }
}

function buildPhysicsRemapPlan(
  source: BodyType,
  target: BodyType,
): PhysicsRemapPlan {
  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];
  if (
    source === target ||
    sourceInfo.physicsBones.length === 0 ||
    targetInfo.physicsBones.length === 0
  ) {
    return { steps: [] };
  }

  const explicitMap = EXPLICIT_PHYSICS_BONE_MAPS[source]?.[target];
  const explicitMapLookup = new Map(
    Object.entries(explicitMap ?? {}).map(([sourceBone, targetBone]) => [
      sourceBone.toLowerCase(),
      targetBone,
    ]),
  );
  const canUseIndexedPhysicsMapping =
    sourceInfo.gender === targetInfo.gender &&
    sourceInfo.family === targetInfo.family &&
    sourceInfo.topology === targetInfo.topology;

  const steps: PhysicsRemapStep[] = sourceInfo.physicsBones.map(
    (sourceBone, index) => {
      const explicitTarget = explicitMapLookup.get(sourceBone.toLowerCase());
      if (explicitTarget) {
        return {
          sourceBone,
          sourceAliases: getSourcePhysicsAliases(source, sourceBone),
          targetBone: explicitTarget,
          kind: "explicit",
        };
      }

      const semanticTarget = findSemanticPhysicsTargetBone(
        sourceBone,
        targetInfo.physicsBones,
      );
      if (semanticTarget) {
        return {
          sourceBone,
          sourceAliases: getSourcePhysicsAliases(source, sourceBone),
          targetBone: semanticTarget,
          kind: "semantic",
        };
      }

      if (canUseIndexedPhysicsMapping) {
        const indexedTarget = targetInfo.physicsBones[index];
        if (indexedTarget) {
          return {
            sourceBone,
            sourceAliases: getSourcePhysicsAliases(source, sourceBone),
            targetBone: indexedTarget,
            kind: "indexed",
          };
        }
      }

      return {
        sourceBone,
        sourceAliases: getSourcePhysicsAliases(source, sourceBone),
        targetBone: getStaticFallbackBone(sourceBone),
        kind: "fallback",
      };
    },
  );

  return { steps };
}

function applyPhysicsRemapPlan(value: string, plan: PhysicsRemapPlan): string {
  let next = value;
  const placeholders: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const placeholder = `__SLIDESMITH_BONE_${index}__`;
    placeholders.push(placeholder);
    const aliases = [...step.sourceAliases].sort(
      (left, right) => right.length - left.length,
    );
    for (const sourceAlias of aliases) {
      next = next.replaceAll(buildBoundedPattern(sourceAlias), placeholder);
    }
  }
  for (const [index, step] of plan.steps.entries()) {
    next = next.replaceAll(placeholders[index] ?? "", step.targetBone);
  }
  return next;
}

function replacePhysicsReferences(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  if (source === target) return value;
  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];
  if (sourceInfo.physicsBones.length === 0) return value;
  if (targetInfo.physicsBones.length === 0) {
    const fallbackPlan: PhysicsRemapPlan = {
      steps: sourceInfo.physicsBones.map((sourceBone) => ({
        sourceBone,
        sourceAliases: getSourcePhysicsAliases(source, sourceBone),
        targetBone: getStaticFallbackBone(sourceBone),
        kind: "fallback",
      })),
    };
    return applyPhysicsRemapPlan(value, fallbackPlan);
  }

  return applyPhysicsRemapPlan(value, buildPhysicsRemapPlan(source, target));
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
const SLIDERSET_OUTPUTFILE_RE = /<OutputFile>\s*([^<]+)\s*<\/OutputFile>/gi;
const SLIDERSET_BLOCK_RE = /<SliderSet\b[\s\S]*?<\/SliderSet>/gi;
const SLIDERSET_OUTPUTPATH_RE = /<OutputPath>\s*([^<]*)\s*<\/OutputPath>/i;
const SLIDERSET_SOURCEFILE_RE = /<SourceFile>\s*([^<]*)\s*<\/SourceFile>/i;

function extractSliderSetNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(SLIDERSET_NAME_RE)) {
    if (match[1]) names.push(match[1].trim());
  }
  return names;
}

function extractSliderSetOutputFiles(content: string): string[] {
  const outputs: string[] = [];
  for (const match of content.matchAll(SLIDERSET_OUTPUTFILE_RE)) {
    if (match[1]) outputs.push(match[1].trim().toLowerCase());
  }
  return outputs;
}

function normalizeSliderSetOutputPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

function buildSliderSetOutputPath(
  outputPath: string,
  outputFile: string,
): string {
  const normalizedPath = normalizeSliderSetOutputPath(outputPath);
  const normalizedFile = normalizeSliderSetOutputPath(outputFile);
  if (normalizedPath.length === 0) {
    return normalizedFile;
  }
  return `${normalizedPath.replace(/\/?$/, "/")}${normalizedFile}`.replace(
    /\/{2,}/g,
    "/",
  );
}

type SliderSetCoverageEntry = {
  outputFile: string;
  outputPath: string;
  hasExplicitOutputPath: boolean;
  hasSourceFile: boolean;
};

function extractSliderSetCoverageEntries(
  content: string,
): SliderSetCoverageEntry[] {
  const entries: SliderSetCoverageEntry[] = [];
  for (const blockMatch of content.matchAll(SLIDERSET_BLOCK_RE)) {
    const sliderSetBlock = blockMatch[0] ?? "";
    if (!sliderSetBlock) continue;
    const outputFiles = extractSliderSetOutputFiles(sliderSetBlock);
    if (outputFiles.length === 0) continue;
    const outputPathMatch = sliderSetBlock.match(SLIDERSET_OUTPUTPATH_RE);
    const outputPath = outputPathMatch?.[1]?.trim() ?? "";
    const hasExplicitOutputPath = outputPath.length > 0;
    const sourceFileMatch = sliderSetBlock.match(SLIDERSET_SOURCEFILE_RE);
    const hasSourceFile = (sourceFileMatch?.[1]?.trim().length ?? 0) > 0;
    for (const outputFile of outputFiles) {
      entries.push({
        outputFile,
        outputPath: buildSliderSetOutputPath(outputPath, outputFile),
        hasExplicitOutputPath,
        hasSourceFile,
      });
    }
  }
  return entries;
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

function toSliderSetFileToken(value: string): string {
  const token = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : "outfit";
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
    const lowerOutputPath = file.outputPath.toLowerCase().replace(/\\/g, "/");
    if (
      file.kind !== "mesh" ||
      !lowerOutputPath.endsWith(".nif") ||
      !isArmorOrClothingNif(file.outputPath) ||
      /(^|\/)calientetools\/bodyslide\/shapedata\//.test(lowerOutputPath)
    ) {
      continue;
    }
    const lowMatch = lowerOutputPath.match(/^(.*)_0\.nif$/);
    const highMatch = lowerOutputPath.match(/^(.*)_1\.nif$/);
    const key = (
      lowMatch?.[1] ??
      highMatch?.[1] ??
      lowerOutputPath
    ).toLowerCase();
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
  shapeDataMeshMap: ReadonlyMap<string, string>,
): Promise<number> {
  const projectFiles = convertedFiles.filter(
    (f) =>
      f.kind === "text" &&
      (f.outputPath.endsWith(".osp") ||
        (f.outputPath.endsWith(".xml") &&
          /\/slidersets\//i.test(f.outputPath))),
  );

  const meshGroups = collectSliderSetMeshGroups(convertedFiles);
  if (meshGroups.length === 0) return 0;

  const projectOutputFiles = new Map<string, boolean>();
  const projectOutputPaths = new Map<string, boolean>();
  for (const projectFile of projectFiles) {
    const absPath = join(outputDir, ...projectFile.outputPath.split("/"));
    const content = await readFile(absPath, "utf8").catch(() => "");
    for (const entry of extractSliderSetCoverageEntries(content)) {
      if (!entry.hasExplicitOutputPath) {
        projectOutputFiles.set(
          entry.outputFile,
          (projectOutputFiles.get(entry.outputFile) ?? false) ||
            entry.hasSourceFile,
        );
      }
      projectOutputPaths.set(
        entry.outputPath,
        (projectOutputPaths.get(entry.outputPath) ?? false) ||
          entry.hasSourceFile,
      );
    }
  }

  const uncoveredMeshGroups = meshGroups.filter((group) => {
    const lowFile = basename(group.lowWeightPath ?? "").toLowerCase();
    const highFile = basename(group.highWeightPath ?? "").toLowerCase();
    const lowPath = normalizeSliderSetOutputPath(group.lowWeightPath ?? "");
    const highPath = normalizeSliderSetOutputPath(group.highWeightPath ?? "");
    if (!lowFile && !highFile) return false;
    if (projectOutputFiles.size === 0 && projectOutputPaths.size === 0) {
      return true;
    }
    const coveredByFile =
      (!!lowFile && (projectOutputFiles.get(lowFile) ?? false)) ||
      (!!highFile && (projectOutputFiles.get(highFile) ?? false));
    const coveredByPath =
      (!!lowPath && (projectOutputPaths.get(lowPath) ?? false)) ||
      (!!highPath && (projectOutputPaths.get(highPath) ?? false));
    return !(coveredByFile || coveredByPath);
  });
  if (uncoveredMeshGroups.length === 0) return 0;

  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[targetBodyType];
  const baseDisplayNames = uncoveredMeshGroups.map((group) =>
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
  const sliderSetEntries = uncoveredMeshGroups
    .map((group, index) => {
      const baseDisplayName = baseDisplayNames[index] ?? "";
      const needsContext =
        (baseDisplayNameCounts.get(baseDisplayName.toLowerCase()) ?? 0) > 1;
      const displayName = needsContext
        ? buildSliderSetDisplayName(group.key, targetAlias, true)
        : baseDisplayName;
      // Prefer the high-weight (_1) NIF as the BodySlide output file since
      // that is the convention used by real BodySlide project files.
      const primaryPath = group.highWeightPath ?? group.lowWeightPath;
      if (!primaryPath) return "";
      const sliderSourcePath = shapeDataMeshMap.get(primaryPath) ?? primaryPath;
      const outputPathForSliderSet = primaryPath;
      // Split into directory (with trailing slash) and filename so that
      // BodySlide can parse OutputPath + OutputFile correctly.
      const slashIndex = outputPathForSliderSet.lastIndexOf("/");
      const nifDir =
        slashIndex >= 0 ? outputPathForSliderSet.slice(0, slashIndex + 1) : "";
      const nifFile =
        slashIndex >= 0
          ? outputPathForSliderSet.slice(slashIndex + 1)
          : outputPathForSliderSet;
      const sourceFile = toBodySlideSourceFilePath(sliderSourcePath);
      const groupName = `${targetAlias} Outfits`;
      return [
        displayName,
        `  <SliderSet name="${escapeXml(displayName)}">`,
        `    <OutputPath>${escapeXml(nifDir)}</OutputPath>`,
        `    <OutputFile>${escapeXml(nifFile)}</OutputFile>`,
        `    <SourceFile>${escapeXml(sourceFile)}</SourceFile>`,
        `    <ShapeCount>1</ShapeCount>`,
        `    <DefaultWeight>1</DefaultWeight>`,
        `    <Groups>`,
        `      <Group name="${escapeXml(groupName)}"/>`,
        `    </Groups>`,
        `    <Sliders/>`,
        "  </SliderSet>",
      ];
    })
    .filter((value): value is string[] => value.length > 0);

  if (sliderSetEntries.length === 0) return 0;

  const prefix =
    projectFiles.length > 0
      ? `${targetAlias}_AutoSupplement`
      : `${targetAlias}_AutoConverted`;

  if (sliderSetEntries.length === 1) {
    const outputRelPath = `CalienteTools/BodySlide/SliderSets/${prefix}.osp`;
    const outputAbsPath = join(
      outputDir,
      "CalienteTools",
      "BodySlide",
      "SliderSets",
      `${prefix}.osp`,
    );
    const [, ...sliderSetLines] = sliderSetEntries[0] ?? [];
    const ospContent = [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<SliderSetInfo>",
      ...sliderSetLines,
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
    return 1;
  }

  const slugCounts = new Map<string, number>();
  for (const entry of sliderSetEntries) {
    const displayName = entry[0] ?? "";
    const sliderSetLines = entry.slice(1);
    if (sliderSetLines.length === 0) continue;
    const baseSlug = toSliderSetFileToken(displayName);
    const nextCount = (slugCounts.get(baseSlug) ?? 0) + 1;
    slugCounts.set(baseSlug, nextCount);
    const disambiguatedSlug =
      nextCount > 1 ? `${baseSlug}_${nextCount}` : baseSlug;
    const fileName = `${prefix}_${disambiguatedSlug}.osp`;
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
      ...sliderSetLines,
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
  }

  return sliderSetEntries.length;
}

function toShapeDataPath(meshPath: string, targetAlias: string): string {
  const normalized = meshPath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const fileName =
    slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const meshDir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
  const relativeMeshDir = meshDir.replace(/^meshes\//i, "");
  const outputDir = relativeMeshDir
    ? `CalienteTools/BodySlide/ShapeData/${targetAlias}/${relativeMeshDir}`
    : `CalienteTools/BodySlide/ShapeData/${targetAlias}`;
  return `${outputDir}/${fileName}`;
}

function toRuntimeMeshPathFromShapeData(shapeDataPath: string): string | null {
  const normalized = shapeDataPath.replace(/\\/g, "/");
  const shapeDataSubpath = extractBodySlideSubpath(
    normalized,
    BODYSLIDE_SHAPEDATA_PATH_MARKERS,
  );
  if (!shapeDataSubpath) {
    return null;
  }
  const segments = shapeDataSubpath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const firstSegment = segments[0] ?? "";
  const knownOutputAliases = new Set(
    Object.values(BODY_TYPE_OUTPUT_ALIASES).map((alias) => alias.toLowerCase()),
  );
  const runtimeSegments =
    knownOutputAliases.has(firstSegment.toLowerCase()) && segments.length > 1
      ? segments.slice(1)
      : segments;
  if (runtimeSegments.length === 0) {
    return null;
  }
  return `meshes/${runtimeSegments.join("/")}`;
}

function toBodySlideSourceFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const sourceSubpath = extractBodySlideSubpath(
    normalized,
    BODYSLIDE_SHAPEDATA_PATH_MARKERS,
  );
  return sourceSubpath ?? basename(normalized);
}

async function synthesizeMissingShapeDataMeshes(
  outputDir: string,
  targetBodyType: BodyType,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<Map<string, string>> {
  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[targetBodyType];
  const outputPathMap = new Map<string, string>();
  const knownOutputPaths = new Set(
    convertedFiles.map((file) => file.outputPath),
  );
  const meshCandidates = convertedFiles.filter(
    (file) =>
      file.kind === "mesh" &&
      file.outputPath.toLowerCase().endsWith(".nif") &&
      isArmorOrClothingNif(file.outputPath),
  );

  for (const meshFile of meshCandidates) {
    const shapeDataPath = toShapeDataPath(meshFile.outputPath, targetAlias);
    outputPathMap.set(meshFile.outputPath, shapeDataPath);
    if (knownOutputPaths.has(shapeDataPath)) {
      continue;
    }

    const sourceAbs = join(outputDir, meshFile.outputPath);
    const shapeDataAbs = join(outputDir, shapeDataPath);
    if (await pathExists(shapeDataAbs)) {
      knownOutputPaths.add(shapeDataPath);
      continue;
    }

    await mkdir(dirname(shapeDataAbs), { recursive: true });
    await copyFile(sourceAbs, shapeDataAbs);
    knownOutputPaths.add(shapeDataPath);
    convertedFiles.push({
      sourcePath: meshFile.sourcePath,
      outputPath: shapeDataPath,
      kind: "mesh",
      action: "synthesized",
    });

    const basePath = meshFile.outputPath.replace(/\.nif$/i, "");
    const sourceCompanions = [".tri", ".osd"]
      .map((extension) => `${basePath}${extension}`)
      .map((outputPath) =>
        convertedFiles.find(
          (candidate) =>
            candidate.kind === "mesh" &&
            candidate.outputPath.toLowerCase() === outputPath.toLowerCase(),
        ),
      )
      .filter((value): value is (typeof convertedFiles)[number] =>
        Boolean(value),
      );

    for (const companion of sourceCompanions) {
      const companionShapeDataPath = toShapeDataPath(
        companion.outputPath,
        targetAlias,
      );
      if (knownOutputPaths.has(companionShapeDataPath)) {
        continue;
      }

      const companionSourceAbs = join(outputDir, companion.outputPath);
      if (!(await pathExists(companionSourceAbs))) {
        continue;
      }

      const companionShapeDataAbs = join(outputDir, companionShapeDataPath);
      await mkdir(dirname(companionShapeDataAbs), { recursive: true });
      await copyFile(companionSourceAbs, companionShapeDataAbs);
      knownOutputPaths.add(companionShapeDataPath);
      convertedFiles.push({
        sourcePath: companion.sourcePath,
        outputPath: companionShapeDataPath,
        kind: "mesh",
        action: "synthesized",
      });
    }
  }

  return outputPathMap;
}

async function synthesizeMissingRuntimeMeshesFromShapeData(
  outputDir: string,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<Map<string, string>> {
  const knownOutputPaths = new Set(
    convertedFiles.map((file) => file.outputPath.toLowerCase()),
  );
  const runtimeToShapeDataPath = new Map<string, string>();
  const shapeDataCandidates = convertedFiles.filter(
    (file) =>
      file.kind === "mesh" &&
      /\.(nif|tri|osd)$/i.test(file.outputPath) &&
      /(^|\/)calientetools\/bodyslide\/shapedata\//i.test(file.outputPath),
  );

  for (const shapeDataFile of shapeDataCandidates) {
    const runtimeMeshPath = toRuntimeMeshPathFromShapeData(
      shapeDataFile.outputPath,
    );
    if (!runtimeMeshPath) {
      continue;
    }
    if (knownOutputPaths.has(runtimeMeshPath.toLowerCase())) {
      runtimeToShapeDataPath.set(runtimeMeshPath, shapeDataFile.outputPath);
      continue;
    }

    const sourceAbsPath = join(outputDir, shapeDataFile.outputPath);
    const runtimeAbsPath = join(outputDir, runtimeMeshPath);
    if (await pathExists(runtimeAbsPath)) {
      knownOutputPaths.add(runtimeMeshPath.toLowerCase());
      runtimeToShapeDataPath.set(runtimeMeshPath, shapeDataFile.outputPath);
      continue;
    }

    await mkdir(dirname(runtimeAbsPath), { recursive: true });
    await copyFile(sourceAbsPath, runtimeAbsPath);
    knownOutputPaths.add(runtimeMeshPath.toLowerCase());
    convertedFiles.push({
      sourcePath: shapeDataFile.sourcePath,
      outputPath: runtimeMeshPath,
      kind: "mesh",
      action: "synthesized",
    });
    runtimeToShapeDataPath.set(runtimeMeshPath, shapeDataFile.outputPath);
  }

  return runtimeToShapeDataPath;
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
const CBPC_GENITALS_DEFAULT = "0.350";
const CBPC_SCROTUM_DEFAULT = "0.250";

function cbpcDefaultWeight(boneName: string): string {
  const lower = boneName.toLowerCase();
  if (lower.includes("breastroot")) return CBPC_BREASTROOT_DEFAULT;
  if (lower.includes("breast")) return CBPC_BREAST_DEFAULT;
  if (lower.includes("butt")) return CBPC_BUTT_DEFAULT;
  if (lower.includes("belly")) return CBPC_BELLY_DEFAULT;
  if (lower.includes("scrotum")) return CBPC_SCROTUM_DEFAULT;
  if (lower.includes("genitals")) return CBPC_GENITALS_DEFAULT;
  return CBPC_BREAST_DEFAULT;
}

/**
 * Returns true when `content` + its output path look like a CBPC physics INI
 * (bone=weight lines under a CBPC-related path, or with bone references in
 * the content itself).  Used to gate physics-bone patching so we don't append
 * CBPC lines to unrelated INI files.
 */
function looksLikeCbpcConfig(content: string, outputPath: string): boolean {
  const lowerPath = outputPath.toLowerCase().replace(/\\/g, "/");
  const pathIsCbpc =
    lowerPath.includes("cbpc") ||
    lowerPath.includes("hdt") ||
    lowerPath.includes("physics");
  if (!pathIsCbpc) return false;
  // Confirm the content contains at least one bone=weight assignment so we
  // don't misidentify an empty or comment-only INI as a config file.
  return /^[A-Za-z][^\n=]*=[0-9.]+/m.test(content.slice(0, 8192));
}

/**
 * When converting to a physics-capable target body the source mod may contain
 * a physics config that covers only a subset of the bones required by the
 * target.  This function appends any missing required bones (with sensible
 * default weights) so the converted config is complete.
 *
 * It is a no-op for non-physics targets and for files that don't look like
 * CBPC configs.
 */
function ensureTargetPhysicsBonesPresent(
  content: string,
  outputPath: string,
  target: BodyType,
): string {
  const targetInfo = BODY_TYPE_INFO[target];
  if (!targetInfo.physicsSupport || targetInfo.physicsBones.length === 0) {
    return content;
  }
  if (extname(outputPath).toLowerCase() !== ".ini") {
    return content;
  }
  if (!looksLikeCbpcConfig(content, outputPath)) {
    return content;
  }
  const lowerContent = content.toLowerCase();
  const missingBones = targetInfo.physicsBones.filter(
    (bone) => !lowerContent.includes(bone.toLowerCase()),
  );
  if (missingBones.length === 0) return content;
  const targetAlias = BODY_TYPE_OUTPUT_ALIASES[target];
  const patch = [
    "",
    `; Missing physics chain bones added by SlideSmith (required for ${targetAlias})`,
    ...missingBones.map((bone) => `${bone}=${cbpcDefaultWeight(bone)}`),
    "",
  ].join("\n");
  return `${content.trimEnd()}\n${patch}`;
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
  const hasPhysicsConfig = convertedFiles.some((f) => {
    if (f.action === "synthesized" || f.kind !== "text") {
      return false;
    }
    const normalizedPath = f.outputPath.toLowerCase().replace(/\\/g, "/");
    const extension = extname(normalizedPath);
    if (![".ini", ".xml", ".txt", ".json"].includes(extension)) {
      return false;
    }
    return (
      normalizedPath.includes("/skse/plugins/cbpc/") ||
      normalizedPath.includes("/cbpc/") ||
      normalizedPath.includes("hdt") ||
      normalizedPath.includes("physics")
    );
  });
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

async function synthesizeMissingOutfitSliderDataMeshes(
  outputDir: string,
  convertedFiles: ConversionResult["convertedFiles"],
): Promise<number> {
  const knownOutputPaths = new Set(
    convertedFiles.map((file) => file.outputPath.toLowerCase()),
  );
  const runtimeNifGroups = new Set(
    convertedFiles
      .filter(
        (file) =>
          file.kind === "mesh" &&
          file.outputPath.toLowerCase().endsWith(".nif") &&
          isArmorOrClothingNif(file.outputPath),
      )
      .map((file) =>
        file.outputPath
          .replace(/\\/g, "/")
          .replace(/_0\.nif$/i, "")
          .replace(/_1\.nif$/i, "")
          .toLowerCase(),
      ),
  );
  const byLowerPath = new Map(
    convertedFiles.map(
      (file) => [file.outputPath.toLowerCase(), file] as const,
    ),
  );
  let synthesizedCount = 0;

  for (const groupBasePath of runtimeNifGroups) {
    const candidateTemplates = {
      _0: `${groupBasePath}_0.nif`,
      _1: `${groupBasePath}_1.nif`,
    };
    for (const weight of ["_0", "_1"] as const) {
      const otherWeight = weight === "_0" ? "_1" : "_0";
      for (const extension of [".tri", ".osd"] as const) {
        const outputPath = `${groupBasePath}${weight}${extension}`;
        if (knownOutputPaths.has(outputPath)) {
          continue;
        }

        const sourceCandidates = [
          `${groupBasePath}${otherWeight}${extension}`,
          candidateTemplates[weight],
          candidateTemplates[otherWeight],
        ];
        const sourcePath =
          sourceCandidates.find((candidate) =>
            knownOutputPaths.has(candidate),
          ) ?? null;
        if (!sourcePath) {
          continue;
        }

        const sourceEntry = byLowerPath.get(sourcePath);
        if (!sourceEntry) {
          continue;
        }
        const sourceOutputPath = sourceEntry.outputPath;
        const baseOutputPath = sourceOutputPath.replace(
          /(_0|_1)\.(nif|tri|osd)$/i,
          "",
        );
        const targetOutputPath = `${baseOutputPath}${weight}${extension}`;
        if (knownOutputPaths.has(targetOutputPath.toLowerCase())) {
          continue;
        }

        const sourceAbsolutePath = join(outputDir, sourceOutputPath);
        const targetAbsolutePath = join(outputDir, targetOutputPath);
        if (!(await pathExists(sourceAbsolutePath))) {
          continue;
        }
        if (await pathExists(targetAbsolutePath)) {
          knownOutputPaths.add(targetOutputPath.toLowerCase());
          continue;
        }

        await mkdir(dirname(targetAbsolutePath), { recursive: true });
        await copyFile(sourceAbsolutePath, targetAbsolutePath);
        knownOutputPaths.add(targetOutputPath.toLowerCase());
        const synthesizedEntry = {
          sourcePath: sourceEntry.sourcePath,
          outputPath: targetOutputPath,
          kind: "mesh" as const,
          action: "synthesized" as const,
        };
        convertedFiles.push(synthesizedEntry);
        byLowerPath.set(targetOutputPath.toLowerCase(), synthesizedEntry);
        synthesizedCount += 1;
      }
    }
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

function rewriteBodyMetadataContent(
  content: string,
  source: BodyType,
  target: BodyType,
): string {
  return replaceAliases(
    replacePhysicsReferences(
      rewriteGenderMarkers(content, source, target),
      source,
      target,
    ),
    source,
    target,
  );
}

function isLikelyUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  const decoded = buffer.toString("utf8");
  const replacementCount = (decoded.match(UTF8_REPLACEMENT_CHAR_RE) ?? [])
    .length;
  return replacementCount <= Math.max(3, Math.floor(decoded.length * 0.01));
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

  const physicsRemapPlan = buildPhysicsRemapPlan(source, target);
  const fallbackPhysicsSteps = physicsRemapPlan.steps.filter(
    (step) => step.kind === "fallback",
  ).length;
  if (
    sourceInfo.physicsSupport &&
    targetInfo.physicsSupport &&
    fallbackPhysicsSteps > 0
  ) {
    const mappedPhysicsSteps =
      physicsRemapPlan.steps.length - fallbackPhysicsSteps;
    warnings.push(
      `Physics remap coverage for '${source}' → '${target}' is ${mappedPhysicsSteps}/${physicsRemapPlan.steps.length}. ${fallbackPhysicsSteps} source physics bone reference(s) were collapsed to static fallback bones due to missing safe target-chain equivalents.`,
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
    `Target skeleton note (${target.toUpperCase()}): ${targetInfo.skeletonProfile}. ${targetInfo.skeletonNotes}`,
  );
  warnings.push(
    `Target body knowledge note (${target.toUpperCase()}): ${targetKnowledgeSummary}`,
  );

  return warnings;
}

// ── Body-replacer NIF detection ───────────────────────────────────────────────
// These are the canonical body-mesh filenames Skyrim uses for character bodies
// (as opposed to armor/clothing outfits).  NIFs that match are preserved in
// place rather than renamed with a body-type alias prefix.
const BODY_REPLACER_BASENAMES = new Set([
  "femalebody",
  "malebody",
  "femalehands",
  "malehands",
  "femalefeet",
  "malefeet",
  "femalehead",
  "malehead",
  "1stpersonfemalehands",
  "1stpersonmalehands",
]);

const BODY_ASSET_PATH_FRAGMENTS = [
  "actors/character/character assets/",
  "actors/character/character assets female/",
  "actors/character/character assets male/",
];

const OUTFIT_MESH_PATH_FRAGMENTS = [
  "/meshes/armor/",
  "/meshes/armors/",
  "/meshes/clothes/",
  "/meshes/clothing/",
  "/meshes/outfit/",
  "/meshes/outfits/",
  "/meshes/apparel/",
  "/meshes/armour/",
  "/calientetools/bodyslide/shapedata/",
  "/bodyslide/shapedata/",
];

const OUTFIT_MESH_FILENAME_HINTS = [
  "_0.nif",
  "_1.nif",
  "outfit",
  "armor",
  "armour",
  "cuirass",
  "gauntlet",
  "glove",
  "boot",
  "greave",
  "helmet",
  "hood",
  "robe",
  "shirt",
  "blouse",
  "pants",
  "trouser",
  "skirt",
  "jacket",
  "coat",
  "dress",
  "sleeve",
  "stocking",
  "sock",
  "shoe",
  "panty",
  "bra",
  "harness",
  "bodysuit",
  "vest",
  "cloak",
  "cape",
  "mask",
  "corset",
  "bikini",
];

/**
 * Returns true when `relativePath` refers to a body-replacer NIF — i.e. a
 * mesh that replaces the player/NPC body itself rather than an outfit or
 * piece of armor.  Such files must be preserved at their original location
 * and must NOT be renamed with a body-type alias prefix.
 */
function isBodyReplacerNif(relativePath: string): boolean {
  const lower = relativePath.toLowerCase().replace(/\\/g, "/");
  if (!lower.endsWith(".nif")) return false;
  // Path-based: any NIF under the standard character assets directories.
  if (BODY_ASSET_PATH_FRAGMENTS.some((frag) => lower.includes(frag))) {
    return true;
  }
  // Name-based: canonical body mesh filenames regardless of directory.
  const filename = lower.split("/").at(-1) ?? lower;
  const baseName = filename.replace(/_[01]\.nif$/, "").replace(/\.nif$/, "");
  return BODY_REPLACER_BASENAMES.has(baseName);
}

function isArmorOrClothingNif(relativePath: string): boolean {
  const lower = relativePath.toLowerCase().replace(/\\/g, "/");
  if (!lower.endsWith(".nif")) return false;
  if (OUTFIT_MESH_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return true;
  }
  const filename = lower.split("/").at(-1) ?? lower;
  return OUTFIT_MESH_FILENAME_HINTS.some((hint) => filename.includes(hint));
}

const BODY_CONVERTIBLE_NIF_HINTS = [
  "_0.nif",
  "_1.nif",
  "body",
  "outfit",
  "armor",
  "armour",
  "clothes",
  "clothing",
  "shirt",
  "blouse",
  "pants",
  "trouser",
  "skirt",
  "jacket",
  "coat",
  "dress",
  "sleeve",
  "stocking",
  "sock",
  "shoe",
  "panty",
  "bra",
  "harness",
  "bodysuit",
  "vest",
  "cloak",
  "cape",
  "mask",
  "corset",
  "bikini",
  "top",
  "bottom",
  "cbbe",
  "3ba",
  "uunp",
  "bhunp",
  "ube",
  "tbd",
  "himbo",
  "bodytalk",
  "sam",
  "sos",
];
const NON_BODY_NIF_PATH_FRAGMENTS = [
  "meshes/weapons/",
  "meshes/architecture/",
  "meshes/clutter/",
  "meshes/landscape/",
  "meshes/terrain/",
  "meshes/trees/",
  "meshes/plants/",
  "meshes/furniture/",
  "meshes/effects/",
  "meshes/magic/",
  "meshes/lod/",
];

function isLikelyBodyConvertibleNif(relativePath: string): boolean {
  const lower = relativePath.toLowerCase().replace(/\\/g, "/");
  if (!lower.endsWith(".nif")) return false;
  if (
    NON_BODY_NIF_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment))
  ) {
    return false;
  }
  if (isArmorOrClothingNif(relativePath)) {
    return true;
  }
  const filename = lower.split("/").at(-1) ?? lower;
  return BODY_CONVERTIBLE_NIF_HINTS.some(
    (hint) => filename.includes(hint) || lower.includes(`/${hint}`),
  );
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
    // Body-replacer NIFs (femalebody, malebody, etc.) use fixed runtime paths.
    // Same-body conversions preserve them at original path; cross-body runs
    // intentionally skip copying source body replacers because native mode does
    // not reproject topology and copying would override the chosen target body.
    if (file.extension === ".nif" && isBodyReplacerNif(file.relativePath)) {
      const preservedPath = normalizeToMo2DataPath(
        file.relativePath.replace(/\\/g, "/"),
        file.extension,
        file.preview,
      );
      if (sourceBodyType === targetBodyType) {
        const preservedAbsPath = join(outputDir, preservedPath);
        await mkdir(dirname(preservedAbsPath), { recursive: true });
        await copyFile(file.absolutePath, preservedAbsPath);
      }
      skippedFiles.push({
        sourcePath: file.relativePath,
        outputPath: preservedPath,
        reason:
          sourceBodyType === targetBodyType
            ? "Body replacer mesh — preserved at original path without body-type conversion."
            : `Body replacer mesh — skipped for ${sourceBodyType} → ${targetBodyType} conversion to avoid forcing source-body skin/shape over the selected target body.`,
      });
      continue;
    }

    if (
      file.extension === ".nif" &&
      !isLikelyBodyConvertibleNif(file.relativePath)
    ) {
      const preservedPath = normalizeToMo2DataPath(
        file.relativePath.replace(/\\/g, "/"),
        file.extension,
        file.preview,
      );
      const preservedAbsPath = join(outputDir, preservedPath);
      await mkdir(dirname(preservedAbsPath), { recursive: true });
      await copyFile(file.absolutePath, preservedAbsPath);
      skippedFiles.push({
        sourcePath: file.relativePath,
        outputPath: preservedPath,
        reason:
          "NIF appears unrelated to body/outfit conversion — preserved without body-type conversion.",
      });
      continue;
    }

    const rewrittenRelativePath = normalizeToMo2DataPath(
      rewriteRelativePath(file.relativePath, sourceBodyType, targetBodyType),
      file.extension,
      file.preview,
    );
    const outputPath = join(outputDir, rewrittenRelativePath);
    await mkdir(dirname(outputPath), { recursive: true });

    if (TEXT_EXTENSIONS.has(file.extension)) {
      const sourcePathLower = file.relativePath
        .toLowerCase()
        .replace(/\\/g, "/");
      if (
        sourcePathLower.startsWith(FOMOD_METADATA_PREFIX) ||
        sourcePathLower.includes(`/${FOMOD_METADATA_PREFIX}`)
      ) {
        await copyFile(file.absolutePath, outputPath);
        convertedFiles.push({
          sourcePath: file.relativePath,
          outputPath: rewrittenRelativePath,
          kind: "text",
          action: "copied",
        });
        continue;
      }

      const content = await readFile(file.absolutePath, "utf8");
      const nextContent = ensureTargetPhysicsBonesPresent(
        rewriteBodyMetadataContent(content, sourceBodyType, targetBodyType),
        rewrittenRelativePath,
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

    if (file.extension === ".osd") {
      const rawContent = await readFile(file.absolutePath);
      if (!isLikelyUtf8Text(rawContent)) {
        await copyFile(file.absolutePath, outputPath);
        convertedFiles.push({
          sourcePath: file.relativePath,
          outputPath: rewrittenRelativePath,
          kind: "mesh",
          action: "copied",
        });
        continue;
      }

      const content = rawContent.toString("utf8");
      const nextContent = rewriteBodyMetadataContent(
        content,
        sourceBodyType,
        targetBodyType,
      );
      await writeFile(outputPath, nextContent, "utf8");
      convertedFiles.push({
        sourcePath: file.relativePath,
        outputPath: rewrittenRelativePath,
        kind: "mesh",
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

  const synthesizedSliderDataMeshes =
    await synthesizeMissingOutfitSliderDataMeshes(outputDir, convertedFiles);
  if (synthesizedSliderDataMeshes > 0) {
    skippedFiles.push({
      sourcePath: "(native post-process)",
      outputPath: "(generated outfit tri/osd companions)",
      reason: `Synthesized ${synthesizedSliderDataMeshes} missing TRI/OSD companion mesh entr${synthesizedSliderDataMeshes === 1 ? "y" : "ies"} so vanilla-style outfits have per-outfit slider data files.`,
    });
  }

  const shapeDataMeshes = await synthesizeMissingShapeDataMeshes(
    outputDir,
    targetBodyType,
    convertedFiles,
  );
  if (shapeDataMeshes.size > 0) {
    skippedFiles.push({
      sourcePath: "(native post-process)",
      outputPath: "(generated bodyslide shapedata)",
      reason: `Synthesized ${shapeDataMeshes.size} BodySlide ShapeData mesh entr${shapeDataMeshes.size === 1 ? "y" : "ies"} for SliderSet SourceFile/OutputPath compatibility.`,
    });
  }

  const synthesizedRuntimeMeshes =
    await synthesizeMissingRuntimeMeshesFromShapeData(
      outputDir,
      convertedFiles,
    );
  for (const [runtimeMeshPath, shapeDataPath] of synthesizedRuntimeMeshes) {
    shapeDataMeshes.set(runtimeMeshPath, shapeDataPath);
  }
  if (synthesizedRuntimeMeshes.size > 0) {
    skippedFiles.push({
      sourcePath: "(native post-process)",
      outputPath: "(generated runtime meshes from shapedata)",
      reason: `Synthesized ${synthesizedRuntimeMeshes.size} runtime mesh entr${synthesizedRuntimeMeshes.size === 1 ? "y" : "ies"} from BodySlide ShapeData so generated SliderSets have valid game output paths.`,
    });
  }

  const synthesizedSliderSets = await synthesizeMissingSliderSetProject(
    outputDir,
    targetBodyType,
    convertedFiles,
    shapeDataMeshes,
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
