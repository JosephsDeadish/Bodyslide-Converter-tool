import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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

const PYTHON_DEP_BOOTSTRAP_CACHE = new Map<string, Promise<void>>();

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

export function buildDependencyBootstrapCommand(
  command: string,
  commandArgs: string[],
  requirementsPath: string,
  dependencyTargetPath?: string,
): { command: string; args: string[] } {
  const args = [
    ...commandArgs,
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-input",
    "--upgrade",
    "--prefer-binary",
    "-r",
    requirementsPath,
  ];
  if (dependencyTargetPath) {
    args.push("--target", dependencyTargetPath);
  }
  return {
    command,
    args,
  };
}

export function getPythonDependencyTargetPath(
  command: string,
  commandArgs: string[],
  context: Partial<{ homeDir: string; env: NodeJS.ProcessEnv }> = {},
): string {
  const env = context.env ?? process.env;
  const configuredTarget = env.SLIDESMITH_PYTHON_DEPS_DIR?.trim();
  const basePath =
    configuredTarget && configuredTarget.length > 0
      ? configuredTarget
      : join(context.homeDir ?? homedir(), ".slidesmith", "python-deps");
  const cacheKey = `${command}\0${commandArgs.join("\0")}`;
  const interpreterHash = createHash("sha256")
    .update(cacheKey)
    .digest("hex")
    .slice(0, 16);
  return join(basePath, interpreterHash);
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

// Extensions whose text preview carries meaningful body-type signals for
// the Python engine. Binary mesh/texture formats (.nif, .tri, .dds, .bsa …)
// contain no human-readable markup — sending their 4 KB binary preview
// inflates the stdin payload for large mod folders without helping Python.
const PYTHON_TEXT_EXTENSIONS = new Set([
  ".xml",
  ".osp",
  ".json",
  ".ini",
  ".txt",
  ".esp",
  ".esl",
  ".esm",
]);

// Cap on how many bytes of preview Python receives per file.
// The full 4 KB preview is useful for local TypeScript detection, but Python
// only needs a short excerpt for its pattern matching — sending less JSON
// reduces stdin write time and peak main-process memory.
const PYTHON_PREVIEW_LIMIT = 512;

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
    // Only forward text/config files — binary mesh formats carry no useful
    // text signals for Python and would balloon stdin to tens of megabytes
    // on large mod folders, causing the subprocess write to stall.
    files: args.files
      .filter((file) => PYTHON_TEXT_EXTENSIONS.has(file.extension))
      .map((file) => ({
        relativePath: file.relativePath,
        extension: file.extension,
        preview: file.preview.slice(0, PYTHON_PREVIEW_LIMIT),
      })),
  };

  const runnerPath = await resolvePythonRunnerPath();
  if (!runnerPath) {
    return createFallbackRun(
      runId,
      "Python runner script was not found. Rebuild with `npm run build:main` and ensure packaged assets include dist-main/python_engine.",
    );
  }

  const interpreters = getPythonInterpreterCandidates();

  let bestRun: PythonEngineRunSummary | null = null;

  for (const [index, interpreter] of interpreters.entries()) {
    const dependencyTargetPath = getPythonDependencyTargetPath(
      interpreter.command,
      interpreter.args,
    );
    await ensurePythonDependencies(
      interpreter.command,
      interpreter.args,
      runnerPath,
      dependencyTargetPath,
    );
    const run = await tryInterpreter(
      interpreter.command,
      [...interpreter.args, runnerPath],
      payload,
      index === 0 ? options : {},
      dependencyTargetPath,
    );
    if (run === null) {
      continue;
    }

    if (
      bestRun === null ||
      scorePythonEngineRun(run) > scorePythonEngineRun(bestRun)
    ) {
      bestRun = run;
    }

    if (isIdealPythonEngineRun(run)) {
      return run;
    }
  }

  if (bestRun !== null) {
    return bestRun;
  }

  return createFallbackRun(
    runId,
    "Python interpreter not found. Install Python 3.11+ and set SLIDESMITH_PYTHON if needed.",
  );
}

type RunnerPathContext = {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
};

type InterpreterContext = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
};

export function getRunnerPathCandidates(
  context: Partial<RunnerPathContext> = {},
): string[] {
  const dirnameValue = context.dirname ?? __dirname;
  const cwdValue = context.cwd ?? process.cwd();
  const resourcesPathValue =
    context.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  const candidates: string[] = [];

  if (resourcesPathValue) {
    candidates.push(
      join(
        resourcesPathValue,
        "app.asar.unpacked",
        "dist-main",
        "python_engine",
        "runner.py",
      ),
      join(resourcesPathValue, "dist-main", "python_engine", "runner.py"),
      join(resourcesPathValue, "python_engine", "runner.py"),
    );
  }

  candidates.push(
    join(dirnameValue, "..", "python_engine", "runner.py"),
    join(cwdValue, "dist-main", "python_engine", "runner.py"),
    join(cwdValue, "python_engine", "runner.py"),
    join(dirnameValue, "python_engine", "runner.py"),
  );

  return [...new Set(candidates)];
}

