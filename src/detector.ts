import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import type { BodyType, DetectionResult, ScannedFile } from "./types.js";
import { BODY_TYPES } from "./types.js";

type WeightedSignal = RegExp | readonly [RegExp, number];
type GenderHint = "female" | "male" | "neutral";
type EvidenceKind = "mesh" | "sliders" | "config" | "metadata";

// Each array can contain plain RegExp (1 point) or a tuple [RegExp, weight] for custom weighting.
// The haystack per file is: relativePath + "\n" + basename + "\n" + first-4KB binary preview (latin1 lowercase).
// Physics config file names and BodySlide folder structures are strong signals.
const SIGNALS: Record<BodyType, WeightedSignal[]> = {
  cbbe: [
    [/\bcbbe\b/, 2],
    [/caliente/, 2],
    [/calientetools/, 2],
    [/cbbe curvy/, 1.8],
    [/cbbe slim/, 1.8],
    [/cbbe[_ -]?body/, 1.5],
    // BodySlide folder structure
    [/bodyslide[/\\]slidersets[/\\][^/\\]*cbbe/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*cbbe/, 2.5],
    // Skeleton / NIF bone names embedded in binary NIF previews
    [/npc l breast/, 0.7],
    [/npc r breast/, 0.7],
    [/npc l butt/, 0.7],
    [/npc r butt/, 0.7],
    // CBPC config with CBBE-specific sections
    [/cbpc.*cbbe/, 1.5],
    [/cbbe.*cbpc/, 1.5],
  ],
  "3ba": [
    [/cbbe[_ -]?3ba/, 2.8],
    [/cbbe[_ -]?3bbb/, 2.8],
    [/\b3ba\b/, 2.2],
    [/\b3bbb\b/, 2.2],
    [/3bbb amazing/, 2.5],
    [/3ba body/, 2],
    [/acro748/, 1.5],
    // "CBBE SMP" and "CBBE Physics" are physics-enabled CBBE variants sharing 3BA bones
    [/cbbe[_ -]?smp/, 1.9],
    [/cbbe[_ -]?physics/, 1.7],
    // Physics chain bones unique to 3BA (in NIF or CBPC configs)
    [/npc lbreastroot/, 2.5],
    [/npc rbreastroot/, 2.5],
    [/npc l breast0[123]/, 2],
    [/npc r breast0[123]/, 2],
    [/npc bellyroot/, 2],
    [/npc belly/, 1.8],
    // HDT-SMP or CBPC config referencing 3BA
    [/hdtphysicsextensions.*3b/, 2],
    [/3ba.*cbpc/, 1.8],
    [/cbpc.*3ba/, 1.8],
    // BodySlide project files
    [/bodyslide[/\\]slidersets[/\\][^/\\]*3b/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*3b/, 2.5],
  ],
  himbo: [
    [/\bhimbo\b/, 2.5],
    [/highly improved male body/, 2.5],
    [/himbo body/, 2.2],
    [/himbo v[45]/, 2.2],
    [/high poly male body/, 1.8],
    [/highpolymalebody/, 1.8],
    [/tiktak/, 1.4],
    // HIMBO Physics Addon bones (NPC L/R Pectoral)
    [/npc [lr] pectoral/, 2],
    // Male-only skeleton signals
    [/malebody/, 0.6],
    [/male_body/, 0.6],
    // HIMBO BodySlide project files
    [/bodyslide[/\\]slidersets[/\\][^/\\]*himbo/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*himbo/, 2.5],
  ],
  bodytalk: [
    [/\bbodytalk\b/, 2.8],
    [/bodytalk[_ -]?v?[23]/, 2.8],
    [/\bbt[23]\b/, 2.2],
    [/bodytalk body/, 2.2],
    [/bodytalk[_ -]?body/, 2.4],
    [/bad dog/, 1.4],
    [/haeun/, 1.4],
    [/malebody/, 0.7],
    [/male_body/, 0.7],
    [/bodyslide[/\\]slidersets[/\\][^/\\]*bodytalk/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*bodytalk/, 2.5],
  ],
  tbd: [
    [/\btbd\b/, 2.5],
    [/touched by dibella/, 2.5],
    [/touchedbydibella/, 2.5],
    [/tbd body/, 2],
    [/maars/, 1.5],
    // TBD uses same breast-butt bones as CBBE but project files are named tbd
    [/bodyslide[/\\]slidersets[/\\][^/\\]*tbd/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*tbd/, 2.5],
    // CBPC/HDT-SMP configs for TBD use standard CBBE bone names
    [/cbpc.*tbd/, 1.8],
    [/tbd.*cbpc/, 1.8],
  ],
  sos: [
    [/\bsos\b/, 1.4],
    [/schlongs of skyrim/, 3],
    [/schlongsofskyrim/, 3],
    [/sos body/, 2.2],
    [/sos[-_ ]regular/, 2.4],
    [/sos[-_ ]light/, 2.4],
    [/sos[-_ ]?[as]e/, 2],
    [/b3lisario/, 1.4],
    [/\bschlong\b/, 1.8],
    // SOS genital bone names (in NIF binary previews)
    [/npc genitalsbase/, 3],
    [/npc l genitalsscrotum/, 2.5],
    [/npc r genitalsscrotum/, 2.5],
    // SOS partition reference
    [/sbp_52/, 2.5],
    [/genitals/, 1.5],
    // SOS BodySlide project files
    [/bodyslide[/\\]slidersets[/\\][^/\\]*sos/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*sos/, 2.5],
  ],
  unp: [
    [/\bunp\b/, 2],
    [/dimonized/, 2],
    [/dimon99/, 2],
    [/\bunpb\b/, 1.5],
    // UNP BodySlide folder entries
    [/bodyslide[/\\]slidersets[/\\][^/\\]*unp/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*unp/, 2.5],
  ],
  bhunp: [
    [/\bbhunp\b/, 3],
    [/bonehunger unp/, 2.5],
    [/unp 3bbb/, 2.5],
    [/bhunp 3bbb/, 2.8],
    [/unp next generation/, 2.2],
    // Physics bones with BHUNP naming (all three chain levels)
    [/bhunp breast [lr]01/, 2.2],
    [/bhunp breast [lr]02/, 2.2],
    [/bhunp breast [lr]03/, 2.2],
    [/bhunp butt [lr]/, 2.2],
    [/bodyslide[/\\]slidersets[/\\][^/\\]*bhunp/, 2.8],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*bhunp/, 2.8],
  ],
  uunp: [
    [/\buunp\b/, 2.6],
    [/unified unp/, 2.6],
    [/uunp special/, 2.8],
    [/ousnius.*unp/, 1.5],
    [/bodyslide[/\\]slidersets[/\\][^/\\]*uunp/, 2.8],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*uunp/, 2.8],
  ],
  "7base": [
    [/\b7base\b/, 2.6],
    [/sevenbase/, 2.6],
    [/seven base/, 2.6],
    [/crosscrusade/, 1.5],
    [/7b body/, 2],
    [/bodyslide[/\\]slidersets[/\\][^/\\]*7base/, 2.8],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*7base/, 2.8],
  ],
  sam: [
    // Avoid broad /\bsam\b/ to prevent false positives on random filenames
    [/shape atlas for men/, 3],
    [/sam light/, 2.8],
    [/vectorplexus/, 2],
    [/koulei.*sam/, 2],
    [/samlight/, 2.4],
    // SAM BodyMorph and RaceMenu morph signals
    [/sam_volume/, 2.5],
    [/sam_genital/, 2.5],
    [/samlightbodyconfig/, 2.2],
    [/bodymorph.*sam/, 1.8],
    // SAM BodySlide project files
    [/bodyslide[/\\]slidersets[/\\][^/\\]*sam/, 2.5],
    [/bodyslide[/\\]shapedata[/\\][^/\\]*sam/, 2.5],
  ],
  vanilla: [
    [/\bvanilla\b/, 2.4],
    [/default body/, 2.2],
    [/base game body/, 2.2],
    [/bethesda.*body/, 2],
    // Vanilla bodies are found directly in meshes/actors/character/
    [
      /meshes[/\\]actors[/\\]character[/\\]character assets[/\\]femalebody/,
      2.2,
    ],
    [/meshes[/\\]actors[/\\]character[/\\]character assets[/\\]malebody/, 2.2],
  ],
};

