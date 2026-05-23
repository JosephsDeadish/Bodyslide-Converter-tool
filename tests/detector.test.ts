import { describe, expect, it } from "vitest";
import { detectBodyType } from "../src/detector.js";
import { createConversionPlan } from "../src/planner.js";
import type { ScannedFile } from "../src/types.js";

function file(relativePath: string, preview = ""): ScannedFile {
  const basename = relativePath.split("/").at(-1) ?? relativePath;
  const extension = basename.includes(".")
    ? `.${basename.split(".").at(-1)}`
    : "";

  return {
    absolutePath: `/mods/${relativePath}`,
    relativePath,
    extension,
    basename,
    preview,
  };
}

describe("detectBodyType", () => {
  it("detects cbbe from filename and preview signals", () => {
    const detection = detectBodyType([
      file("meshes/armor/cbbe_cuirass_1.nif", "caliente body"),
      file("calientetools/slidergroups/cbbe.xml", "cbbe curvy"),
    ]);

    expect(detection.bodyType).toBe("cbbe");
    expect(detection.confidence).toBeGreaterThan(0);
  });

  it("returns unknown when no signals are found", () => {
    const detection = detectBodyType([
      file("meshes/armor/steel_armor.nif", "plain armor"),
    ]);

    expect(detection.bodyType).toBe("unknown");
    expect(detection.confidence).toBe(0);
  });
});

describe("createConversionPlan", () => {
  it("adds target specific operations for 3ba", () => {
    const detection = detectBodyType([
      file("meshes/3ba/body_0.nif", "3bbb body"),
    ]);
    const plan = createConversionPlan(detection, "3ba", [
      file("meshes/3ba/body_0.nif"),
    ]);

    expect(
      plan.operations.some((operation) => operation.id === "physics"),
    ).toBe(true);
  });
});
