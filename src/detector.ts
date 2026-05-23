import type { BodyType, DetectionResult, ScannedFile } from "./types.js";
import { BODY_TYPES } from "./types.js";

const SIGNALS: Record<BodyType, RegExp[]> = {
  cbbe: [/\bcbbe\b/, /caliente/, /curvy/, /slim/, /bodytalk/],
  "3ba": [/\b3ba\b/, /3bbb/, /3bbb-/, /3ba-/, /3bbb body/],
  himbo: [/\bhimbo\b/, /male body/, /himbo body/],
  tbd: [/\btbd\b/, /thebiggestbody/, /touched by dibella/],
  sos: [/\bsos\b/, /schlongs of skyrim/, /sos body/],
  unp: [/\bunp\b/, /dimonized/, /unpb/],
  bhunp: [/\bbhunp\b/, /bhunp/, /unp special/],
  uunp: [/\buunp\b/, /unified unp/],
  "7base": [/\b7base\b/, /sevenbase/, /7b body/],
  sam: [/\bsam\b/, /shape atlas for men/, /sam light/],
  vanilla: [/\bvanilla\b/, /default body/, /base game body/],
};

function scoreFileForType(file: ScannedFile, patterns: RegExp[]): number {
  const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
  let score = 0;

  for (const pattern of patterns) {
    if (pattern.test(haystack)) {
      score += 1;
    }
  }

  if ([".tri", ".osp", ".xml"].includes(file.extension)) {
    score += 0.2;
  }

  return score;
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

  for (const file of files) {
    for (const bodyType of BODY_TYPES) {
      const score = scoreFileForType(file, SIGNALS[bodyType]);
      scores[bodyType] += score;
      if (score > 0) {
        matchedSignals.add(`${bodyType}:${file.relativePath}`);
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

  if (bestScore <= 0) {
    return {
      bodyType: "unknown",
      confidence: 0,
      scores,
      rankedCandidates: [],
      matchedSignals: [],
    };
  }

  return {
    bodyType: bestType,
    confidence: Number((bestScore / Math.max(total, 1)).toFixed(2)),
    scores,
    rankedCandidates,
    matchedSignals: [...matchedSignals].slice(0, 30),
  };
}
