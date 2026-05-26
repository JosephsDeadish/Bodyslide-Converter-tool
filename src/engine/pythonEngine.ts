import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
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

type BootstrapCommandResult = {
  ok: boolean;
  output: string;
};

const PYTHON_DEP_BOOTSTRAP_CACHE = new Map<string, Promise<string[]>>();
const REQUIRED_PYTHON_LIBRARIES = [
  "pyffi",
  "numpy",
  "scipy",
  "trimesh",
  "pyvista",
] as const;
const SUPPORTED_PYTHON_VERSION_RANGE = {
  major: 3,
  minMinor: 10,
  maxMinor: 16,
} as const;
const BUNDLED_DEPENDENCY_PROBE_SNIPPET = [
  "import importlib.util, sys",
  "mods = ['pyffi','numpy','scipy','trimesh','pyvista']",
  "missing = [m for m in mods if importlib.util.find_spec(m) is None]",
  "sys.exit(1 if missing else 0)",
].join("; ");
const PYTHON_VERSION_PROBE_SNIPPET = [
  "import json,struct,sys",
  "print(json.dumps({'major':sys.version_info.major,'minor':sys.version_info.minor,'bits':struct.calcsize('P') * 8,'executable':sys.executable,'prefix':sys.prefix,'basePrefix':getattr(sys,'base_prefix',sys.prefix)}))",
].join("; ");
const MISSING_RUNTIME_ERROR_PATTERNS = [
  /No runtime installed that matches/i,
  /Requested Python version.*not installed/i,
  /No installed Pythons found/i,
  /No Python runtime installed/i,
];

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

export function buildPipToolchainBootstrapCommand(
  command: string,
  commandArgs: string[],
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
    "pip",
    "setuptools",
    "wheel",
  ];
  if (dependencyTargetPath) {
    args.push("--target", dependencyTargetPath);
  }
  return {
    command,
    args,
  };
}

export function buildPipSelfUpgradeCommand(
  command: string,
  commandArgs: string[],
): { command: string; args: string[] } {
  return {
    command,
    args: [
      ...commandArgs,
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--upgrade",
      "pip",
      "setuptools",
      "wheel",
    ],
  };
}

export function buildDependencyPackageBootstrapCommand(
  command: string,
  commandArgs: string[],
  requirement: string,
  dependencyTargetPath?: string,
  options: Partial<{ preferBinary: boolean; onlyBinary: boolean }> = {},
): { command: string; args: string[] } {
  const preferBinary = options.preferBinary ?? true;
  const onlyBinary = options.onlyBinary ?? false;
  const args = [
    ...commandArgs,
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-input",
    "--upgrade",
    requirement,
  ];
  if (preferBinary) {
    args.splice(args.length - 1, 0, "--prefer-binary");
  }
  if (onlyBinary) {
    args.splice(args.length - 1, 0, "--only-binary", ":all:");
  }
  if (dependencyTargetPath) {
    args.push("--target", dependencyTargetPath);
  }
  return {
    command,
    args,
  };
}

export function buildBundledDependencyProbeCommand(
  command: string,
  commandArgs: string[],
): { command: string; args: string[] } {
  return {
    command,
    args: [...commandArgs, "-c", BUNDLED_DEPENDENCY_PROBE_SNIPPET],
  };
}

