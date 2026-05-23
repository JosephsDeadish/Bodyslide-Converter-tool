// Renderer-side API surface types.
// These re-export pure-TypeScript types from the engine (no Node.js imports)
// and add two types that mirror the preload.ts exports, keeping the renderer
// free of any Electron / Node.js dependencies.

import type { BodyTypeInfo } from "../bodyTypeInfo.js";
import type {
  BodyType,
  ConversionAudit,
  ConversionAuditCheck,
  ConversionOperation,
  ConversionPlan,
  ConversionResult,
  ConvertedFile,
  DetectionResult,
  SkippedFile,
} from "../types.js";

export type {
  BodyType,
  BodyTypeInfo,
  ConversionAudit,
  ConversionAuditCheck,
  ConversionOperation,
  ConversionPlan,
  ConversionResult,
  ConvertedFile,
  DetectionResult,
  SkippedFile,
};

export type BodyTypeOption = { value: BodyType; label: string };

export type ScanResult = {
  detection: DetectionResult;
  plan: ConversionPlan;
  result: ConversionResult;
  reportPath: string;
  summaryPath: string;
};