export function getPythonInterpreterCandidates(
  context: Partial<InterpreterContext> = {},
): Array<{ command: string; args: string[] }> {
  const platformValue = context.platform ?? process.platform;
  const envValue = context.env ?? process.env;
  const candidates: Array<{ command: string; args: string[] }> = [];

  if (envValue.SLIDESMITH_PYTHON) {
    candidates.push({ command: envValue.SLIDESMITH_PYTHON, args: [] });
  }

  if (platformValue === "win32") {
    candidates.push(
      { command: "py", args: ["-3.12"] },
      { command: "py", args: ["-3.11"] },
      { command: "py", args: ["-3.10"] },
    );
  }

  candidates.push(
    { command: "python3", args: [] },
    { command: "python", args: [] },
  );
  return [
    ...new Map(
      candidates.map((candidate) => [
        `${candidate.command} ${candidate.args.join(" ")}`,
        candidate,
      ]),
    ).values(),
  ];
}

export function isPythonRunnerPathRunnable(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  if (
    normalizedPath.includes("app.asar") &&
    !normalizedPath.includes("app.asar.unpacked")
  ) {
    return false;
  }
  return true;
}

async function resolvePythonRunnerPath(): Promise<string | null> {
  for (const candidate of getRunnerPathCandidates()) {
    if (
      isPythonRunnerPathRunnable(candidate) &&
      (await isReadableFile(candidate))
    ) {
      return candidate;
    }
  }
  return null;
}

function isFallbackEngineRun(run: PythonEngineRunSummary): boolean {
  return run.stages.some(
    (stage) =>
      stage.id === "reference-body" &&
      stage.summary.includes(
        "Python engine did not execute; converter ran in compatibility fallback mode.",
      ),
  );
}

export function scorePythonEngineRun(run: PythonEngineRunSummary): number {
  const libraryScore = Object.values(run.libraries).filter(Boolean).length * 10;
  const stageScore = run.stages.reduce((score, stage) => {
    if (stage.status === "pass") return score + 2;
    if (stage.status === "attention") return score - 1;
    return score;
  }, 0);
  const gateScore = run.qualityGates.reduce((score, gate) => {
    if (gate.status === "pass") return score + 1;
    if (gate.status === "attention") return score - 1;
    return score;
  }, 0);
  const fallbackPenalty = isFallbackEngineRun(run) ? -50 : 20;
  return libraryScore + stageScore + gateScore + fallbackPenalty;
}

function isIdealPythonEngineRun(run: PythonEngineRunSummary): boolean {
  return (
    !isFallbackEngineRun(run) && Object.values(run.libraries).every(Boolean)
  );
}

async function ensurePythonDependencies(
  command: string,
  commandArgs: string[],
  runnerPath: string,
  dependencyTargetPath: string,
): Promise<void> {
  if (
    process.env.VITEST ||
    process.env.NODE_ENV === "test" ||
    process.env.SLIDESMITH_SKIP_PYTHON_DEP_BOOTSTRAP === "1"
  ) {
    return;
  }

  const requirementsPath = join(dirname(runnerPath), "requirements.txt");
  if (!(await isReadableFile(requirementsPath))) {
    return;
  }

  await mkdir(dependencyTargetPath, { recursive: true });
  const cacheKey = `${command} ${commandArgs.join(" ")}:${requirementsPath}:${dependencyTargetPath}`;
  const cached = PYTHON_DEP_BOOTSTRAP_CACHE.get(cacheKey);
  if (cached) {
    await cached;
    return;
  }

  const installPromise = new Promise<void>((resolve) => {
    const bootstrap = buildDependencyBootstrapCommand(
      command,
      commandArgs,
      requirementsPath,
      dependencyTargetPath,
    );
    const child = spawn(bootstrap.command, bootstrap.args, {
      stdio: "ignore",
      env: {
        ...process.env,
        PYTHONPATH: prependPythonPath(
          dependencyTargetPath,
          process.env.PYTHONPATH,
        ),
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        PYTHONUNBUFFERED: "1",
      },
    });

    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });

  PYTHON_DEP_BOOTSTRAP_CACHE.set(cacheKey, installPromise);
  await installPromise;
}

async function isReadableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function tryInterpreter(
  command: string,
  args: string[],
  payload: PythonEngineInput,
  options: PythonEngineOptions,
  dependencyTargetPath: string,
): Promise<PythonEngineRunSummary | null> {
  return new Promise<PythonEngineRunSummary | null>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONPATH: prependPythonPath(
          dependencyTargetPath,
          process.env.PYTHONPATH,
        ),
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

function prependPythonPath(pathToAdd: string, currentPath?: string): string {
  if (!currentPath || currentPath.trim().length === 0) {
    return pathToAdd;
  }
  const paths = currentPath.split(delimiter);
  if (paths.includes(pathToAdd)) {
    return currentPath;
  }
  return `${pathToAdd}${delimiter}${currentPath}`;
}