export function buildPythonVersionProbeCommand(
  command: string,
  commandArgs: string[],
): { command: string; args: string[] } {
  return {
    command,
    args: [...commandArgs, "-c", PYTHON_VERSION_PROBE_SNIPPET],
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
      pyffi: false,
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
const PYTHON_MANIFEST_EXTENSIONS = new Set([
  ...PYTHON_TEXT_EXTENSIONS,
  ".nif",
  ".tri",
  ".osd",
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
    // Forward a compact manifest of both text/config and mesh files.
    // Python stage readiness checks require mesh extensions (.nif/.tri/.osd),
    // while only text/config files need preview snippets.
    files: args.files
      .filter((file) => PYTHON_MANIFEST_EXTENSIONS.has(file.extension))
      .map((file) => ({
        relativePath: file.relativePath,
        extension: file.extension,
        preview: PYTHON_TEXT_EXTENSIONS.has(file.extension)
          ? file.preview.slice(0, PYTHON_PREVIEW_LIMIT)
          : "",
      })),
  };

  const runnerPath = await resolvePythonRunnerPath();
  if (!runnerPath) {
    return createFallbackRun(
      runId,
      "Python runner script was not found. Rebuild with `npm run build:main` and ensure packaged assets include dist-main/python_engine.",
    );
  }
  const bundledDependencyPaths =
    await resolveBundledPythonDependencyPaths(runnerPath);
  const hasCompleteBundledDependencies =
    await hasCompleteBundledDependenciesInPaths(bundledDependencyPaths);

  const interpreters = getPythonInterpreterCandidates();

  let bestRun: PythonEngineRunSummary | null = null;
  const bootstrapWarnings: string[] = [];

  for (const [index, interpreter] of interpreters.entries()) {
    const interpreterVersion = await probePythonVersion(
      interpreter.command,
      interpreter.args,
    );
    if (
      interpreterVersion &&
      !isSupportedPythonInterpreter(interpreterVersion)
    ) {
      continue;
    }
    const dependencyTargetPath = getPythonDependencyTargetPath(
      interpreter.command,
      interpreter.args,
    );
    const bundledDependencyProbePath = buildPythonPath(
      bundledDependencyPaths,
      process.env.PYTHONPATH,
    );
    const bundledDependenciesAreUsable =
      hasCompleteBundledDependencies &&
      (await canImportRequiredLibraries(
        interpreter.command,
        interpreter.args,
        bundledDependencyProbePath,
      ));
    const pythonPath = buildPythonPath(
      [dependencyTargetPath, ...bundledDependencyPaths],
      process.env.PYTHONPATH,
    );
    const interpreterBootstrapWarnings = await ensurePythonDependencies(
      interpreter.command,
      interpreter.args,
      runnerPath,
      dependencyTargetPath,
      pythonPath,
      bundledDependenciesAreUsable,
    );
    bootstrapWarnings.push(...interpreterBootstrapWarnings);
    const run = await tryInterpreter(
      interpreter.command,
      [...interpreter.args, runnerPath],
      payload,
      index === 0 ? options : {},
      pythonPath,
    );
    if (run === null) {
      continue;
    }
    if (interpreterBootstrapWarnings.length > 0) {
      run.warnings = [
        ...new Set([...run.warnings, ...interpreterBootstrapWarnings]),
      ];
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
    bootstrapWarnings[0] ??
      "No supported Python interpreter found. Install Python 3.10-3.16 (64-bit), avoid broken virtual environments, and set SLIDESMITH_PYTHON if needed.",
  );
}

type RunnerPathContext = {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
};

type BundledDependencyPathContext = {
  cwd: string;
  resourcesPath?: string;
};

type InterpreterContext = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
};

type PythonInterpreterProbe = {
  major: number;
  minor: number;
  bits: number;
  executable: string;
  prefix: string;
  basePrefix: string;
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
      join(
        resourcesPathValue,
        "app.asar.unpacked",
        "python_engine",
        "runner.py",
      ),
    );
  }

  if (dirnameValue.includes("app.asar")) {
    candidates.push(
      join(
        dirnameValue.replace("app.asar", "app.asar.unpacked"),
        "..",
        "python_engine",
        "runner.py",
      ),
    );
  }

  candidates.push(
    join(dirnameValue, "..", "python_engine", "runner.py"),
    join(dirnameValue, "..", "..", "dist-main", "python_engine", "runner.py"),
    join(dirnameValue, "..", "..", "python_engine", "runner.py"),
    join(cwdValue, "dist-main", "python_engine", "runner.py"),
    join(cwdValue, "python_engine", "runner.py"),
    join(dirnameValue, "python_engine", "runner.py"),
  );

  return [...new Set(candidates)];
}

