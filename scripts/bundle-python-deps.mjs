// Installs Python engine requirements into python_deps/ so the build can
// bundle them alongside the app (copied later by write-pkg.mjs into
// dist-main/python_deps/).  The directory is recreated on every run so that
// stale packages don't accumulate.
//
// If no Python interpreter is found the script exits 0 with a warning so
// that the rest of the build can continue; at runtime pythonEngine.ts will
// fall back to bootstrapping pip dependencies on the user's machine.

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIREMENTS = join(ROOT, "python_engine", "requirements.txt");
const PYTHON_DEPS = join(ROOT, "python_deps");
const SUPPORTED_MINOR_VERSIONS = new Set([10, 11, 12]);

// Ordered list of interpreter candidates to try (same priority as pythonEngine.ts).
const WIN_CANDIDATES = [
  ["py", ["-3.12"]],
  ["py", ["-3.11"]],
  ["py", ["-3.10"]],
];
const UNIX_CANDIDATES = [
  ["python3.12", []],
  ["python3.11", []],
  ["python3.10", []],
  ["python3", []],
  ["python", []],
];
const ALL_CANDIDATES =
  process.platform === "win32"
    ? [...WIN_CANDIDATES, ...UNIX_CANDIDATES]
    : [...UNIX_CANDIDATES, ...WIN_CANDIDATES];

async function findPython() {
  for (const [cmd, args] of ALL_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(cmd, [
        ...args,
        "-c",
        "import json,struct,sys; print(json.dumps({'major':sys.version_info.major,'minor':sys.version_info.minor,'bits':struct.calcsize('P')*8,'executable':sys.executable}))",
      ], {
        env: buildPythonSubprocessEnv(),
      ]);
      const probe = JSON.parse(stdout.trim());
      if (
        probe.major === 3 &&
        SUPPORTED_MINOR_VERSIONS.has(probe.minor) &&
        probe.bits === 64 &&
        typeof probe.executable === "string"
      ) {
        return { cmd, args, probe };
      }
    } catch {
      // not available – try next
    }
  }
  return null;
}

function buildPythonSubprocessEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
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
    env[key] = value;
  }
  env.PYTHONUNBUFFERED = "1";
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  return env;
}

const python = await findPython();
if (!python) {
  process.stdout.write(
    "bundle-python-deps: No Python interpreter found; skipping bundled Python deps install.\n" +
      "  Install Python 3.10-3.12 (64-bit) if you want bundled Python deps.\n",
  );
  process.exit(0);
}

process.stdout.write(
  `bundle-python-deps: Using ${python.cmd} ${python.args.join(" ")} (${python.probe.executable}, Python 3.${python.probe.minor}, ${python.probe.bits}-bit)\n`,
);

// Wipe and recreate the target directory so we always get a clean install.
await rm(PYTHON_DEPS, { recursive: true, force: true });
await mkdir(PYTHON_DEPS, { recursive: true });

process.stdout.write(
  "bundle-python-deps: Upgrading pip/setuptools/wheel for the selected interpreter ...\n",
);

const pipToolchainArgs = [
  ...python.args,
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

const pipArgs = [
  ...python.args,
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "--no-input",
  "--prefer-binary",
  "--upgrade",
  "-r",
  REQUIREMENTS,
  "--target",
  PYTHON_DEPS,
];

try {
  const toolchain = await execFileAsync(python.cmd, pipToolchainArgs, {
    maxBuffer: 32 * 1024 * 1024,
    env: buildPythonSubprocessEnv(),
  });
  if (toolchain.stdout) process.stdout.write(toolchain.stdout);
  if (toolchain.stderr) process.stderr.write(toolchain.stderr);
  process.stdout.write(
    "bundle-python-deps: Installing requirements into python_deps/ ...\n",
  );

  const { stdout, stderr } = await execFileAsync(python.cmd, pipArgs, {
    maxBuffer: 32 * 1024 * 1024,
    env: buildPythonSubprocessEnv(),
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.stdout.write("bundle-python-deps: Done.\n");
} catch (err) {
  process.stderr.write(
    `bundle-python-deps: pip install failed – ${err.message}\n` +
      "  Bundled Python deps will not be included. The app will bootstrap at first run.\n",
  );
  // Clean up the partial install so write-pkg.mjs skips the directory copy.
  await rm(PYTHON_DEPS, { recursive: true, force: true });
  // Exit 0 so the build is not blocked.
  process.exit(0);
}
