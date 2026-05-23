import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMod } from "../src/converter.js";
import { detectBodyType } from "../src/detector.js";
import { scanModFiles } from "../src/scanner.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bodyslide-converter-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("convertMod", () => {
  it("copies meshes and rewrites text assets for supported conversions", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // meshes/ is canonical — path is preserved as-is after alias rewriting.
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    // Non-canonical path → normalised to CalienteTools/BodySlide/SliderSets/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });

    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_1.nif"),
      "caliente",
    );
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "cbbe_armor.xml"),
      '<SliderGroups><Group name="CBBE Armor">cbbe curvy</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    expect(result.sourceBodyType).toBe("cbbe");
    expect(result.conversionMode).toBe("compatibility");
    expect(result.preferredOutputAlias).toBe("3BA");
    expect(
      result.warnings.some((warning) =>
        warning.includes("external mesh QA is optional"),
      ),
    ).toBe(true);
    // XML (BodySlide group) → CalienteTools/BodySlide/SliderGroups/
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_armor.xml"),
      ),
    ).toBe(true);
    // NIF already under meshes/ — preserved
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_cuirass_1.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "3BA_armor.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("3BA");
  });

  it("remaps known physics bone references in text configs", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Non-canonical "configs/" path — not a recognised Skyrim data root.
    await mkdir(join(inputDir, "configs"), { recursive: true });
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "configs", "cbpc_3ba.ini"),
      "NPC L Breast01=0.7\nNPC R Breast01=0.7\nNPC L Butt=0.4\nNPC R Butt=0.4",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "3ba_outfit_0.nif"),
      "3bbb amazing body",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "bhunp",
    );

    expect(result.sourceBodyType).toBe("3ba");
    // .ini is not a BodySlide or mesh type — kept at its rewritten relative path
    const rewritten = await readFile(
      join(outputDir, "configs", "cbpc_BHUNP.ini"),
      "utf8",
    );
    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast R01");
  });

  it("supports additional compatible female-body native paths", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    // Non-canonical — will be normalised to SliderGroups/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });

    await writeFile(
      join(inputDir, "meshes", "armor", "bhunp_boots_0.nif"),
      "bhunp body",
    );
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "bhunp_armor.xml"),
      '<SliderGroups><Group name="BHUNP Armor">bhunp preset</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "uunp",
    );

    expect(result.sourceBodyType).toBe("bhunp");
    expect(result.targetBodyType).toBe("uunp");
    expect(result.preferredOutputAlias).toBe("UUNP");
    expect(
      result.warnings.some((warning) => warning.includes("compatibility mode")),
    ).toBe(true);

    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "UUNP_armor.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("UUNP");
  });

  it("supports compatible CBBE-family metadata rewrites", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Non-canonical — normalised to SliderGroups/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "tbd_fitted.xml"),
      '<SliderGroups><Group name="TBD Armor">touched by dibella</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "cbbe",
    );

    expect(result.sourceBodyType).toBe("tbd");
    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "CBBE_fitted.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("CBBE");
  });

  it("supports compatible male-body metadata rewrites", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Non-canonical — normalised to SliderGroups/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "HIMBO_armor.xml"),
      '<SliderGroups><Group name="HIMBO Armor">highpolymalebody</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "sam",
    );

    expect(result.sourceBodyType).toBe("himbo");
    expect(result.conversionPath).toBe("HIMBO ↔ SAM ↔ BodyTalk ↔ SOS");
    expect(result.preferredOutputAlias).toBe("SAM");

    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "SAM_armor.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("SAM");
  });

  it("supports cross-gender outfit adaptation and gendered asset renames", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(
      join(inputDir, "meshes", "actors", "character", "character assets"),
      {
        recursive: true,
      },
    );
    // Non-canonical — normalised to SliderGroups/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_1.nif"),
      "caliente",
    );
    await writeFile(
      join(
        inputDir,
        "meshes",
        "actors",
        "character",
        "character assets",
        "femalebody_0.nif",
      ),
      "caliente femalebody",
    );
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "cbbe_female_outfit.xml"),
      '<SliderGroups><Group name="CBBE Female Outfit">femalehands cbbe curvy</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "himbo",
    );

    expect(result.sourceBodyType).toBe("cbbe");
    expect(result.targetBodyType).toBe("himbo");
    expect(result.conversionPath).toBe("Cross-gender outfit adaptation");
    expect(
      result.warnings.some((warning) =>
        warning.includes(
          "Cross-gender adaptation rewrote common female asset markers",
        ),
      ),
    ).toBe(true);

    const rewrittenMetadata = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "HIMBO_male_outfit.xml",
      ),
      "utf8",
    );
    expect(rewrittenMetadata).toContain("malehands");
    expect(rewrittenMetadata).toContain("HIMBO");

    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("character assets/malebody_0.nif"),
      ),
    ).toBe(true);
  });

  it("supports BodyTalk as a male-family target", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Non-canonical — normalised to SliderGroups/
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "sam_armor.xml"),
      '<SliderGroups><Group name="SAM Armor">shape atlas for men</Group></SliderGroups>',
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "bodytalk",
    );

    expect(result.sourceBodyType).toBe("sam");
    expect(result.targetBodyType).toBe("bodytalk");
    expect(result.conversionPath).toBe("HIMBO ↔ SAM ↔ BodyTalk ↔ SOS");

    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "BodyTalk_armor.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("BodyTalk");
  });

  it("synthesizes missing _1 weight mesh when only _0 exists", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.nif"),
      "caliente cbbe",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.endsWith("3BA_cuirass_1.nif") &&
          file.action === "synthesized",
      ),
    ).toBe(true);
    const synthesized = await readFile(
      join(outputDir, "meshes", "armor", "3BA_cuirass_1.nif"),
      "utf8",
    );
    expect(synthesized).toContain("caliente");
  });

  it("normalizes OSP files to CalienteTools/BodySlide/SliderSets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Flat OSP — not under any canonical root
    await writeFile(
      join(inputDir, "CBBE_Armor.osp"),
      "<SliderSetInfo><SliderSet name='CBBE Armor'>cbbe body</SliderSet></SliderSetInfo>",
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    expect(result.sourceBodyType).toBe("cbbe");
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_Armor.osp",
      ),
    ).toBe(true);
    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "3BA_Armor.osp",
      ),
      "utf8",
    );
    expect(rewritten).toContain("3BA");
  });

  it("normalizes non-canonical NIF files to meshes/ prefix", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // NIF with no recognised root prefix — should land under meshes/
    await writeFile(join(inputDir, "cbbe_boots_0.nif"), "caliente cbbe");

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    expect(result.sourceBodyType).toBe("cbbe");
    expect(
      result.convertedFiles.some(
        (file) => file.outputPath === "meshes/3BA_boots_0.nif",
      ),
    ).toBe(true);
  });

  it("preserves already-canonical CalienteTools paths unchanged", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "CBBE_Armor.osp",
      ),
      "<SliderSetInfo><SliderSet name='CBBE Armor'>cbbe body</SliderSet></SliderSetInfo>",
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    // Must stay in CalienteTools/BodySlide/SliderSets/ — no double-nesting
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_Armor.osp",
      ),
    ).toBe(true);
  });
});