export function getBundledDependencyPathCandidates(
  runnerPath: string,
  context: Partial<BundledDependencyPathContext> = {},
): string[] {
  const cwdValue = context.cwd ?? process.cwd();
  const resourcesPathValue =
    context.resourcesPath ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  const candidates = [
    join(dirname(runnerPath), "..", "python_deps"),
    join(cwdValue, "dist-main", "python_deps"),
    join(cwdValue, "python_deps"),
  ];

  if (resourcesPathValue) {
    candidates.unshift(
      join(resourcesPathValue, "app.asar.unpacked", "dist-main", "python_deps"),
      join(resourcesPathValue, "dist-main", "python_deps"),
      join(resourcesPathValue, "python_deps"),
    );
  }

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
      { command: "py", args: ["-3.16"] },
      { command: "py", args: ["-3.15"] },
      { command: "py", args: ["-3.14"] },
      { command: "py", args: ["-3.13"] },
      { command: "py", args: ["-3.12"] },
      { command: "py", args: ["-3.11"] },
      { command: "py", args: ["-3.10"] },
      { command: "python3.16", args: [] },
      { command: "python3.15", args: [] },
      { command: "python3.14", args: [] },
      { command: "python3.13", args: [] },
      { command: "python3.12", args: [] },
      { command: "python3.11", args: [] },
      { command: "python3.10", args: [] },
    );
  } else {
    candidates.push(
      { command: "python3.16", args: [] },
      { command: "python3.15", args: [] },
      { command: "python3.14", args: [] },
      { command: "python3.13", args: [] },
      { command: "python3.12", args: [] },
      { command: "python3.11", args: [] },
      { command: "python3.10", args: [] },
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

export function buildPythonSubprocessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: Partial<{
    pythonPath: string;
    inheritPythonPath: boolean;
  }> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalizedKey = key.toUpperCase();
    if (
      normalizedKey.startsWith("NPM_") ||
      normalizedKey.startsWith("ELECTRON_") ||
      normalizedKey === "NODE_OPTIONS" ||
      normalizedKey === "INIT_CWD" ||
      normalizedKey === "VIRTUAL_ENV" ||
      normalizedKey === "PYTHONHOME" ||
      normalizedKey === "PYTHONEXECUTABLE" ||
      normalizedKey === "__PYVENV_LAUNCHER__"
    ) {
      continue;
    }
    if (normalizedKey === "PYTHONPATH" && !options.inheritPythonPath) {
      continue;
    }
    env[key] = value;
  }
  if (options.pythonPath) {
    env.PYTHONPATH = options.pythonPath;
  }
  env.PYTHONUNBUFFERED = "1";
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  return env;
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
  pythonPath: string,
  skipBootstrap: boolean,
): Promise<string[]> {
  if (
    process.env.VITEST ||
    process.env.NODE_ENV === "test" ||
    process.env.SLIDESMITH_SKIP_PYTHON_DEP_BOOTSTRAP === "1"
  ) {
    return [];
  }
  if (skipBootstrap) {
    return [];
  }

  const requirementsPath = join(dirname(runnerPath), "requirements.txt");
  if (!(await isReadableFile(requirementsPath))) {
    return [];
  }
  const requirements = await loadBootstrapRequirements(requirementsPath);
  if (requirements.length === 0) {
    return [];
  }

  const managedDependencyProbePath = buildPythonPath(
    [dependencyTargetPath],
    process.env.PYTHONPATH,
  );
  if (
    await canImportRequiredLibraries(
      command,
      commandArgs,
      managedDependencyProbePath,
    )
  ) {
    return [];
  }

  await mkdir(dependencyTargetPath, { recursive: true });
  const cacheKey = `${command} ${commandArgs.join(" ")}:${requirementsPath}:${dependencyTargetPath}`;
  const cached = PYTHON_DEP_BOOTSTRAP_CACHE.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const installPromise = new Promise<string[]>((resolve) => {
    const env = {
      ...buildPythonSubprocessEnv(process.env, { pythonPath }),
    };

    void (async () => {
      const warnings: string[] = [];
      const enforceBinaryOnly = process.platform === "win32";

      const selfUpgrade = await runBootstrapCommand(
        buildPipSelfUpgradeCommand(command, commandArgs),
        buildPythonSubprocessEnv(process.env, { inheritPythonPath: true }),
      );
      if (!selfUpgrade.ok) {
        if (isMissingPythonRuntimeError(selfUpgrade.output)) {
          resolve([]);
          return;
        }
        warnings.push(
          formatBootstrapFailureWarning(
            "pip/setuptools/wheel self-upgrade",
            "pip",
            selfUpgrade.output,
          ),
        );
      }

      const toolchain = await runBootstrapCommand(
        buildPipToolchainBootstrapCommand(
          command,
          commandArgs,
          dependencyTargetPath,
        ),
        env,
      );
      if (!toolchain.ok) {
        if (isMissingPythonRuntimeError(toolchain.output)) {
          resolve([]);
          return;
        }
        warnings.push(
          formatBootstrapFailureWarning(
            "pip/setuptools/wheel target install",
            "pip",
            toolchain.output,
          ),
        );
      }
      for (const requirement of requirements) {
        const installedWithPreferredCommand = await runBootstrapCommand(
          buildDependencyPackageBootstrapCommand(
            command,
            commandArgs,
            requirement,
            dependencyTargetPath,
            { onlyBinary: enforceBinaryOnly },
          ),
          env,
        );
        if (installedWithPreferredCommand.ok) {
          continue;
        }
        if (enforceBinaryOnly) {
          warnings.push(
            formatBootstrapFailureWarning(
              "Python dependency install (wheel-only on Windows)",
              requirement,
              installedWithPreferredCommand.output,
            ),
          );
          continue;
        }
        const relaxedInstall = await runBootstrapCommand(
          buildDependencyPackageBootstrapCommand(
            command,
            commandArgs,
            requirement,
            dependencyTargetPath,
            { preferBinary: false },
          ),
          env,
        );
        if (!relaxedInstall.ok) {
          warnings.push(
            formatBootstrapFailureWarning(
              "Python dependency install",
              requirement,
              relaxedInstall.output || installedWithPreferredCommand.output,
            ),
          );
        }
      }
      resolve([...new Set(warnings)]);
    })();
  });

  PYTHON_DEP_BOOTSTRAP_CACHE.set(cacheKey, installPromise);
  return await installPromise;
}

