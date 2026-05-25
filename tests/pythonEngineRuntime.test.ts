import { describe, expect, it } from "vitest";
import { getRunnerPathCandidates } from "../src/engine/pythonEngine.js";

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
  });
});
