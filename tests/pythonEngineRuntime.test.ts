import { describe, expect, it } from "vitest";
import {
  buildBundledDependencyProbeCommand,
  buildDependencyBootstrapCommand,
  buildDependencyPackageBootstrapCommand,
  buildPipSelfUpgradeCommand,
  buildPipToolchainBootstrapCommand,
  buildPythonSubprocessEnv,
  buildPythonVersionProbeCommand,
  getBundledDependencyPathCandidates,
  getPythonDependencyTargetPath,
  getPythonInterpreterCandidates,
  getRunnerPathCandidates,
  isMissingPythonRuntimeError,
  isPythonRunnerPathRunnable,
  isSupportedPythonInterpreter,
  scorePythonEngineRun,
} from "../src/engine/pythonEngine.js";
import type { PythonEngineRunSummary } from "../src/types.js";

describe("python engine runtime paths", () => {
  it("includes dist-main/python_engine lookup for compiled Electron runtime", () => {
    const candidates = getRunnerPathCandidates({
      dirname: "/app/dist-main/engine",
      cwd: "/app",
    });

    expect(candidates).toContain("/app/dist-main/python_engine/runner.py");
    expect(candidates).toContain(
      "/app/dist-main/engine/python_engine/runner.py",
    );
  });

  it("includes repo-root python_engine lookup for dist CLI runtime", () => {
    const candidates = getRunnerPathCandidates({
      dirname: "/app/dist/engine",
      cwd: "/tmp",
    });

    expect(candidates).toContain("/app/python_engine/runner.py");
  });

  it("includes app.asar.unpacked path when resourcesPath is provided", () => {
    const candidates = getRunnerPathCandidates({
      dirname: "/tmp/resources/app.asar/dist-main/engine",
      cwd: "/tmp/resources",
      resourcesPath: "/tmp/resources",
    });

    expect(candidates).toContain(
      "/tmp/resources/app.asar.unpacked/dist-main/python_engine/runner.py",
    );
    expect(candidates[0]).toBe(
      "/tmp/resources/app.asar.unpacked/dist-main/python_engine/runner.py",
    );
    expect(candidates).toContain(
      "/tmp/resources/app.asar.unpacked/python_engine/runner.py",
    );
  });

  it("includes app.asar.unpacked mirror path when dirname points inside app.asar", () => {
    const candidates = getRunnerPathCandidates({
      dirname: "/tmp/resources/app.asar/dist-main/engine",
      cwd: "/tmp/resources",
    });

    expect(candidates).toContain(
      "/tmp/resources/app.asar.unpacked/dist-main/python_engine/runner.py",
    );
  });

  it("includes python_deps candidates for bundled EXE resources", () => {
    const candidates = getBundledDependencyPathCandidates(
      "/tmp/resources/app.asar.unpacked/dist-main/python_engine/runner.py",
      {
        cwd: "/tmp/resources",
        resourcesPath: "/tmp/resources",
      },
    );

    expect(candidates).toContain(
      "/tmp/resources/app.asar.unpacked/dist-main/python_deps",
    );
    expect(candidates).toContain("/tmp/resources/dist-main/python_deps");
    expect(candidates).toContain("/tmp/resources/python_deps");
  });

  it("flags app.asar runner paths as non-runnable for external Python", () => {
    expect(
      isPythonRunnerPathRunnable(
        "/tmp/resources/app.asar/dist-main/python_engine/runner.py",
      ),
    ).toBe(false);
    expect(
      isPythonRunnerPathRunnable(
        "/tmp/resources/app.asar.unpacked/dist-main/python_engine/runner.py",
      ),
    ).toBe(true);
  });
});

describe("python engine interpreter candidates", () => {
  it("prefers SLIDESMITH_PYTHON override and includes Windows py launcher fallbacks", () => {
    const interpreters = getPythonInterpreterCandidates({
      platform: "win32",
      env: {
        SLIDESMITH_PYTHON: "C:\\Python312\\python.exe",
      } as NodeJS.ProcessEnv,
    });

    expect(interpreters[0]).toEqual({
      command: "C:\\Python312\\python.exe",
      args: [],
    });

    expect(interpreters).toContainEqual({ command: "py", args: ["-3.16"] });
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.14"] });
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.13"] });
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.12"] });
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.11"] });
    expect(interpreters).toContainEqual({ command: "python3.16", args: [] });
    expect(interpreters).toContainEqual({ command: "python3.14", args: [] });
    expect(interpreters).toContainEqual({ command: "python3.13", args: [] });
    expect(interpreters).toContainEqual({ command: "python3.12", args: [] });
    expect(interpreters).toContainEqual({ command: "python3", args: [] });
    expect(interpreters).toContainEqual({ command: "python", args: [] });
  });
});