async function loadBootstrapRequirements(
  requirementsPath: string,
): Promise<string[]> {
  const content = await readFile(requirementsPath, "utf8").catch(() => "");
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0);
}

async function runBootstrapCommand(
  command: { command: string; args: string[] },
  env: NodeJS.ProcessEnv,
): Promise<BootstrapCommandResult> {
  return new Promise<BootstrapCommandResult>((resolve) => {
    const child = spawn(command.command, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let output = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      output += chunk.toString("utf8");
    });

    child.on("error", (error) =>
      resolve({
        ok: false,
        output: error.message,
      }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        output: normalizeBootstrapOutput(output),
      }),
    );
  });
}

function normalizeBootstrapOutput(output: string): string {
  const normalized = output
    .replace(/\s+/g, " ")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
  if (normalized.length <= 600) {
    return normalized;
  }
  return `${normalized.slice(0, 597)}...`;
}

function formatBootstrapFailureWarning(
  stage: string,
  requirement: string,
  output: string,
): string {
  const detail =
    output.trim().length > 0
      ? output
      : "pip exited without returning any diagnostic output.";
  return `${stage} failed for ${requirement}: ${detail}`;
}

async function canImportRequiredLibraries(
  command: string,
  commandArgs: string[],
  pythonPath: string,
): Promise<boolean> {
  const probe = buildBundledDependencyProbeCommand(command, commandArgs);
  return new Promise<boolean>((resolve) => {
    const child = spawn(probe.command, probe.args, {
      stdio: "ignore",
      env: buildPythonSubprocessEnv(process.env, { pythonPath }),
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function isSupportedPythonVersion(major: number, minor: number): boolean {
  return (
    major === SUPPORTED_PYTHON_VERSION_RANGE.major &&
    minor >= SUPPORTED_PYTHON_VERSION_RANGE.minMinor &&
    minor <= SUPPORTED_PYTHON_VERSION_RANGE.maxMinor
  );
}

async function probePythonVersion(
  command: string,
  commandArgs: string[],
): Promise<null | PythonInterpreterProbe> {
  const probe = buildPythonVersionProbeCommand(command, commandArgs);
  return new Promise<null | PythonInterpreterProbe>((resolve) => {
    const child = spawn(probe.command, probe.args, {
      stdio: ["ignore", "pipe", "ignore"],
      env: buildPythonSubprocessEnv(process.env),
    });

    let output = "";
    child.on("error", () => resolve(null));
    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString("utf8");
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output.trim()) as {
          major?: unknown;
          minor?: unknown;
          bits?: unknown;
          executable?: unknown;
          prefix?: unknown;
          basePrefix?: unknown;
        };
        if (
          typeof parsed.major === "number" &&
          typeof parsed.minor === "number" &&
          typeof parsed.bits === "number" &&
          typeof parsed.executable === "string" &&
          typeof parsed.prefix === "string" &&
          typeof parsed.basePrefix === "string"
        ) {
          resolve({
            major: parsed.major,
            minor: parsed.minor,
            bits: parsed.bits,
            executable: parsed.executable,
            prefix: parsed.prefix,
            basePrefix: parsed.basePrefix,
          });
          return;
        }
      } catch {}
      resolve(null);
    });
  });
}

export function isMissingPythonRuntimeError(message: string): boolean {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }
  return MISSING_RUNTIME_ERROR_PATTERNS.some((pattern) =>
    pattern.test(normalizedMessage),
  );
}

