import { describe, expect, it } from "vitest";
import { buildExecutedOperations } from "../src/executedOperations.js";
import type { ConversionResult, PythonEngineRunSummary } from "../src/types.js";

function createConversionResult(): ConversionResult {
  return {
    sourceBodyType: "cbbe",
    targetBodyType: "3ba",
    conversionMode: "native",
    conversionPath: "cbbe->3ba",
    preferredOutputAlias: "3BA",
    namingNotes: [],
    audit: {
      overallStatus: "pass",
      checks: [],
    },
    detectionConfidence: 1,
    convertedFiles: [
      {
        sourcePath: "in/a.nif",
        outputPath: "out/a.nif",
        kind: "mesh",
        action: "rewritten",
      },
    ],
    skippedFiles: [
      {
        sourcePath: "in/readme.txt",
        outputPath: "out/readme.txt",
        reason: "Non-body asset",
      },
    ],
    warnings: [],
    filesAnalyzed: 2,
    generatedAt: new Date().toISOString(),
  };
}

function createPythonSummary(): PythonEngineRunSummary {
  return {
    runId: "run-1",
    backend: "python",
    stages: [
      {
        id: "surface-reprojection",
        title: "Surface reprojection",
        status: "pass",
        summary: "Projected source mesh onto target body.",
        details: ["Stable barycentric transfer completed."],
      },
      {
        id: "weight-transfer",
        title: "Weight transfer",
        status: "attention",
        summary: "Transferred skin weights with minor fallback.",
        details: [],
      },
    ],
    qualityGates: [
      {
        id: "weight-normalization",
        status: "pass",
        summary: "All vertex weights normalized.",
      },
      {
        id: "physics-markers",
        status: "attention",
        summary: "Missing one optional physics marker.",
      },
    ],
    warnings: [],
    libraries: {
      pyffi: true,
      numpy: true,
      scipy: true,
      trimesh: true,
      pyvista: true,
    },
  };
}

describe("buildExecutedOperations", () => {
  it("builds execution stages from python summary and conversion output", () => {
    const operations = buildExecutedOperations({
      filesAnalyzed: 12,
      conversion: createConversionResult(),
      pythonSummary: createPythonSummary(),
      repairArtifactsCount: 2,
    });

    expect(operations[0]?.id).toBe("scan-assets");
    expect(
      operations.some((op) => op.id === "python-surface-reprojection"),
    ).toBe(true);
    expect(operations.some((op) => op.id === "python-weight-transfer")).toBe(
      true,
    );
    expect(operations.some((op) => op.id === "python-quality-gates")).toBe(
      true,
    );
    expect(operations.some((op) => op.id === "write-converted-assets")).toBe(
      true,
    );
    expect(operations.some((op) => op.id === "repair-artifacts")).toBe(true);
    expect(operations.at(-1)?.id).toBe("write-reports");
  });

  it("omits python and repair stages when not available", () => {
    const operations = buildExecutedOperations({
      filesAnalyzed: 3,
      conversion: createConversionResult(),
    });

    expect(operations.some((op) => op.id.startsWith("python-"))).toBe(false);
    expect(operations.some((op) => op.id === "repair-artifacts")).toBe(false);
    expect(operations.some((op) => op.id === "write-converted-assets")).toBe(
      true,
    );
  });
});
