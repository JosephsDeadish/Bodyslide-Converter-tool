export const BODY_TYPES = [
  "cbbe",
  "3ba",
  "coco",
  "himbo",
  "bodytalk",
  "tbd",
  "sos",
  "unp",
  "bhunp",
  "uunp",
  "ube",
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
  packaging: {
    fomod: boolean;
    mo2: boolean;
    vortex: boolean;
  };
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

export type ConversionAuditCheck = {
  id: string;
  title: string;
  status: "pass" | "attention" | "not-applicable";
  summary: string;
  details: string[];
  evidence: string[];
};

export type ConversionAudit = {
  overallStatus: "pass" | "attention";
  checks: ConversionAuditCheck[];
};

export type EngineStageId =
  | "reference-body"
  | "surface-reprojection"
  | "weight-transfer"
  | "corrective-smoothing"
  | "mesh-cleanup"
  | "physics-preservation"
  | "morph-transfer"
  | "tri-generation"
  | "quality-gates";

export type EngineStageStatus = "pass" | "attention";

export type EngineStageReport = {
  id: EngineStageId;
  title: string;
  status: EngineStageStatus;
  summary: string;
  details: string[];
};

export type EngineQualityGate = {
  id:
    | "partition-integrity"
    | "bone-coverage"
    | "weight-normalization"
    | "morph-validity"
    | "tri-compatibility"
    | "physics-markers";
  status: "pass" | "attention";
  summary: string;
};

export type PythonEngineRunSummary = {
  runId: string;
  backend: "python";
  stages: EngineStageReport[];
  qualityGates: EngineQualityGate[];
  warnings: string[];
  libraries: {
    pyffi: boolean;
    numpy: boolean;
    scipy: boolean;
    trimesh: boolean;
    pyvista: boolean;
  };
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
  action: "copied" | "rewritten" | "synthesized";
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
  audit: ConversionAudit;
  detectionConfidence: number;
  convertedFiles: ConvertedFile[];
  skippedFiles: SkippedFile[];
  warnings: string[];
  filesAnalyzed: number;
  generatedAt: string;
  pythonEngine?: PythonEngineRunSummary;
};

export type ConversionRunArgs = {
  input: string;
  target: BodyType;
  output: string;
  sourceOverride?: BodyType;
  maleSource?: BodyType;
  maleTarget?: BodyType;
};

export type ConversionJobEvent =
  | {
      jobId: string;
      type: "status";
      stage:
        | "queued"
        | "scan"
        | "python-engine"
        | "conversion"
        | "reports"
        | "done";
      message: string;
      progress: number;
    }
  | {
      jobId: string;
      type: "complete";
      result: {
        detection: DetectionResult;
        plan: ConversionPlan;
        result: ConversionResult;
        reportPath: string;
        summaryPath: string;
      };
    }
  | {
      jobId: string;
      type: "error";
      error: string;
    };