export function isSupportedPythonInterpreter(
  probe: PythonInterpreterProbe,
): boolean {
  return (
    isSupportedPythonVersion(probe.major, probe.minor) && probe.bits === 64
  );
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
  pythonPath: string,
): Promise<PythonEngineRunSummary | null> {
  return new Promise<PythonEngineRunSummary | null>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildPythonSubprocessEnv(process.env, { pythonPath }),
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

      const stderrMessage = stderr.trim();
      if (isMissingPythonRuntimeError(stderrMessage)) {
        resolve(null);
        return;
      }

      resolve(
        createFallbackRun(
          payload.runId,
          stderrMessage ||
            `Python engine failed with exit code ${String(code)}.`,
        ),
      );
    });

    // Guard against EPIPE/write-EOF if the child exits before stdin is fully
    // drained (e.g. Python crashes at import time).  Without this listener the
    // error propagates as an uncaught exception and triggers the Electron crash
    // dialog.
    child.stdin.on("error", () => {});
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}

function buildPythonPath(pathsToAdd: string[], currentPath?: string): string {
  const normalizedPaths = pathsToAdd
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  const existingPaths =
    currentPath && currentPath.trim().length > 0
      ? currentPath.split(delimiter)
      : [];
  const merged = [
    ...normalizedPaths,
    ...existingPaths.filter((path) => path.trim().length > 0),
  ];
  return [...new Set(merged)].join(delimiter);
}

async function resolveBundledPythonDependencyPaths(
  runnerPath: string,
): Promise<string[]> {
  const candidates = getBundledDependencyPathCandidates(runnerPath);
  const discovered: string[] = [];
  for (const candidate of candidates) {
    if (!(await isReadableDirectory(candidate))) {
      continue;
    }
    const containsLibrary = await containsAnyLibrary(candidate);
    if (!containsLibrary) {
      continue;
    }
    discovered.push(candidate);
  }
  return discovered;
}

async function containsAnyLibrary(path: string): Promise<boolean> {
  for (const library of REQUIRED_PYTHON_LIBRARIES) {
    if (
      (await isReadableFile(join(path, library))) ||
      (await isReadableDirectory(join(path, library)))
    ) {
      return true;
    }
  }
  return false;
}

async function hasCompleteBundledDependenciesInPaths(
  paths: string[],
): Promise<boolean> {
  if (paths.length === 0) {
    return false;
  }
  for (const library of REQUIRED_PYTHON_LIBRARIES) {
    let found = false;
    for (const path of paths) {
      if (
        (await isReadableFile(join(path, library))) ||
        (await isReadableDirectory(join(path, library)))
      ) {
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

async function isReadableDirectory(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
