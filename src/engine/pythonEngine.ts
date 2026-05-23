import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  BodyType,
  EngineQualityGate,
  EngineStageReport,
  PythonEngineRunSummary,
  ScannedFile,
} from "../types.js";

type PythonEngineInput = {
  runId: string;
  inputPath: string;
  outputPath: string;
  sourceBodyType: BodyType;
  targetBodyType: BodyType;
  files: Array<{
    relativePath: string;
    extension: string;
    preview: string;
  }>;
};

type PythonEngineProgressEvent = {
  type: "progress";
  stage: string;
  message: string;
  progress: number;
};

type PythonEngineCompleteEvent = {
  type: "complete";
  run: PythonEngineRunSummary;
};

type PythonEngineErrorEvent = {
  type: "error";
  error: string;
};

type PythonEngineEvent =
  | PythonEngineProgressEvent
  | PythonEngineCompleteEvent
  | PythonEngineErrorEvent;

type PythonEngineOptions = {
  onProgress?: (event: PythonEngineProgressEvent) => void;
};

function isStageReport(value: unknown): value is EngineStageReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.details)
  );
}

function isQualityGate(value: unknown): value is EngineQualityGate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.summary === "string"
  );
}

function isPythonEngineRunSummary(
  value: unknown,
): value is PythonEngineRunSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.runId === "string" &&
    candidate.backend === "python" &&
    Array.isArray(candidate.stages) &&
    candidate.stages.every(isStageReport) &&
    Array.isArray(candidate.qualityGates) &&
    candidate.qualityGates.every(isQualityGate) &&
    Array.isArray(candidate.warnings)
  );
}

function createFallbackRun(
  runId: string,
  warning: string,
): PythonEngineRunSummary {
  return {
    runId,
    backend: "python",
    stages: [
      {
        id: "reference-body",
        title: "Reference body mapping",
        status: "attention",
        summary:
          "Python engine did not execute; converter ran in compatibility fallback mode.",
        details: [warning],
      },
    ],
    qualityGates: [
      {
        id: "morph-validity",
        status: "attention",
        summary:
          "Morph/slider quality gates were not evaluated by Python core.",
      },
    ],
    warnings: [warning],
    libraries: {
      pynifly: false,
      numpy: false,
      scipy: false,
      trimesh: false,
      pyvista: false,
    },
  };
}

export async function runPythonEngine(
  args: {
    inputPath: string;
    outputPath: string;
    sourceBodyType: BodyType;
    targetBodyType: BodyType;
    files: ScannedFile[];
  },
  options: PythonEngineOptions = {},
): Promise<PythonEngineRunSummary> {
  const runId = randomUUID();
  const payload: PythonEngineInput = {
    runId,
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    sourceBodyType: args.sourceBodyType,
    targetBodyType: args.targetBodyType,
    files: args.files.map((file) => ({
      relativePath: file.relativePath,
      extension: file.extension,
      preview: file.preview,
    })),
  };

  const runnerPath = join(__dirname, "python_engine", "runner.py");
  const interpreters: Array<{ command: string; args: string[] }> = [
    ...(process.env.SLIDESMITH_PYTHON
      ? [{ command: process.env.SLIDESMITH_PYTHON, args: [] }]
      : []),
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ];

  for (const interpreter of interpreters) {
    const run = await tryInterpreter(
      interpreter.command,
      [...interpreter.args, runnerPath],
      payload,
      options,
    );
    if (run !== null) {
      return run;
    }
  }

  return createFallbackRun(
    runId,
    "Python interpreter not found. Install Python 3.11+ and set SLIDESMITH_PYTHON if needed.",
  );
}

async function tryInterpreter(
  command: string,
  args: string[],
  payload: PythonEngineInput,
  options: PythonEngineOptions,
): Promise<PythonEngineRunSummary | null> {
  return new Promise<PythonEngineRunSummary | null>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    let stdoutBuffer = "";
    let stderr = "";
    let completedRun: PythonEngineRunSummary | null = null;
    let spawnFailed = false;

    child.on("error", () => {
      spawnFailed = true;
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString("utf8");
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) continue;

        let parsed: PythonEngineEvent;
        try {
          parsed = JSON.parse(line) as PythonEngineEvent;
        } catch {
          continue;
        }

        if (parsed.type === "progress") {
          options.onProgress?.(parsed);
          continue;
        }

        if (
          parsed.type === "complete" &&
          isPythonEngineRunSummary(parsed.run)
        ) {
          completedRun = parsed.run;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (spawnFailed) {
        resolve(null);
        return;
      }

      if (completedRun !== null) {
        resolve(completedRun);
        return;
      }

      if (code === 0) {
        resolve(
          createFallbackRun(
            payload.runId,
            "Python engine returned no summary; using fallback quality metadata.",
          ),
        );
        return;
      }

      resolve(
        createFallbackRun(
          payload.runId,
          stderr.trim() ||
            `Python engine failed with exit code ${String(code)}.`,
        ),
      );
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}