const BODY_KEYWORDS: Record<BodyType, string[]> = {
  cbbe: ["cbbe", "caliente"],
  "3ba": ["3ba", "3bbb", "amazing body"],
  himbo: ["himbo", "highly improved male body", "highpolymalebody"],
  bodytalk: ["bodytalk", "bt2", "bt3"],
  tbd: ["tbd", "touched by dibella"],
  sos: ["sos", "schlongs of skyrim", "schlong"],
  unp: ["unp", "unpb", "dimonized"],
  bhunp: ["bhunp", "bonehunger unp"],
  uunp: ["uunp", "unified unp"],
  "7base": ["7base", "sevenbase"],
  sam: ["sam light", "shape atlas for men", "samlight", "sam_volume"],
  vanilla: ["vanilla", "default body", "base game body"],
};

const FALSE_POSITIVE_PENALTIES: Record<BodyType, Array<[RegExp, number]>> = {
  cbbe: [
    [/\b3ba\b|\b3bbb\b/, 0.9],
    [/cbbe[_ -]?smp|cbbe[_ -]?physics/, 1],
    [/\btbd\b|touched by dibella/, 0.8],
    [/\bbhunp\b|\buunp\b|\b7base\b/, 0.7],
    [/\bhimbo\b|\bbodytalk\b|\bsamlight\b|shape atlas for men/, 1.2],
  ],
  "3ba": [[/\bbhunp\b|\buunp\b|\b7base\b/, 0.9]],
  himbo: [[/\bbodytalk\b|bt3\b|schlongs of skyrim/, 0.6]],
  bodytalk: [[/\bhimbo\b|highpolymalebody/, 0.5]],
  tbd: [[/\bcbbe\b|caliente/, 0.35]],
  sos: [[/\bhimbo\b|bodytalk/, 0.45]],
  unp: [[/\bbhunp\b|\buunp\b|\b7base\b/, 0.85]],
  bhunp: [[/\buunp\b|\b7base\b/, 0.35]],
  uunp: [[/\bbhunp\b|\b7base\b/, 0.35]],
  "7base": [[/\bbhunp\b|\buunp\b/, 0.35]],
  sam: [[/\bhimbo\b|\bbodytalk\b/, 0.25]],
  vanilla: [],
};