describe("python runtime error classification", () => {
  it("treats py launcher missing-runtime errors as non-runnable candidates", () => {
    expect(
      isMissingPythonRuntimeError(
        '[ERROR] No runtime installed that matches 3.13. Try running "py install 3.13".',
      ),
    ).toBe(true);
    expect(
      isMissingPythonRuntimeError(
        "Requested Python version (3.12) not installed",
      ),
    ).toBe(true);
  });

  it("does not classify regular engine failures as missing-runtime errors", () => {
    expect(
      isMissingPythonRuntimeError("ModuleNotFoundError: No module named numpy"),
    ).toBe(false);
    expect(isMissingPythonRuntimeError("Python engine crashed")).toBe(false);
  });
});

describe("python interpreter validation", () => {
  it("accepts only 64-bit Python 3.10-3.16 interpreters", () => {
    expect(
      isSupportedPythonInterpreter({
        major: 3,
        minor: 12,
        bits: 64,
        executable: "/python312/python",
        prefix: "/python312",
        basePrefix: "/python312",
      }),
    ).toBe(true);
    expect(
      isSupportedPythonInterpreter({
        major: 3,
        minor: 12,
        bits: 32,
        executable: "/python312-32/python",
        prefix: "/python312-32",
        basePrefix: "/python312-32",
      }),
    ).toBe(false);
    expect(
      isSupportedPythonInterpreter({
        major: 3,
        minor: 16,
        bits: 64,
        executable: "/python316/python",
        prefix: "/python316",
        basePrefix: "/python316",
      }),
    ).toBe(true);
    expect(
      isSupportedPythonInterpreter({
        major: 3,
        minor: 14,
        bits: 64,
        executable: "/python314/python",
        prefix: "/python314",
        basePrefix: "/python314",
      }),
    ).toBe(true);
    expect(
      isSupportedPythonInterpreter({
        major: 3,
        minor: 13,
        bits: 64,
        executable: "/python313/python",
        prefix: "/python313",
        basePrefix: "/python313",
      }),
    ).toBe(true);
  });
});

describe("python subprocess environment", () => {
  it("removes npm/electron and broken venv variables while keeping Python path overrides", () => {
    const env = buildPythonSubprocessEnv(
      {
        PATH: "/usr/bin",
        PYTHONPATH: "/existing/pythonpath",
        npm_config_user_agent: "npm",
        ELECTRON_RUN_AS_NODE: "1",
        NODE_OPTIONS: "--trace-warnings",
        VIRTUAL_ENV: "/broken/venv",
      } as NodeJS.ProcessEnv,
      {
        pythonPath: "/managed/pythonpath",
      },
    );

    expect(env.PATH).toBe("/usr/bin");
    expect(env.PYTHONPATH).toBe("/managed/pythonpath");
    expect(env.PYTHONUNBUFFERED).toBe("1");
    expect(env.npm_config_user_agent).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.VIRTUAL_ENV).toBeUndefined();
  });
});

describe("python engine run scoring", () => {
  function makeRun(
    overrides: Partial<PythonEngineRunSummary> = {},
  ): PythonEngineRunSummary {
    return {
      runId: "run",
      backend: "python",
      stages: [
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "pass",
          summary: "ok",
          details: [],
        },
      ],
      qualityGates: [
        {
          id: "morph-validity",
          status: "pass",
          summary: "ok",
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
      ...overrides,
    };
  }

  it("scores complete runs above fallback runs", () => {
    const completeRun = makeRun();
    const fallbackRun = makeRun({
      stages: [
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "attention",
          summary:
            "Python engine did not execute; converter ran in compatibility fallback mode.",
          details: [],
        },
      ],
      qualityGates: [
        {
          id: "morph-validity",
          status: "attention",
          summary: "not evaluated",
        },
      ],
      libraries: {
        pyffi: false,
        numpy: false,
        scipy: false,
        trimesh: false,
        pyvista: false,
      },
    });

    expect(scorePythonEngineRun(completeRun)).toBeGreaterThan(
      scorePythonEngineRun(fallbackRun),
    );
  });
});

