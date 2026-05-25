import { describe, expect, it } from "vitest";
import {
  getPythonInterpreterCandidates,
  getRunnerPathCandidates,
  isPythonRunnerPathRunnable,
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
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.12"] });
    expect(interpreters).toContainEqual({ command: "py", args: ["-3.11"] });
    expect(interpreters).toContainEqual({ command: "python3", args: [] });
    expect(interpreters).toContainEqual({ command: "python", args: [] });
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
        pynifly: true,
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
        pynifly: false,
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