function getSignalParts(signal: WeightedSignal): {
  pattern: RegExp;
  weight: number;
} {
  if (signal instanceof RegExp) {
    return { pattern: signal, weight: 1 };
  }

  return { pattern: signal[0], weight: signal[1] };
}

function scoreGenderHint(file: ScannedFile, bodyType: BodyType): number {
  const info = BODY_TYPE_INFO[bodyType];
  const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
  const hint = detectGenderHint(haystack);

  if (info.gender === "female") {
    if (hint === "female") return 0.35;
    if (hint === "male") return -0.3;
    return 0;
  }

  if (info.gender === "male") {
    if (hint === "male") return 0.35;
    if (hint === "female") return -0.3;
    return 0;
  }

  return 0;
}

function detectGenderHint(haystack: string): GenderHint {
  const hasFemale = /(femalebody|femalehands|femalefeet|1stpersonfemale)/.test(
    haystack,
  );
  const hasMale = /(malebody|malehands|malefeet|1stpersonmale)/.test(haystack);

  if (hasFemale && !hasMale) return "female";
  if (hasMale && !hasFemale) return "male";
  return "neutral";
}

function scoreKeywordHit(haystack: string, bodyType: BodyType): number {
  const keywords = BODY_KEYWORDS[bodyType];
  let matches = 0;

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      matches += 1;
    }
  }

  return Math.min(matches, 2) * 0.25;
}

function scoreStructureHint(file: ScannedFile, bodyType: BodyType): number {
  const path = file.relativePath.toLowerCase().replace(/\\/g, "/");
  let bonus = 0;

  if (
    path.includes("calientetools/bodyslide/slidersets/") ||
    path.includes("calientetools/bodyslide/shapedata/") ||
    path.includes("calientetools/bodyslide/slidergroups/")
  ) {
    bonus += 0.35;
  }

  const keywordInPath = BODY_KEYWORDS[bodyType].some((keyword) =>
    path.includes(keyword),
  );
  if (keywordInPath && path.includes("bodyslide/")) {
    bonus += 0.4;
  }

  if (
    BODY_TYPE_INFO[bodyType].gender === "female" &&
    /meshes\/actors\/character\/character assets\/female/.test(path)
  ) {
    bonus += 0.25;
  }

  if (
    BODY_TYPE_INFO[bodyType].gender === "male" &&
    /meshes\/actors\/character\/character assets\/male/.test(path)
  ) {
    bonus += 0.25;
  }

  return bonus;
}

function scoreFalsePositivePenalty(
  haystack: string,
  bodyType: BodyType,
): number {
  const penalties = FALSE_POSITIVE_PENALTIES[bodyType];
  let penalty = 0;
  for (const [pattern, value] of penalties) {
    if (pattern.test(haystack)) {
      penalty += value;
    }
  }
  return penalty;
}

