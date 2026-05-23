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
    expect(detection.rankedCandidates).toHaveLength(0);
  });

  it("detects sam and exposes ranked candidates", () => {
    const detection = detectBodyType([
      file("meshes/actors/character/sam_light_body.nif", "shape atlas for men"),
      file("bodyslide/slidersets/sam_light_armor.xml", "sam light"),
      file("bodyslide/shapedata/sam_light_body/sam_light.nif", "vectorplexus"),
    ]);

    expect(detection.bodyType).toBe("sam");
    expect(detection.rankedCandidates.at(0)?.bodyType).toBe("sam");
    expect(detection.rankedCandidates.at(0)?.share).toBeGreaterThan(0);
  });

  it("does not misclassify male BodyTalk signals as cbbe", () => {
    const detection = detectBodyType([
      file(
        "meshes/actors/character/malebody/bodytalk_body.nif",
        "bodytalk high poly male body",
      ),
    ]);

    expect(detection.bodyType).not.toBe("cbbe");
    expect(detection.bodyType).toBe("bodytalk");
  });

  it("uses gender hints to avoid female-body false positives", () => {
    const detection = detectBodyType([
      file(
        "meshes/actors/character/malebody/himbo_cuirass_0.nif",
        "cbbe conversion with highpolymalebody markers",
      ),
    ]);

    expect(detection.bodyType).toBe("himbo");
    expect(detection.confidence).toBeGreaterThan(0);
  });

  it("uses canonical CalienteTools BodySlide paths as strong evidence", () => {
    const detection = detectBodyType([
      file(
        "CalienteTools/BodySlide/SliderSets/CBBE_Armor.osp",
        "caliente cbbe curvy",
      ),
      file(
        "CalienteTools/BodySlide/ShapeData/CBBE/CBBE_Body_0.nif",
        "cbbe body",
      ),
    ]);

    expect(detection.bodyType).toBe("cbbe");
    expect(detection.confidence).toBeGreaterThan(0.65);
  });

  it("does not misclassify bhunp content as plain unp", () => {
    const detection = detectBodyType([
      file(
        "CalienteTools/BodySlide/SliderSets/BHUNP_Armor.osp",
        "bhunp 3bbb bonehunger unp",
      ),
      file("SKSE/plugins/cbpc/bhunp.ini", "bhunp breast l01 bhunp breast r01"),
    ]);

    expect(detection.bodyType).toBe("bhunp");
    expect(detection.rankedCandidates.at(0)?.bodyType).toBe("bhunp");
  });

  it("detects tbd (Touched by Dibella) by author/name signals without thebiggestbody", () => {
    // "thebiggestbody" was a wrong signal removed from TBD — must not drive detection
    const falseSignal = detectBodyType([
      file("meshes/armor/thebiggestbody_armor.nif", "thebiggestbody"),
    ]);
    expect(falseSignal.bodyType).not.toBe("tbd");

    // Correct TBD signals must still work
    const detection = detectBodyType([
      file(
        "CalienteTools/BodySlide/SliderSets/TBD_Armor.osp",
        "touched by dibella maars",
      ),
      file("bodyslide/shapedata/tbd_body/tbd.nif", "tbd body"),
    ]);
    expect(detection.bodyType).toBe("tbd");
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
      plan.operations.some((operation) => operation.id === "physics-weight"),
    ).toBe(true);
  });

  it("adds target specific operations for sam", () => {
    const detection = detectBodyType([
      file("meshes/actors/character/himbo_body_0.nif", "himbo"),
    ]);
    const plan = createConversionPlan(detection, "sam", [
      file("meshes/actors/character/himbo_body_0.nif"),
    ]);

    expect(
      plan.operations.some((operation) => operation.id === "sam-morph"),
    ).toBe(true);
  });

  it("adds cross-gender planning operations when adapting to a male body", () => {
    const detection = detectBodyType([
      file("meshes/armor/cbbe_cuirass_0.nif", "caliente cbbe"),
    ]);
    const plan = createConversionPlan(detection, "himbo", [
      file("meshes/armor/cbbe_cuirass_0.nif"),
    ]);

    expect(
      plan.operations.some(
        (operation) => operation.id === "cross-gender-shape",
      ),
    ).toBe(true);
    expect(
      plan.operations.some(
        (operation) => operation.id === "cross-gender-assets",
      ),
    ).toBe(true);
  });
});
