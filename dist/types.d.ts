export declare const BODY_TYPES: readonly ["cbbe", "3ba", "himbo", "tbd", "sos", "unp", "bhunp", "uunp"];
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
    matchedSignals: string[];
};
export type ConversionOperation = {
    id: string;
    name: string;
    description: string;
};
export type ConversionPlan = {
    sourceType: DetectionResult["bodyType"];
    targetType: BodyType;
    detectionConfidence: number;
    operations: ConversionOperation[];
    warnings: string[];
    filesAnalyzed: number;
    generatedAt: string;
};
//# sourceMappingURL=types.d.ts.map