function getEvidenceKind(file: ScannedFile): EvidenceKind {
  const path = file.relativePath.toLowerCase();

  if (
    file.extension === ".nif" ||
    file.extension === ".tri" ||
    file.extension === ".osd"
  ) {
    return "mesh";
  }

  if (
    file.extension === ".osp" ||
    (file.extension === ".xml" && path.includes("bodyslide"))
  ) {
    return "sliders";
  }

  if (file.extension === ".ini" || file.extension === ".json") {
    return "config";
  }

  return "metadata";
}

function scoreFileForType(
  file: ScannedFile,
  patterns: WeightedSignal[],
  bodyType: BodyType,
): number {
  const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
  let score = 0;

  for (const signal of patterns) {
    const { pattern, weight } = getSignalParts(signal);
    if (pattern.test(haystack)) {
      score += weight;
    }
  }

  if ([".tri", ".osp", ".xml"].includes(file.extension)) {
    score += 0.2;
  }

  score += scoreKeywordHit(haystack, bodyType);
  score += scoreGenderHint(file, bodyType);
  score += scoreStructureHint(file, bodyType);
  score -= scoreFalsePositivePenalty(haystack, bodyType);

  return Math.max(score, 0);
}

export function detectBodyType(files: ScannedFile[]): DetectionResult {
  const scores = BODY_TYPES.reduce<Record<BodyType, number>>(
    (acc, bodyType) => {
      acc[bodyType] = 0;
      return acc;
    },
    {} as Record<BodyType, number>,
  );

  const matchedSignals = new Set<string>();
  const evidenceCount = BODY_TYPES.reduce<Record<BodyType, number>>(
    (acc, bodyType) => {
      acc[bodyType] = 0;
      return acc;
    },
    {} as Record<BodyType, number>,
  );
  const evidenceKinds = BODY_TYPES.reduce<Record<BodyType, Set<EvidenceKind>>>(
    (acc, bodyType) => {
      acc[bodyType] = new Set<EvidenceKind>();
      return acc;
    },
    {} as Record<BodyType, Set<EvidenceKind>>,
  );

  for (const file of files) {
    for (const bodyType of BODY_TYPES) {
      const score = scoreFileForType(file, SIGNALS[bodyType], bodyType);
      scores[bodyType] += score;
      if (score > 0) {
        matchedSignals.add(`${bodyType}:${file.relativePath}`);
        evidenceCount[bodyType] += 1;
        evidenceKinds[bodyType].add(getEvidenceKind(file));
      }
    }
  }

  const sorted = [...BODY_TYPES].sort((a, b) => scores[b] - scores[a]);
  const bestType = sorted.at(0);
  const total = sorted.reduce((sum, bodyType) => sum + scores[bodyType], 0);
  const rankedCandidates = sorted
    .map((bodyType) => ({
      bodyType,
      score: Number(scores[bodyType].toFixed(2)),
      share: Number((scores[bodyType] / Math.max(total, 1)).toFixed(2)),
    }))
    .filter((candidate) => candidate.score > 0)
    .slice(0, 5);

  if (!bestType) {
    return {
      bodyType: "unknown",
      confidence: 0,
      scores,
      rankedCandidates: [],
      matchedSignals: [],
    };
  }

  const bestScore = scores[bestType];
  const secondBest = scores[sorted[1] ?? bestType] ?? 0;

  if (bestScore <= 0) {
    return {
      bodyType: "unknown",
      confidence: 0,
      scores,
      rankedCandidates: [],
      matchedSignals: [],
    };
  }

  const totalSafe = Math.max(total, 1);
  const scoreShare = bestScore / totalSafe;
  const margin = Math.max(bestScore - secondBest, 0) / Math.max(bestScore, 1);
  const evidenceQuality = Math.min(evidenceCount[bestType] / 4, 1);
  const diversityQuality = Math.min(evidenceKinds[bestType].size / 3, 1);
  const confidence = Number(
    Math.max(
      0,
      Math.min(
        1,
        scoreShare * 0.35 +
          margin * 0.35 +
          evidenceQuality * 0.15 +
          diversityQuality * 0.15,
      ),
    ).toFixed(2),
  );

  return {
    bodyType: bestType,
    confidence,
    scores,
    rankedCandidates,
    matchedSignals: [...matchedSignals].slice(0, 30),
  };
}
