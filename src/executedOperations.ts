import type {
  ConversionOperation,
  ConversionResult,
  PythonEngineRunSummary,
} from "./types.js";

type BuildExecutedOperationsArgs = {
  filesAnalyzed: number;
  conversion: ConversionResult;
  pythonSummary?: PythonEngineRunSummary;
  repairArtifactsCount?: number;
};

export function buildExecutedOperations({
  filesAnalyzed,
  conversion,
  pythonSummary,
  repairArtifactsCount = 0,
}: BuildExecutedOperationsArgs): ConversionOperation[] {
  const operations: ConversionOperation[] = [
    {
      id: "scan-assets",
      name: "Scan source assets",
      description: `Scanned ${filesAnalyzed} file(s) for meshes, sliders, and body metadata before conversion.`,
    },
  ];

  if (pythonSummary) {
    operations.push(
      ...pythonSummary.stages.map((stage) => ({
        id: `python-${stage.id}`,
        name: stage.title,
        description:
          stage.details.length > 0
            ? `${stage.summary} ${stage.details.join(" ")}`
            : stage.summary,
      })),
    );

    if (pythonSummary.qualityGates.length > 0) {
      const attentionCount = pythonSummary.qualityGates.filter(
        (gate) => gate.status === "attention",
      ).length;
      operations.push({
        id: "python-quality-gates",
        name: "Run Python quality gates",
        description:
          attentionCount > 0
            ? `${pythonSummary.qualityGates.length} quality gate(s) checked with ${attentionCount} attention flag(s).`
            : `All ${pythonSummary.qualityGates.length} quality gate(s) passed.`,
      });
    }
  }

  operations.push({
    id: "write-converted-assets",
    name: "Write converted assets",
    description: `Wrote ${conversion.convertedFiles.length} converted file(s) and copied ${conversion.skippedFiles.length} non-converted file(s) to output.`,
  });

  if (repairArtifactsCount > 0) {
    operations.push({
      id: "repair-artifacts",
      name: "Generate repair artifacts",
      description: `Generated ${repairArtifactsCount} targeted repair artifact file(s) for missing metadata, adapters, or physics follow-up.`,
    });
  }

  operations.push({
    id: "write-reports",
    name: "Write conversion reports",
    description: "Wrote JSON and text conversion reports with audit and warning details.",
  });

  return operations;
}