describe("python dependency bootstrap command", () => {
  it("preserves interpreter arguments when building pip install command", () => {
    const bootstrap = buildDependencyBootstrapCommand(
      "py",
      ["-3.12"],
      "C:\\app\\dist-main\\python_engine\\requirements.txt",
    );

    expect(bootstrap).toEqual({
      command: "py",
      args: [
        "-3.12",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--upgrade",
        "--prefer-binary",
        "-r",
        "C:\\app\\dist-main\\python_engine\\requirements.txt",
      ],
    });
  });

  it("adds --target when dependency target path is provided", () => {
    const bootstrap = buildDependencyBootstrapCommand(
      "python3",
      [],
      "/app/dist-main/python_engine/requirements.txt",
      "/home/user/.slidesmith/python-deps/abc123",
    );

    expect(bootstrap.args).toEqual([
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--upgrade",
      "--prefer-binary",
      "-r",
      "/app/dist-main/python_engine/requirements.txt",
      "--target",
      "/home/user/.slidesmith/python-deps/abc123",
    ]);
  });

  it("builds pip/setuptools/wheel upgrade command before dependency install", () => {
    const bootstrap = buildPipToolchainBootstrapCommand(
      "py",
      ["-3.12"],
      "C:\\Users\\tester\\.slidesmith\\python-deps\\abc123",
    );

    expect(bootstrap).toEqual({
      command: "py",
      args: [
        "-3.12",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--upgrade",
        "pip",
        "setuptools",
        "wheel",
        "--target",
        "C:\\Users\\tester\\.slidesmith\\python-deps\\abc123",
      ],
    });
  });

  it("builds pip self-upgrade command in the active interpreter environment", () => {
    const bootstrap = buildPipSelfUpgradeCommand("py", ["-3.12"]);

    expect(bootstrap).toEqual({
      command: "py",
      args: [
        "-3.12",
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
    });
  });

  it("builds per-package bootstrap command so a single package failure is isolated", () => {
    const bootstrap = buildDependencyPackageBootstrapCommand(
      "python3",
      [],
      "numpy>=2.2.0",
      "/home/user/.slidesmith/python-deps/abc123",
    );

    expect(bootstrap).toEqual({
      command: "python3",
      args: [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--upgrade",
        "--prefer-binary",
        "numpy>=2.2.0",
        "--target",
        "/home/user/.slidesmith/python-deps/abc123",
      ],
    });
  });

  it("supports wheel-only package bootstrap flags for Windows dependency installs", () => {
    const bootstrap = buildDependencyPackageBootstrapCommand(
      "py",
      ["-3.12"],
      "numpy>=2.2.0",
      "C:\\Users\\tester\\.slidesmith\\python-deps\\abc123",
      { onlyBinary: true },
    );

    expect(bootstrap).toEqual({
      command: "py",
      args: [
        "-3.12",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--upgrade",
        "--prefer-binary",
        "--only-binary",
        ":all:",
        "numpy>=2.2.0",
        "--target",
        "C:\\Users\\tester\\.slidesmith\\python-deps\\abc123",
      ],
    });
  });

  it("can build a relaxed per-package bootstrap command without binary preference", () => {
    const bootstrap = buildDependencyPackageBootstrapCommand(
      "python3",
      [],
      "pyffi>=2.2.3",
      "/home/user/.slidesmith/python-deps/abc123",
      { preferBinary: false },
    );

    expect(bootstrap).toEqual({
      command: "python3",
      args: [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--upgrade",
        "pyffi>=2.2.3",
        "--target",
        "/home/user/.slidesmith/python-deps/abc123",
      ],
    });
  });

  it("builds a bundled dependency probe command with interpreter args preserved", () => {
    const probe = buildBundledDependencyProbeCommand("py", ["-3.12"]);

    expect(probe.command).toBe("py");
    expect(probe.args[0]).toBe("-3.12");
    expect(probe.args[1]).toBe("-c");
    expect(probe.args[2]).toContain("import importlib.util");
    expect(probe.args[2]).toContain("pyffi");
    expect(probe.args[2]).toContain("pyvista");
  });

  it("builds a python version probe command with interpreter args preserved", () => {
    const probe = buildPythonVersionProbeCommand("py", ["-3.12"]);

    expect(probe.command).toBe("py");
    expect(probe.args[0]).toBe("-3.12");
    expect(probe.args[1]).toBe("-c");
    expect(probe.args[2]).toContain("version_info.major");
    expect(probe.args[2]).toContain("version_info.minor");
    expect(probe.args[2]).toContain("calcsize('P') * 8");
  });
});

describe("python dependency target path", () => {
  it("uses configured dependency directory when provided", () => {
    const target = getPythonDependencyTargetPath("python3", [], {
      homeDir: "/unused-home",
      env: {
        SLIDESMITH_PYTHON_DEPS_DIR: "/custom/slide-smith-python",
      } as NodeJS.ProcessEnv,
    });
    expect(target.startsWith("/custom/slide-smith-python/")).toBe(true);
  });

  it("derives a deterministic path per interpreter command and args", () => {
    const first = getPythonDependencyTargetPath("py", ["-3.12"], {
      homeDir: "/home/tester",
      env: {} as NodeJS.ProcessEnv,
    });
    const second = getPythonDependencyTargetPath("py", ["-3.12"], {
      homeDir: "/home/tester",
      env: {} as NodeJS.ProcessEnv,
    });
    const different = getPythonDependencyTargetPath("py", ["-3.11"], {
      homeDir: "/home/tester",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first.startsWith("/home/tester/.slidesmith/python-deps/")).toBe(
      true,
    );
  });
});
