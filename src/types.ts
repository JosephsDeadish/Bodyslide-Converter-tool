export const BODY_TYPES = [
  "cbbe",
  "3ba",
  "himbo",
  "tbd",
  "sos",
  "unp",
  "bhunp",
  "uunp",
  "7base",
  "sam",
  "vanilla",
] as const;

export type BodyType = (typeof BODY_TYPES)[number];

export type ScannedFile = {
  absolutePath: string;
  relativePath: string;
  extension: string;
  basename: string;
  preview: string;
};

export type DetectionResult = {
  bodyType: BodyType | "unknown";
  confidence: number;
  scores: Record<BodyType, number>;
  rankedCandidates: Array<{
    bodyType: BodyType;
    score: number;
    share: number;
  }>;
  matchedSignals: string[];
};

export type ConversionOperation = {
  id: string;
  name: string;
  description: string;
};

export type ConversionPlan = {
  sourceType: DetectionResult["bodyType"];
  targetBodyType: BodyType;
  detectionConfidence: number;
  operations: ConversionOperation[];
  warnings: string[];
  filesAnalyzed: number;
  generatedAt: string;
};
