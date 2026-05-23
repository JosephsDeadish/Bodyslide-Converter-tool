export declare const BODY_TYPES: readonly ["cbbe", "3ba", "himbo", "tbd", "sos", "unp", "bhunp", "uunp", "7base", "sam", "vanilla"];
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
export type ConvertedFile = {
    sourcePath: string;
    outputPath: string;
    kind: "mesh" | "text";
    action: "copied" | "rewritten";
};
export type SkippedFile = {
    sourcePath: string;
    outputPath: string;
    reason: string;
};
export type ConversionResult = {
    sourceBodyType: BodyType;
    targetBodyType: BodyType;
    conversionMode: "native" | "compatibility";
    conversionPath: string;
    preferredOutputAlias: string;
    namingNotes: string[];
    detectionConfidence: number;
    convertedFiles: ConvertedFile[];
    skippedFiles: SkippedFile[];
    warnings: string[];
    filesAnalyzed: number;
    generatedAt: string;
};
//# sourceMappingURL=types.d.ts.map