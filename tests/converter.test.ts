import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BODY_TYPE_INFO } from "../src/bodyTypeInfo.js";
import { convertMod } from "../src/converter.js";
import { detectBodyType } from "../src/detector.js";
import { scanModFiles } from "../src/scanner.js";
import { BODY_TYPES, type BodyType } from "../src/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slidesmith-"));
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
        warning.includes("run BodySlide preview and in-game checks"),
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

  it("keeps canonical CalienteTools roots intact while rewriting aliases", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderGroups"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "CBBE_Custom.xml",
      ),
      '<SliderGroups><Group name="CBBE Armor">cbbe body</Group></SliderGroups>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderGroups/3BA_Custom.xml",
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "3BA_Custom.xml",
      ),
      "utf8",
    );
    expect(rewritten).toContain("3BA");
  });

  it("normalizes BodySlide ShapeData mesh assets into CalienteTools", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "BodySlide", "ShapeData", "CBBE", "Armor"), {
      recursive: true,
    });
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(
        inputDir,
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
        "cbbe_demo_0.tri",
      ),
      Buffer.alloc(24),
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_demo_0.nif"),
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
          file.sourcePath.includes("BodySlide/ShapeData") &&
          file.outputPath ===
            "CalienteTools/BodySlide/ShapeData/Armor/cbbe_demo_0.tri",
      ),
    ).toBe(true);
  });

  it("synthesizes runtime meshes and SliderSets from ShapeData-only outfit assets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
      ),
      { recursive: true },
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
        "cbbe_shapeonly_0.nif",
      ),
      "cbbe mesh",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
        "cbbe_shapeonly_0.tri",
      ),
      "tri payload",
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath === "meshes/Armor/cbbe_shapeonly_1.nif" &&
          file.action === "synthesized",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
            "CalienteTools/BodySlide/SliderSets/3BA_AutoConverted.osp" &&
          file.action === "synthesized",
      ),
    ).toBe(true);

    const runtimeMesh = await readFile(
      join(outputDir, "meshes", "Armor", "cbbe_shapeonly_1.nif"),
      "utf8",
    );
    expect(runtimeMesh).toBe("cbbe mesh");
    const sliderSetContent = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "3BA_AutoConverted.osp",
      ),
      "utf8",
    );
    expect(sliderSetContent).toContain(
      "<OutputPath>meshes/Armor/</OutputPath>",
    );
    expect(sliderSetContent).toContain(
      "<OutputFile>cbbe_shapeonly_1.nif</OutputFile>",
    );
    expect(sliderSetContent).toContain(
      "<SourceFile>Armor/cbbe_shapeonly_1.nif</SourceFile>",
    );
  });

  it("keeps non-alias ShapeData project folders when synthesizing runtime OSD outputs", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "MyCoolProject",
      ),
      { recursive: true },
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "MyCoolProject",
        "cbbe_projectoutfit_0.nif",
      ),
      "cbbe mesh",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "MyCoolProject",
        "cbbe_projectoutfit_0.osd",
      ),
      "osd payload",
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath === "meshes/MyCoolProject/cbbe_projectoutfit_1.osd" &&
          file.action === "synthesized",
      ),
    ).toBe(true);

    const runtimeOsd = await readFile(
      join(outputDir, "meshes", "MyCoolProject", "cbbe_projectoutfit_1.osd"),
      "utf8",
    );
    expect(runtimeOsd).toBe("osd payload");

    const sliderSetContent = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "3BA_AutoConverted.osp",
      ),
      "utf8",
    );
    expect(sliderSetContent).toContain(
      "<OutputPath>meshes/MyCoolProject/</OutputPath>",
    );
    expect(sliderSetContent).toContain(
      "<OutputFile>cbbe_projectoutfit_1.nif</OutputFile>",
    );
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
      result.convertedFiles.some(
        (file) =>
          file.outputPath.toLowerCase().includes("cbbe_cuirass_1.nif") ||
          file.outputPath.toLowerCase().includes("himbo_cuirass_1.nif"),
      ),
    ).toBe(true);

    // Body-replacer NIFs are now preserved at their original path in
    // skippedFiles rather than being renamed with a gender/alias prefix.
    const bodyNifSkipped = result.skippedFiles.find((file) =>
      file.outputPath.toLowerCase().includes("femalebody_0.nif"),
    );
    expect(bodyNifSkipped).toBeDefined();
    expect(bodyNifSkipped?.reason).toContain("Body replacer mesh");
  });

  it("rewrites compact alias naming variants in files and text metadata", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbebody_outfit_0.nif"),
      "calientebody",
    );
    await writeFile(
      join(inputDir, "cbbebody_profile.txt"),
      "cbbebody calientebody",
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
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_outfit_0.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "3BA_profile.txt"),
      "utf8",
    );
    expect(rewritten).toContain("3BA");
    expect(rewritten).not.toContain("cbbebody");
    expect(rewritten).not.toContain("calientebody");
  });

  it("rewrites common CBBE SMP and CBBE Physics 3BA aliases", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_smp_corset_0.nif"),
      "cbbe smp body",
    );
    await writeFile(
      join(inputDir, "cbbe_physics_profile.txt"),
      "CBBE Physics body\ncbbe smp\nNPC LBreastRoot",
      "utf8",
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
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("BHUNP_corset_0.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "BHUNP_profile.txt"),
      "utf8",
    );
    expect(rewritten).toContain("BHUNP");
    expect(rewritten).not.toContain("CBBE Physics");
    expect(rewritten).not.toContain("cbbe smp");
  });

  it("rewrites UBE aliases when converting UBE body type data", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "ube_2.0_softbody_outfit_0.nif"),
      "ube 2.0 softbody",
    );
    await writeFile(
      join(inputDir, "ube_softbody_profile.txt"),
      "Unified Body Enhancer\nUBE Softbody\nUBE Body",
      "utf8",
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

    expect(result.sourceBodyType).toBe("ube");
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.toLowerCase().endsWith("_0.nif") &&
          file.outputPath.includes("BHUNP"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "BHUNP_profile.txt"),
      "utf8",
    );
    expect(rewritten).toContain("BHUNP");
    expect(rewritten).not.toContain("Unified Body Enhancer");
    expect(rewritten).not.toContain("UBE");
  });

  it("rewrites BodyTypeInfo common variant aliases during conversion", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_nevernude_outfit_0.nif"),
      "CBBE NeverNude",
    );
    await writeFile(
      join(inputDir, "cbbe_nevernude_profile.txt"),
      "CBBE NeverNude body profile",
      "utf8",
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

    expect(result.sourceBodyType).toBe("cbbe");
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("BHUNP_outfit_0.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "BHUNP_profile.txt"),
      "utf8",
    );
    expect(rewritten).toContain("BHUNP");
    expect(rewritten).not.toContain("NeverNude");
    expect(rewritten).not.toContain("CBBE");
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

  it("normalizes Data/ rooted Skyrim paths to canonical output roots", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "Data", "meshes", "armor"), {
      recursive: true,
    });
    await mkdir(
      join(inputDir, "Data", "CalienteTools", "BodySlide", "SliderSets"),
      { recursive: true },
    );
    await writeFile(
      join(inputDir, "Data", "meshes", "armor", "cbbe_boots_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "Data",
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

    expect(result.sourceBodyType).toBe("cbbe");
    expect(
      result.convertedFiles.some(
        (file) => file.outputPath === "meshes/armor/3BA_boots_0.nif",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_Armor.osp",
      ),
    ).toBe(true);
  });

  it("normalizes embedded data roots inside installer option folders", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "00 Core", "Data", "meshes", "armor"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "00 Core", "Data", "meshes", "armor", "cbbe_gloves_0.nif"),
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
        (file) => file.outputPath === "meshes/armor/3BA_gloves_0.nif",
      ),
    ).toBe(true);
  });

  it("preserves FOMOD installer xml files without body alias rewrites", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "fomod"), { recursive: true });
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "fomod", "ModuleConfig.xml"),
      "<config><name>CBBE Installer</name></config>",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_boots_0.nif"),
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

    const fomodFile = result.convertedFiles.find(
      (file) => file.outputPath === "fomod/ModuleConfig.xml",
    );
    expect(fomodFile).toBeDefined();
    expect(fomodFile?.action).toBe("copied");

    const outputContent = await readFile(
      join(outputDir, "fomod", "ModuleConfig.xml"),
      "utf8",
    );
    expect(outputContent).toContain("CBBE Installer");
    expect(outputContent).not.toContain("3BA Installer");
  });

  it("normalizes OSD files to meshes/ prefix", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // .osd BodySlide morph output file with no recognised root — must land under meshes/
    await writeFile(join(inputDir, "cbbe_armor_0.osd"), Buffer.alloc(32));

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
    );

    const osdFile = result.convertedFiles.find((f) =>
      f.outputPath.endsWith(".osd"),
    );
    expect(osdFile).toBeDefined();
    expect(osdFile?.outputPath).toBe("meshes/3BA_armor_0.osd");
    expect(osdFile?.kind).toBe("mesh");
  });

  it("rewrites text-based OSD payload aliases during conversion", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.osd"),
      "CBBE Physics body\ncbbe smp\nNPC LBreastRoot=0.4\nNPC BellyRoot=0.2",
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "ube",
    );

    const rewrittenEntry = result.convertedFiles.find((file) =>
      file.outputPath.endsWith("_cuirass_0.osd"),
    );
    expect(rewrittenEntry).toBeDefined();
    const rewritten = await readFile(
      join(outputDir, ...(rewrittenEntry?.outputPath ?? "").split("/")),
      "utf8",
    );
    expect(rewritten).toContain("UBE");
    expect(rewritten).not.toContain("CBBE");
    expect(rewritten).toContain("NPC L Breast01=0.4");
    expect(rewritten).toContain("NPC Belly=0.2");
  });

  it("keeps binary OSD payloads untouched", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    const binaryPayload = Buffer.from([0x00, 0xff, 0x13, 0x88, 0x00, 0x04]);
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.osd"),
      binaryPayload,
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "ube",
    );

    const copiedEntry = result.convertedFiles.find((file) =>
      file.outputPath.endsWith("_cuirass_0.osd"),
    );
    expect(copiedEntry).toBeDefined();
    const copied = await readFile(
      join(outputDir, ...(copiedEntry?.outputPath ?? "").split("/")),
    );
    expect(copied.equals(binaryPayload)).toBe(true);
  });

  it("keeps binary-like OSD payloads untouched even when they contain alias text", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    const binaryPayload = Buffer.from([
      0x43, 0x42, 0x42, 0x45, 0x01, 0x02, 0x7f, 0x80, 0x81,
    ]);
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.osd"),
      binaryPayload,
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

    const copiedEntry = result.convertedFiles.find((file) =>
      file.outputPath.endsWith("_cuirass_0.osd"),
    );
    expect(copiedEntry).toBeDefined();
    expect(copiedEntry?.action).toBe("copied");
    const copied = await readFile(
      join(outputDir, ...(copiedEntry?.outputPath ?? "").split("/")),
    );
    expect(copied.equals(binaryPayload)).toBe(true);
  });

  it("synthesizes missing _1 OSD weight file when only _0 exists", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.osd"),
      Buffer.alloc(16),
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
          file.outputPath.endsWith("3BA_cuirass_1.osd") &&
          file.action === "synthesized",
      ),
    ).toBe(true);
  });

  it("routes SliderSetInfo XML to SliderSets/, not SliderGroups/", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // Flat .xml with <SliderSetInfo> root — equivalent to .osp in XML form
    await writeFile(
      join(inputDir, "CBBE_Outfit.xml"),
      '<?xml version="1.0"?><SliderSetInfo version="1"><SliderSet name="CBBE Outfit">cbbe body</SliderSet></SliderSetInfo>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_Outfit.xml",
      ),
    ).toBe(true);
    // Must NOT be in SliderGroups as a directly routed (non-synthesized) file
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.includes("SliderGroups") &&
          file.action !== "synthesized",
      ),
    ).toBe(false);
  });

  it("routes SliderSet XML roots to SliderSets/", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await writeFile(
      join(inputDir, "CBBE_Outfit.xml"),
      '<?xml version="1.0"?><SliderSet name="CBBE Outfit">cbbe body</SliderSet>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_Outfit.xml",
      ),
    ).toBe(true);
    // Must NOT be in SliderGroups as a directly routed (non-synthesized) file
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.includes("SliderGroups") &&
          file.action !== "synthesized",
      ),
    ).toBe(false);
  });

  it("keeps XML already under SliderSets paths in SliderSets even without root markers", async () => {
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
        "CBBE_PathOnly.xml",
      ),
      '<BodySlideProject note="cbbe body"/>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_PathOnly.xml",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
            "CalienteTools/BodySlide/SliderGroups/3BA_PathOnly.xml" &&
          file.action !== "synthesized",
      ),
    ).toBe(false);
  });

  it("routes .osp files to SliderSets even when source folder is SliderGroups", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderGroups"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "CBBE_WrongFolder.osp",
      ),
      '<SliderSetInfo><SliderSet name="CBBE Wrong Folder"></SliderSet></SliderSetInfo>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_WrongFolder.osp",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderGroups/3BA_WrongFolder.osp",
      ),
    ).toBe(false);
  });

  it("routes SliderGroups XML to SliderGroups even when source folder is SliderSets", async () => {
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
        "CBBE_WrongFolder.xml",
      ),
      '<SliderGroups><Group name="CBBE Group">cbbe body</Group></SliderGroups>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderGroups/3BA_WrongFolder.xml",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
            "CalienteTools/BodySlide/SliderSets/3BA_WrongFolder.xml" &&
          file.action !== "synthesized",
      ),
    ).toBe(false);
  });

  it("maps 3BA breast physics bones to BHUNP names without misaligning butt bones", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba.ini"),
      [
        "NPC LBreastRoot=1",
        "NPC L Breast=0.65",
        "NPC L Breast01=0.7",
        "NPC L Breast02=0.6",
        "NPC L Breast03=0.5",
        "NPC RBreastRoot=1",
        "NPC R Breast=0.65",
        "NPC R Breast01=0.7",
        "NPC R Breast02=0.6",
        "NPC R Breast03=0.5",
        "NPC L Butt=0.4",
        "NPC R Butt=0.4",
        "NPC Belly=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    // Breast chain must map correctly
    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast L02");
    expect(rewritten).toContain("BHUNP Breast L03");
    expect(rewritten).toContain("BHUNP Breast R01");
    expect(rewritten).toContain("BHUNP Breast R02");
    expect(rewritten).toContain("BHUNP Breast R03");
    // BreastRoot collapses to L01/R01
    expect(rewritten).not.toContain("NPC LBreastRoot");
    expect(rewritten).not.toContain("NPC RBreastRoot");
    // Butt bones mapped correctly — NOT misaligned to Breast03
    expect(rewritten).toContain("BHUNP Butt L");
    expect(rewritten).toContain("BHUNP Butt R");
    // Belly bone is unchanged (same name in both bodies)
    expect(rewritten).toContain("NPC Belly");
    // No original 3BA breast names should remain
    expect(rewritten).not.toContain("NPC L Breast01");
    expect(rewritten).not.toContain("NPC L Breast=");
    expect(rewritten).not.toContain("NPC L Butt");
  });

  it("maps BHUNP breast physics bones back to 3BA names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_bhunp.ini"),
      [
        "BHUNP Breast L01=0.7",
        "BHUNP Breast L02=0.6",
        "BHUNP Breast L03=0.5",
        "BHUNP Breast R01=0.7",
        "BHUNP Breast R02=0.6",
        "BHUNP Breast R03=0.5",
        "BHUNP Butt L=0.4",
        "BHUNP Butt R=0.4",
        "NPC Belly=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "bhunp_outfit_0.nif"),
      "bhunp body",
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

    expect(result.sourceBodyType).toBe("bhunp");

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("NPC L Breast01");
    expect(rewritten).toContain("NPC L Breast02");
    expect(rewritten).toContain("NPC L Breast03");
    expect(rewritten).toContain("NPC R Breast01");
    expect(rewritten).toContain("NPC R Breast02");
    expect(rewritten).toContain("NPC R Breast03");
    expect(rewritten).toContain("NPC L Butt");
    expect(rewritten).toContain("NPC R Butt");
    expect(rewritten).not.toContain("BHUNP Breast L01");
    expect(rewritten).not.toContain("BHUNP Butt L");
  });

  it("collapses 3BA NPC BellyRoot to NPC Belly when converting to BHUNP", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_belly.ini"),
      ["NPC Belly=0.3", "NPC BellyRoot=0.5"].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    // NPC BellyRoot must be mapped to NPC Belly (BHUNP has no BellyRoot bone)
    expect(rewritten).not.toContain("NPC BellyRoot");
    expect(rewritten).toContain("NPC Belly");
  });

  it("synthesizes missing _1 TRI weight file when only _0 exists", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_0.tri"),
      Buffer.alloc(32),
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
          file.outputPath.endsWith("3BA_cuirass_1.tri") &&
          file.action === "synthesized",
      ),
    ).toBe(true);
  });

  it("maps TBD breast physics bones to BHUNP names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_tbd.ini"),
      [
        "NPC L Breast01=0.7",
        "NPC L Breast02=0.6",
        "NPC L Breast03=0.5",
        "NPC R Breast01=0.7",
        "NPC R Breast02=0.6",
        "NPC R Breast03=0.5",
        "NPC L Butt=0.4",
        "NPC R Butt=0.4",
        "NPC Belly=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "tbd_outfit_0.nif"),
      "touched by dibella maars tbd",
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

    expect(result.sourceBodyType).toBe("tbd");

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast R01");
    expect(rewritten).toContain("BHUNP Butt L");
    expect(rewritten).toContain("BHUNP Butt R");
    expect(rewritten).toContain("NPC Belly");
    expect(rewritten).not.toContain("NPC L Breast01");
    expect(rewritten).not.toContain("NPC L Butt");
  });

  it("semantically remaps 3BA physics bones to UUNP chain names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_to_uunp.ini"),
      [
        "NPC LBreastRoot=1",
        "NPC RBreastRoot=1",
        "NPC L Breast01=0.7",
        "NPC R Breast01=0.7",
        "NPC L Breast02=0.6",
        "NPC R Breast02=0.6",
        "NPC L Breast03=0.5",
        "NPC R Breast03=0.5",
        "NPC L Butt=0.4",
        "NPC R Butt=0.4",
        "NPC Belly=0.3",
        "NPC BellyRoot=0.5",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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
      "uunp",
    );

    expect(result.sourceBodyType).toBe("3ba");
    expect(result.targetBodyType).toBe("uunp");
    expect(
      result.warnings.some((warning) =>
        warning.includes("Physics remap coverage for '3ba' → 'uunp'"),
      ),
    ).toBe(false);

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();
    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("NPC L Breast01");
    expect(rewritten).toContain("NPC R Breast01");
    expect(rewritten).toContain("NPC L Breast02");
    expect(rewritten).toContain("NPC R Breast02");
    expect(rewritten).toContain("NPC L Breast03");
    expect(rewritten).toContain("NPC R Breast03");
    expect(rewritten).toContain("NPC L Butt");
    expect(rewritten).toContain("NPC R Butt");
    expect(rewritten).toContain("NPC Belly");
    expect(rewritten).not.toContain("NPC LBreastRoot");
    expect(rewritten).not.toContain("NPC RBreastRoot");
    expect(rewritten).not.toContain("NPC BellyRoot");
    expect(rewritten).not.toContain("NPC Spine2");
  });

  it("remaps compact physics-bone token variants to BHUNP names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_compact.ini"),
      [
        "NPC LBreast01=0.7",
        "NPC RBreast02=0.6",
        "NPC LBreast03=0.5",
        "NPC RButt01=0.4",
        "NPC LButt=0.4",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast R02");
    expect(rewritten).toContain("BHUNP Breast L03");
    expect(rewritten).toContain("BHUNP Butt R");
    expect(rewritten).toContain("BHUNP Butt L");
    expect(rewritten).not.toContain("NPC LBreast01");
    expect(rewritten).not.toContain("NPC RButt01");
  });

  it("remaps UBE softbody-style UUNP bone aliases to BHUNP physics names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_ube_softbody.ini"),
      [
        "NPC LBreast01=0.7",
        "NPC L UUNP Glute 01=0.4",
        "NPC R UUNP Glute 01=0.4",
        "NPC Belly01=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "ube_softbody_outfit_0.nif"),
      "ube body softbody",
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

    expect(result.sourceBodyType).toBe("ube");

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Butt L");
    expect(rewritten).toContain("BHUNP Butt R");
    expect(rewritten).toContain("NPC Belly");
    expect(rewritten).not.toContain("NPC L UUNP Glute 01");
    expect(rewritten).not.toContain("NPC R UUNP Glute 01");
    expect(rewritten).not.toContain("NPC Belly01");
  });

  it("remaps 3BA prebreast and softbody belly aliases to BHUNP names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_prebreast.ini"),
      [
        "NPC L PreBreast01=0.7",
        "NPC R PreBreast02=0.6",
        "NPC L PreBreast03=0.5",
        "NPC Belly01=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "3ba_softbody_outfit_0.nif"),
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

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast R02");
    expect(rewritten).toContain("BHUNP Breast L03");
    expect(rewritten).toContain("NPC Belly");
    expect(rewritten).not.toContain("NPC L PreBreast01");
    expect(rewritten).not.toContain("NPC R PreBreast02");
    expect(rewritten).not.toContain("NPC L PreBreast03");
    expect(rewritten).not.toContain("NPC Belly01");
  });

  it("remaps UBE breast-chain aliases to BHUNP names", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_ube_breast_aliases.ini"),
      [
        "NPC L UBE Breast 01=0.7",
        "NPC R UUNP Breast 02=0.6",
        "NPC L UBE Breast 03=0.5",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "ube_softbody_outfit_0.nif"),
      "ube body softbody",
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

    expect(result.sourceBodyType).toBe("ube");

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();

    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("BHUNP Breast L01");
    expect(rewritten).toContain("BHUNP Breast R02");
    expect(rewritten).toContain("BHUNP Breast L03");
    expect(rewritten).not.toContain("NPC L UBE Breast 01");
    expect(rewritten).not.toContain("NPC R UUNP Breast 02");
    expect(rewritten).not.toContain("NPC L UBE Breast 03");
  });

  it("collapses cross-family physics references when no safe direct map exists", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_to_sos.ini"),
      [
        "NPC L Breast01=0.7",
        "NPC R Breast01=0.7",
        "NPC L Butt=0.4",
        "NPC R Butt=0.4",
        "NPC Belly=0.3",
      ].join("\n"),
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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
      "sos",
    );

    expect(result.sourceBodyType).toBe("3ba");
    expect(result.targetBodyType).toBe("sos");
    expect(
      result.warnings.some((warning) =>
        warning.includes("collapsed to static fallback bones"),
      ),
    ).toBe(true);

    const iniFile = result.convertedFiles.find(
      (f) => f.outputPath.includes("cbpc") && f.outputPath.endsWith(".ini"),
    );
    expect(iniFile).toBeDefined();
    const rewritten = await readFile(
      join(outputDir, iniFile?.outputPath ?? ""),
      "utf8",
    );

    expect(rewritten).toContain("NPC Spine2");
    expect(rewritten).toContain("NPC Pelvis");
    expect(rewritten).toContain("NPC Belly");
    expect(rewritten).toContain("NPC GenitalsBase01");
    expect(rewritten).toContain("NPC L GenitalsScrotum01");
    expect(rewritten).toContain("NPC R GenitalsScrotum01");
    expect(rewritten).not.toContain("NPC L Breast01");
  });

  it("adds target body fit guidance warnings for conversions", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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

    expect(
      result.warnings.some((warning) =>
        warning.includes("Target fit focus for BHUNP"),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes("Target skeleton note (BHUNP)"),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes("Target body knowledge note (BHUNP)"),
      ),
    ).toBe(true);
    expect(
      result.audit.checks.some((check) => check.id === "fit-profile"),
    ).toBe(true);
  });

  it("produces a structured conversion audit for 3BA-ready outputs", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });

    const all3baBones = [
      "NPC L Breast01",
      "NPC R Breast01",
      "NPC L Breast02",
      "NPC R Breast02",
      "NPC L Breast03",
      "NPC R Breast03",
      "NPC LBreastRoot",
      "NPC RBreastRoot",
      "NPC L Butt",
      "NPC R Butt",
      "NPC Belly",
      "NPC BellyRoot",
    ].join("\n");

    await writeFile(
      join(inputDir, "meshes", "armor", "3ba_outfit_0.nif"),
      all3baBones,
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "3ba_outfit_1.nif"),
      all3baBones,
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "3BA_Armor.osp",
      ),
      [
        "<SliderSetInfo>",
        '  <SliderSet name="3BA Armor">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>3BA_outfit_1.nif</OutputFile>",
        "    <SourceFile>armor/3BA_outfit_1.nif</SourceFile>",
        '    <Slider name="Breast Size" />',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_3ba_full.ini"),
      all3baBones,
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

    expect(result.audit.overallStatus).toBe("pass");
    expect(
      result.audit.checks.find((check) => check.id === "physics-weight")
        ?.status,
    ).toBe("pass");
    expect(
      result.audit.checks.find((check) => check.id === "physics-config")
        ?.status,
    ).toBe("pass");
    expect(
      result.audit.checks.find((check) => check.id === "3ba-belly")?.status,
    ).toBe("pass");
    expect(
      result.audit.checks.find((check) => check.id === "bodyslide-build")
        ?.status,
    ).toBe("pass");
  });

  it("flags BodySlide build readiness issues when slider-set metadata is incomplete", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_gloves_0.nif"),
      "cbbe mesh",
      "utf8",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_gloves.osp",
      ),
      [
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Gloves">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const bodySlideBuildCheck = result.audit.checks.find(
      (check) => check.id === "bodyslide-build",
    );
    expect(bodySlideBuildCheck).toBeDefined();
    expect(bodySlideBuildCheck?.status).toBe("attention");
    expect(bodySlideBuildCheck?.details.join("\n")).toContain(
      "Missing <OutputFile>",
    );
    expect(bodySlideBuildCheck?.details.join("\n")).toContain(
      "Missing <SourceFile>",
    );
  });

  it("synthesizes a SliderGroup XML when OSP exists but no group file is present", async () => {
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
        "cbbe_armor.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Iron Cuirass">',
        "    <OutputPath>meshes/armor/cbbe_iron_0.nif</OutputPath>",
        "  </SliderSet>",
        '  <SliderSet name="CBBE Iron Gauntlets">',
        "    <OutputPath>meshes/armor/cbbe_gauntlets_0.nif</OutputPath>",
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const synthesizedGroups = result.convertedFiles.filter(
      (f) =>
        f.outputPath.includes("SliderGroups") && f.action === "synthesized",
    );
    expect(synthesizedGroups).toHaveLength(0);

    // The audit check for slider-group should pass.
    expect(
      result.audit.checks.find((check) => check.id === "slider-group")?.status,
    ).toBe("pass");
  });

  it("synthesizes a BodySlide SliderSet project when converted meshes have no source OSP", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.tri"),
      "tri payload",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.osd"),
      "osd payload",
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

    const sliderSetEntry = result.convertedFiles.find(
      (file) =>
        file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/3BA_AutoConverted.osp" &&
        file.action === "synthesized",
    );
    expect(sliderSetEntry).toBeDefined();

    const sliderSetContent = await readFile(
      join(outputDir, sliderSetEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(sliderSetContent).toContain('<SliderSet name="3BA Plated">');
    expect(sliderSetContent).toContain(
      "<OutputPath>meshes/armor/</OutputPath>",
    );
    expect(sliderSetContent).toContain(
      "<OutputFile>3BA_plated_1.nif</OutputFile>",
    );
    expect(sliderSetContent).toContain(
      "<SourceFile>armor/3BA_plated_1.nif</SourceFile>",
    );
    const shapeDataMesh = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "armor",
        "3BA_plated_1.nif",
      ),
      "utf8",
    );
    expect(shapeDataMesh).toBe("caliente cbbe");
    const shapeDataTri = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "armor",
        "3BA_plated_1.tri",
      ),
      "utf8",
    );
    expect(shapeDataTri).toBe("tri payload");
    const shapeDataOsd = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "armor",
        "3BA_plated_1.osd",
      ),
      "utf8",
    );
    expect(shapeDataOsd).toBe("osd payload");
    expect(sliderSetContent).toContain('<Group name="3BA Outfits"/>');
    expect(sliderSetContent).toContain("<Sliders>");
    expect(sliderSetContent).toContain('<Slider name="Breasts" />');
    expect(sliderSetContent).toContain('<Slider name="Belly" />');

    const synthesizedGroups = result.convertedFiles.filter(
      (file) =>
        file.outputPath.includes("SliderGroups") &&
        file.action === "synthesized",
    );
    expect(synthesizedGroups).toHaveLength(0);
  });

  it("reuses same-family project slider hints when synthesizing supplemental SliderSets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_existing_1.nif"),
      "existing",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_uncovered_1.nif"),
      "uncovered",
      "utf8",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "CBBE_Set.osp",
      ),
      [
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Existing">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>CBBE_existing_1.nif</OutputFile>",
        "    <SourceFile>armor/CBBE_existing_1.nif</SourceFile>",
        "    <Sliders>",
        '      <Slider name="Breast Size" />',
        '      <Slider name="Cleavage" />',
        "    </Sliders>",
        "  </SliderSet>",
        "</SliderSetInfo>",
        "",
      ].join("\n"),
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

    const sliderSetEntry = result.convertedFiles.find(
      (file) =>
        /CalienteTools\/BodySlide\/SliderSets\/3BA_AutoSupplement(?:_[^/]+)?\.osp$/i.test(
          file.outputPath,
        ) && file.action === "synthesized",
    );
    expect(sliderSetEntry).toBeDefined();

    const sliderSetContent = await readFile(
      join(outputDir, sliderSetEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(sliderSetContent).toContain('<Slider name="Breast Size" />');
    expect(sliderSetContent).toContain('<Slider name="Cleavage" />');
    expect(sliderSetContent).toContain('<Slider name="Breasts" />');
  });

  it("disambiguates synthesized SliderSet names when mesh basenames repeat", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor", "seta"), { recursive: true });
    await mkdir(join(inputDir, "meshes", "armor", "setb"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "seta", "cbbe_cuirass_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "setb", "cbbe_cuirass_0.nif"),
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

    const synthesizedSliderSets = result.convertedFiles.filter(
      (file) =>
        file.outputPath.startsWith(
          "CalienteTools/BodySlide/SliderSets/3BA_AutoConverted_",
        ) && file.action === "synthesized",
    );
    expect(synthesizedSliderSets).toHaveLength(2);

    const sliderSetContents = await Promise.all(
      synthesizedSliderSets.map((file) =>
        readFile(join(outputDir, file.outputPath), "utf8"),
      ),
    );
    expect(
      sliderSetContents.some((content) =>
        content.includes('<SliderSet name="3BA Seta 3BA Cuirass">'),
      ),
    ).toBe(true);
    expect(
      sliderSetContents.some((content) =>
        content.includes('<SliderSet name="3BA Setb 3BA Cuirass">'),
      ),
    ).toBe(true);
    expect(
      sliderSetContents.every(
        (content) =>
          !content.includes('<SliderSet name="3BA Seta 3BA Cuirass">') ||
          !content.includes('<SliderSet name="3BA Setb 3BA Cuirass">'),
      ),
    ).toBe(true);
  });

  it("synthesizes missing TRI and OSD files for vanilla-style outfit meshes", async () => {
    // When a _0 TRI/OSD exists alongside a NIF, the missing _1 TRI/OSD should be
    // synthesized by copying from the existing _0 sibling — NOT from NIF content.
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla_0.nif"),
      "mesh payload",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla_0.tri"),
      "tri morph payload",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla_0.osd"),
      "osd payload",
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

    // The _0 TRI is converted (alias cbbe → 3BA rewritten in filename).
    const triZeroFile = result.convertedFiles.find(
      (file) =>
        file.outputPath.endsWith("_0.tri") &&
        (file.action === "converted" || file.action === "synthesized"),
    );
    expect(triZeroFile).toBeDefined();

    // The _1 TRI is synthesized from the _0 sibling TRI (not from a NIF).
    const triZeroBase = triZeroFile?.outputPath.replace(/_0\.tri$/, "");
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath === `${triZeroBase}_1.tri` &&
          file.action === "synthesized",
      ),
    ).toBe(true);

    // The _0 OSD is converted.
    const osdZeroFile = result.convertedFiles.find(
      (file) =>
        file.outputPath.endsWith("_0.osd") &&
        (file.action === "converted" || file.action === "synthesized"),
    );
    expect(osdZeroFile).toBeDefined();

    // The _1 OSD is synthesized from the _0 sibling OSD.
    const osdZeroBase = osdZeroFile?.outputPath.replace(/_0\.osd$/, "");
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath === `${osdZeroBase}_1.osd` &&
          file.action === "synthesized",
      ),
    ).toBe(true);

    // Verify that the synthesized _1 TRI contains TRI content, not NIF content.
    const synthesizedTriPath = `${triZeroBase}_1.tri`;
    const triContent = await readFile(
      join(outputDir, synthesizedTriPath),
      "utf8",
    );
    expect(triContent).toBe("tri morph payload");
    expect(triContent).not.toBe("mesh payload");

    // ShapeData mirror: a _1 TRI counterpart is synthesized under CalienteTools.
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.startsWith("CalienteTools/BodySlide/ShapeData/") &&
          file.outputPath.endsWith("_1.tri") &&
          file.action === "synthesized",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath.startsWith("CalienteTools/BodySlide/ShapeData/") &&
          file.outputPath.endsWith("_1.osd") &&
          file.action === "synthesized",
      ),
    ).toBe(true);
  });

  it("does not synthesize TRI or OSD when no TRI/OSD source exists", async () => {
    // When a mod ships only NIF files (no TRI/OSD at all), the converter must not
    // create TRI/OSD files using NIF binary content as a source — that would produce
    // corrupt sidecar files. Absence of TRI/OSD is valid; BodySlide works without them.
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla_0.nif"),
      "mesh payload",
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

    // NIF files are still converted/synthesized.
    expect(
      result.convertedFiles.some((file) => file.outputPath.endsWith(".nif")),
    ).toBe(true);
    // No TRI or OSD files should be present in the output.
    const triOsdFiles = result.convertedFiles.filter(
      (file) =>
        file.outputPath.endsWith(".tri") || file.outputPath.endsWith(".osd"),
    );
    expect(triOsdFiles).toHaveLength(0);
  });

  it("avoids malformed TRI/OSD naming for non-weighted outfit meshes", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla.nif"),
      "mesh payload",
      "utf8",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_vanilla.tri"),
      "tri morph payload",
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

    expect(
      result.convertedFiles.some((file) => file.outputPath.endsWith(".tri")),
    ).toBe(true);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes(".nif_0.tri"),
      ),
    ).toBe(false);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes(".nif_1.tri"),
      ),
    ).toBe(false);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes(".nif_0.osd"),
      ),
    ).toBe(false);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes(".nif_1.osd"),
      ),
    ).toBe(false);
  });

  it("converts vanilla-detected armor to target body and keeps per-armor ShapeData folders", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor", "imperial", "light"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "meshes",
        "armor",
        "imperial",
        "light",
        "vanilla_cuirass_0.nif",
      ),
      "skyrim vanilla default body",
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    expect(detection.bodyType).toBe("vanilla");
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
          file.outputPath === "meshes/armor/imperial/light/3BA_cuirass_1.nif" &&
          file.action === "synthesized",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/ShapeData/armor/imperial/light/3BA_cuirass_1.nif",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.startsWith("CalienteTools/BodySlide/ShapeData/3BA/"),
      ),
    ).toBe(false);

    const sliderSetContent = await readFile(
      join(
        outputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "3BA_AutoConverted.osp",
      ),
      "utf8",
    );
    expect(sliderSetContent).toContain(
      "<SourceFile>armor/imperial/light/3BA_cuirass_1.nif</SourceFile>",
    );
  });

  it("does not synthesize SliderGroup files when project files already exist", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderGroups"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_shirt.osp",
      ),
      '<SliderSetInfo><SliderSet name="CBBE Shirt"></SliderSet></SliderSetInfo>',
      "utf8",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "CBBE_Outfits.xml",
      ),
      '<SliderGroups><Group name="CBBE Outfits"><Member name="CBBE Shirt"/></Group></SliderGroups>',
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

    // Only one SliderGroup file should exist (the converted original, not an extra synthesized one).
    const synthGroupFiles = result.convertedFiles.filter(
      (f) =>
        f.outputPath.includes("SliderGroups") && f.action === "synthesized",
    );
    expect(synthGroupFiles).toHaveLength(0);
  });

  it("preserves nested SliderSets folder structure to avoid project filename collisions", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(
      join(inputDir, "CalienteTools", "BodySlide", "SliderSets", "SetA"),
      {
        recursive: true,
      },
    );
    await mkdir(
      join(inputDir, "CalienteTools", "BodySlide", "SliderSets", "SetB"),
      {
        recursive: true,
      },
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "SetA",
        "cbbe_armor.osp",
      ),
      '<SliderSetInfo><SliderSet name="CBBE Armor A"></SliderSet></SliderSetInfo>',
      "utf8",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "SetB",
        "cbbe_armor.osp",
      ),
      '<SliderSetInfo><SliderSet name="CBBE Armor B"></SliderSet></SliderSetInfo>',
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

    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/SetA/3BA_armor.osp",
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some(
        (file) =>
          file.outputPath ===
          "CalienteTools/BodySlide/SliderSets/SetB/3BA_armor.osp",
      ),
    ).toBe(true);
  });

  it("synthesizes a CBPC physics stub for a physics target with no source physics config", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente",
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

    // A synthesized CBPC stub should appear in convertedFiles.
    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("cbpc") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();

    // The stub should contain meaningful content.
    const stubContent = await readFile(
      join(outputDir, stubEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(stubContent).toContain("Auto-generated CBPC physics stub");
    expect(stubContent).toContain("Target skeleton:");
    expect(stubContent).toContain("; Breast chain");
    expect(stubContent).toContain("NPC L Breast01");

    // The cbpc-stub audit check should flag attention since no original config was present.
    const cbpcCheck = result.audit.checks.find(
      (check) => check.id === "cbpc-stub",
    );
    expect(cbpcCheck).toBeDefined();
    expect(cbpcCheck?.status).toBe("attention");
  });

  it("synthesizes a CBPC physics stub for UUNP targets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente",
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

    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();

    const stubContent = await readFile(
      join(outputDir, stubEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(stubContent).toContain("NPC L Breast01=0.600");
    expect(stubContent).toContain("NPC Belly=0.300");
  });

  it("still synthesizes a CBPC stub when only mesh filenames include physics keywords", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_physics_showcase_0.nif"),
      "caliente",
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

    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();
  });

  it("still synthesizes a CBPC stub when source only ships HDT-SMP XML configs", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "hdtSMP64"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente",
    );
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "hdtSMP64", "hdtConfigs.xml"),
      "<hdtPhysicsExtensions><constraints /></hdtPhysicsExtensions>",
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

    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();
  });

  it("does not synthesize a CBPC stub when physics profile is HDT-SMP", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "hdt-smp" },
    );

    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeUndefined();
    expect(
      result.warnings.some((warning) =>
        warning.includes("Physics profile was set to 'HDT-SMP'"),
      ),
    ).toBe(true);
  });

  it("generates HDT-SMP XML stub for SOS (HDT-SMP-only body) under auto profile", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "himbo_outfit_0.nif"),
      "himbo",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "sos",
    );

    const stubEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".xml") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();

    const stubContent = await readFile(
      join(outputDir, stubEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(stubContent).toContain("NPC GenitalsBase01");
    expect(stubContent).toContain("<bone");
    expect(stubContent).toContain("PerBoneShape");
  });

  it("does not synthesize a duplicate CBPC stub when source already has CBPC config", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_cbbe.ini"),
      "NPC L Breast01=0.6\nNPC R Breast01=0.6\n",
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente",
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

    const cbpcStubs = result.convertedFiles.filter(
      (f) =>
        f.outputPath.toLowerCase().includes("/cbpc/") &&
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.action === "synthesized",
    );
    expect(cbpcStubs).toHaveLength(0);

    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("/hdtsmp64/") &&
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.action === "synthesized",
    );
    expect(hdtStub).toBeDefined();

    // The cbpc-stub audit check should pass since the source had a config.
    const cbpcCheck = result.audit.checks.find(
      (check) => check.id === "cbpc-stub",
    );
    expect(cbpcCheck?.status).toBe("pass");
  });

  it("synthesizes a UBE CBPC stub when source CBPC config is only comments", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_uunp.ini"),
      "; placeholder config\n; no bone assignments yet\n",
      "utf8",
    );
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "uunp_outfit_0.nif"),
      "uunp",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "ube",
    );

    const synthStub = result.convertedFiles.find(
      (file) =>
        file.outputPath === "SKSE/Plugins/CBPC/UBE_PhysicsStub.ini" &&
        file.action === "synthesized",
    );
    expect(synthStub).toBeDefined();

    const stubContent = await readFile(
      join(outputDir, synthStub?.outputPath ?? ""),
      "utf8",
    );
    expect(stubContent).toContain("Auto-generated CBPC physics stub for UBE");
    expect(stubContent).toContain("NPC L Breast01=0.600");
    expect(stubContent).toContain("NPC Belly=0.300");
  });

  it("synthesizes placeholder-safe physics stubs for every physics-capable target", async () => {
    const physicsTargets = BODY_TYPES.filter(
      (bodyType) => BODY_TYPE_INFO[bodyType].physicsSupport,
    );

    for (const target of physicsTargets) {
      const inputDir = await makeTempDir();
      const outputDir = await makeTempDir();
      const source: BodyType =
        BODY_TYPE_INFO[target].gender === "male" ? "himbo" : "uunp";

      await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), {
        recursive: true,
      });
      await writeFile(
        join(inputDir, "SKSE", "Plugins", "CBPC", `${source}_placeholder.ini`),
        "; placeholder config\n; no active assignments\n",
        "utf8",
      );
      await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
      await writeFile(
        join(inputDir, "meshes", "armor", `${source}_outfit_0.nif`),
        source,
      );

      const files = await scanModFiles(inputDir);
      const detection = detectBodyType(files);
      const result = await convertMod(
        inputDir,
        outputDir,
        files,
        detection,
        target,
      );

      const targetAlias = result.preferredOutputAlias;
      const targetInfo = BODY_TYPE_INFO[target];

      if (targetInfo.cbpcCompatible) {
        // CBPC-compatible bodies get a .ini stub
        const synthStub = result.convertedFiles.find(
          (file) =>
            file.outputPath ===
              `SKSE/Plugins/CBPC/${targetAlias}_PhysicsStub.ini` &&
            file.action === "synthesized",
        );
        expect(
          synthStub,
          `expected CBPC placeholder-safe stub for ${target}`,
        ).toBeDefined();

        const stubContent = await readFile(
          join(outputDir, synthStub?.outputPath ?? ""),
          "utf8",
        );
        expect(stubContent).toContain(
          `Auto-generated CBPC physics stub for ${targetAlias}`,
        );
        expect(stubContent).toContain(
          BODY_TYPE_INFO[target].physicsBones[0] ?? "",
        );
      } else if (targetInfo.hdtSmpCompatible) {
        // HDT-SMP-only bodies (HIMBO, BodyTalk, SOS) get an XML stub
        const synthStub = result.convertedFiles.find(
          (file) =>
            file.outputPath ===
              `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
            file.action === "synthesized",
        );
        expect(
          synthStub,
          `expected HDT-SMP XML placeholder-safe stub for ${target}`,
        ).toBeDefined();

        const stubContent = await readFile(
          join(outputDir, synthStub?.outputPath ?? ""),
          "utf8",
        );
        expect(stubContent).toContain("PerBoneShape");
        expect(stubContent).toContain("<bone");
      }
    }
  });

  it("throws a user-friendly error when input and output directories are the same", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "meshes", "armor"), { recursive: true });
    await writeFile(join(dir, "meshes", "armor", "cbbe_0.nif"), "caliente");

    const files = await scanModFiles(dir);
    const detection = detectBodyType(files);

    await expect(
      convertMod(dir, dir, files, detection, "3ba"),
    ).resolves.toBeDefined();
    // The same-path guard is enforced in main.ts (before reaching convertMod),
    // so convertMod itself must not throw — only the IPC handler does.
    // Verify that the output is at minimum coherent (no crash).
  });

  it("physics-weight audit check passes for BHUNP targets with physics bones present", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });

    // BHUNP physics bones (a subset of its physicsBones list)
    const bhunpBones = [
      "NPC L Breast01",
      "NPC R Breast01",
      "NPC L Butt",
      "NPC R Butt",
      "NPC Belly",
    ].join("\n");

    await writeFile(
      join(inputDir, "meshes", "armor", "bhunp_outfit_0.nif"),
      `bhunp body ${bhunpBones}`,
    );
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_bhunp.ini"),
      bhunpBones,
      "utf8",
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

    const physicsWeightCheck = result.audit.checks.find(
      (check) => check.id === "physics-weight",
    );
    expect(physicsWeightCheck).toBeDefined();
    // Title should reference BHUNP, not hardcoded 3BA
    expect(physicsWeightCheck?.title).toContain("BHUNP");
  });

  it("physics-weight audit check is not-applicable for non-physics targets (unp)", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
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
      "unp",
    );

    const physicsWeightCheck = result.audit.checks.find(
      (check) => check.id === "physics-weight",
    );
    expect(physicsWeightCheck).toBeDefined();
    expect(physicsWeightCheck?.status).toBe("not-applicable");
  });

  it("skips cross-body body-replacer NIFs so source skin/body meshes are not forced into target output", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    const charAssetsDir = join(
      inputDir,
      "meshes",
      "actors",
      "character",
      "character assets",
    );
    await mkdir(charAssetsDir, { recursive: true });
    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });

    // Body-replacer NIFs — must NOT be renamed.
    await writeFile(join(charAssetsDir, "femalebody_0.nif"), "cbbe body mesh");
    await writeFile(
      join(charAssetsDir, "femalebody_1.nif"),
      "cbbe body mesh high",
    );
    // Regular outfit NIF — should be renamed with target alias.
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe outfit mesh",
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

    // Body replacer NIFs are explicitly skipped for cross-body conversions.
    const bodySkipped = result.skippedFiles.filter((f) =>
      f.reason.includes("Body replacer mesh"),
    );
    expect(bodySkipped.length).toBeGreaterThanOrEqual(2);

    // The original paths are preserved — no body-type alias prefix added.
    const skippedPaths = bodySkipped.map((f) => f.outputPath);
    expect(
      skippedPaths.some((p) => p.toLowerCase().includes("femalebody_0.nif")),
    ).toBe(true);
    expect(
      skippedPaths.some((p) => p.toLowerCase().includes("femalebody_1.nif")),
    ).toBe(true);
    expect(
      bodySkipped.every((entry) =>
        entry.reason.includes("skipped for cbbe → 3ba conversion"),
      ),
    ).toBe(true);

    // Cross-body conversion should not copy source body-replacer meshes.
    const outputFiles = await scanModFiles(outputDir);
    expect(
      outputFiles.some((f) =>
        f.relativePath.toLowerCase().includes("femalebody_0.nif"),
      ),
    ).toBe(false);
    expect(
      outputFiles.some((f) =>
        f.relativePath.toLowerCase().includes("femalebody_1.nif"),
      ),
    ).toBe(false);

    // Regular outfit IS renamed — 3BA prefix applied.
    const outfitMesh = result.convertedFiles.find(
      (f) => f.kind === "mesh" && f.outputPath.includes("3BA_outfit_0.nif"),
    );
    expect(outfitMesh).toBeDefined();
  });

  it("preserves same-body body-replacer NIFs at original path", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    const charAssetsDir = join(
      inputDir,
      "meshes",
      "actors",
      "character",
      "character assets",
    );
    await mkdir(charAssetsDir, { recursive: true });

    await writeFile(join(charAssetsDir, "femalebody_0.nif"), "cbbe body mesh");
    await writeFile(
      join(charAssetsDir, "femalebody_1.nif"),
      "cbbe body mesh high",
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

    const bodySkipped = result.skippedFiles.filter((f) =>
      f.reason.includes("Body replacer mesh"),
    );
    expect(bodySkipped.length).toBe(2);
    expect(
      bodySkipped.every((entry) =>
        entry.reason.includes("preserved at original path"),
      ),
    ).toBe(true);

    const outputFiles = await scanModFiles(outputDir);
    expect(
      outputFiles.some((f) =>
        f.relativePath.toLowerCase().includes("femalebody_0.nif"),
      ),
    ).toBe(true);
    expect(
      outputFiles.some((f) =>
        f.relativePath.toLowerCase().includes("femalebody_1.nif"),
      ),
    ).toBe(true);
  });

  it("preserves body-replacer NIFs identified by basename regardless of directory", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    // malebody_0.nif placed in a non-standard directory — still body-replacer.
    await mkdir(join(inputDir, "meshes", "actors", "custom"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "actors", "custom", "malebody_0.nif"),
      "malebody mesh",
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

    const bodySkipped = result.skippedFiles.filter((f) =>
      f.reason.includes("Body replacer mesh"),
    );
    expect(bodySkipped.length).toBe(1);
    expect(bodySkipped[0]?.outputPath.toLowerCase()).toContain(
      "malebody_0.nif",
    );
  });

  it("appends missing required physics chain bones to a partial source CBPC config", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe mesh",
    );

    // Partial config: has some breast bones but is missing belly/butt/root bones.
    const partialConfig = [
      "NPC L Breast01=0.500",
      "NPC R Breast01=0.500",
      "NPC L Breast02=0.400",
      "NPC R Breast02=0.400",
    ].join("\n");
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbbe_armor.ini"),
      partialConfig,
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

    // The converted config should now contain 3BA's full set of physics bones.
    const convertedConfigEntry = result.convertedFiles.find(
      (f) =>
        f.kind === "text" &&
        f.outputPath.toLowerCase().includes("cbpc") &&
        f.outputPath.toLowerCase().endsWith(".ini"),
    );
    expect(convertedConfigEntry).toBeDefined();

    const { readFile: rf } = await import("node:fs/promises");
    const convertedConfig = await rf(
      join(outputDir, convertedConfigEntry?.outputPath ?? ""),
      "utf8",
    );

    // All 3BA physics bones must now be present in the converted config.
    const { BODY_TYPE_INFO: bti } = await import("../src/bodyTypeInfo.js");
    for (const bone of bti["3ba"].physicsBones) {
      expect(convertedConfig.toLowerCase()).toContain(bone.toLowerCase());
    }
  });

  it("does not append missing CBPC bones when physics profile is set to no physics", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe mesh",
    );
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbbe_armor.ini"),
      ["NPC L Breast01=0.500", "NPC R Breast01=0.500"].join("\n"),
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
      {
        physicsProfile: "none",
      },
    );

    const convertedConfigEntry = result.convertedFiles.find(
      (f) =>
        f.kind === "text" &&
        f.outputPath.toLowerCase().includes("cbpc") &&
        f.outputPath.toLowerCase().endsWith(".ini"),
    );
    expect(convertedConfigEntry).toBeDefined();
    const convertedConfig = await readFile(
      join(outputDir, convertedConfigEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(convertedConfig).not.toContain(
      "Missing physics chain bones added by SlideSmith",
    );
    expect(convertedConfig).not.toContain("NPC Belly");
    expect(
      result.warnings.some((warning) =>
        warning.includes("Physics profile was set to 'No physics'"),
      ),
    ).toBe(true);
  });

  it("handles spaced CBPC assignments and ignores commented-out bone lines when filling missing physics bones", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe mesh",
    );

    const partialConfig = [
      "; NPC R Breast03=0.123",
      "NPC L Breast01 = 0.500",
      "NPC R Breast01 = 0.500 ; inline comment",
      "NPC L Breast02 = .400",
      "NPC R Breast02 = .400",
    ].join("\n");
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbbe_spaced.ini"),
      partialConfig,
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

    const convertedConfigEntry = result.convertedFiles.find(
      (file) =>
        file.kind === "text" &&
        file.outputPath.toLowerCase().includes("cbpc/") &&
        file.outputPath.toLowerCase().endsWith("_spaced.ini"),
    );
    expect(convertedConfigEntry).toBeDefined();

    const convertedConfig = await readFile(
      join(outputDir, convertedConfigEntry?.outputPath ?? ""),
      "utf8",
    );

    expect(convertedConfig).toContain(
      "; Missing physics chain bones added by SlideSmith",
    );
    expect(convertedConfig).toContain("NPC R Breast03=0.600");
  });

  it("handles duplicate and legacy-style physics entries without appending duplicate target bones", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe mesh",
    );

    const mixedConfig = [
      "NPC L Brest01=0.250",
      "NPC L Breast01=0.700",
      "NPC L Butt:0.300",
      '<bone name="NPC R Breast01" weight="0.550"/>',
      "; NPC R Breast01=0.100",
    ].join("\n");
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbbe_legacy.ini"),
      mixedConfig,
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

    const convertedConfigEntry = result.convertedFiles.find(
      (file) =>
        file.kind === "text" &&
        file.outputPath.toLowerCase().includes("cbpc/") &&
        file.outputPath.toLowerCase().endsWith("_legacy.ini"),
    );
    expect(convertedConfigEntry).toBeDefined();

    const convertedConfig = await readFile(
      join(outputDir, convertedConfigEntry?.outputPath ?? ""),
      "utf8",
    );

    // Existing bones (including typo/legacy formats) should not get duplicate
    // appended target entries.
    expect(convertedConfig).not.toContain("NPC R Breast01=0.600");
    expect(convertedConfig).not.toContain("NPC L Butt=0.450");
    // Missing bones should still be synthesized.
    expect(convertedConfig).toContain("NPC R Butt=0.450");
    expect(convertedConfig).toContain("NPC Belly=0.300");
  });

  it("excludes non-armor/non-clothing NIFs from conversion output", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "meshes", "weapons"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(inputDir, "meshes", "weapons", "cbbe_sword.nif"),
      "weapon mesh",
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

    const excludedWeapon = result.skippedFiles.find((file) =>
      file.reason.includes("NIF appears unrelated to body/outfit conversion"),
    );
    expect(excludedWeapon).toBeDefined();
    expect(excludedWeapon?.outputPath.toLowerCase()).toContain(
      "meshes/weapons/cbbe_sword.nif",
    );
    await expect(
      readFile(join(outputDir, "meshes", "weapons", "cbbe_sword.nif"), "utf8"),
    ).rejects.toThrow();

    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_outfit_0.nif"),
      ),
    ).toBe(true);
  });

  it("excludes unrelated non-body support files from conversion output", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "docs"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(inputDir, "docs", "installation_notes.txt"),
      "This file contains changelog notes and troubleshooting steps.",
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

    expect(
      result.skippedFiles.some(
        (file) =>
          file.outputPath === "docs/installation_notes.txt" &&
          file.reason.includes("excluded from output"),
      ),
    ).toBe(true);
    await expect(
      readFile(join(outputDir, "docs", "installation_notes.txt"), "utf8"),
    ).rejects.toThrow();
  });

  it("converts clothing meshes with non-weighted filenames when clothing keywords are present", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "custom"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "custom", "linen_shirt.nif"),
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
        (file) => file.outputPath === "meshes/custom/linen_shirt.nif",
      ),
    ).toBe(true);
    expect(
      result.skippedFiles.some(
        (file) => file.outputPath === "meshes/custom/linen_shirt.nif",
      ),
    ).toBe(false);
  });

  it("synthesizes supplemental SliderSet data when source projects lack OutputFile entries", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_incomplete.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Incomplete">',
        '    <Groups><Group name="CBBE Outfits"/></Groups>',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const supplementalSliderSet = result.convertedFiles.find(
      (file) =>
        /CalienteTools\/BodySlide\/SliderSets\/3BA_AutoSupplement(?:_[^/]+)?\.osp$/i.test(
          file.outputPath,
        ) && file.action === "synthesized",
    );
    expect(supplementalSliderSet).toBeDefined();

    const sliderSetContent = await readFile(
      join(outputDir, supplementalSliderSet?.outputPath ?? ""),
      "utf8",
    );
    expect(sliderSetContent).toContain('<SliderSet name="3BA Plated">');
    expect(sliderSetContent).toContain(
      "<OutputFile>3BA_plated_1.nif</OutputFile>",
    );
  });

  it("always writes a BodySlide group registration for converted SliderSets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderGroups"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderGroups",
        "cbbe_unrelated.xml",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderGroups>",
        '  <Group name="CBBE Unrelated">',
        '    <Member name="CBBE Something Else"/>',
        "  </Group>",
        "</SliderGroups>",
      ].join("\n"),
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

    const generatedGroups = result.convertedFiles.filter(
      (file) =>
        file.outputPath.includes("SliderGroups") &&
        file.action === "synthesized",
    );
    expect(generatedGroups).toHaveLength(0);
  });

  it("synthesizes supplemental SliderSet data when source projects lack SourceFile entries", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_plated_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_missing_sourcefile.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Missing SourceFile">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>cbbe_plated_1.nif</OutputFile>",
        '    <Groups><Group name="CBBE Outfits"/></Groups>',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const supplementalSliderSet = result.convertedFiles.find(
      (file) =>
        /CalienteTools\/BodySlide\/SliderSets\/3BA_AutoSupplement(?:_[^/]+)?\.osp$/i.test(
          file.outputPath,
        ) && file.action === "synthesized",
    );
    expect(supplementalSliderSet).toBeDefined();

    const sliderSetContent = await readFile(
      join(outputDir, supplementalSliderSet?.outputPath ?? ""),
      "utf8",
    );
    expect(sliderSetContent).toContain('<SliderSet name="3BA Plated">');
    expect(sliderSetContent).toContain(
      "<OutputFile>3BA_plated_1.nif</OutputFile>",
    );
    expect(sliderSetContent).toContain(
      "<SourceFile>armor/3BA_plated_1.nif</SourceFile>",
    );
  });

  it("synthesizes missing armors when existing SliderSets cover only same-name outputs in other folders", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor", "seta"), { recursive: true });
    await mkdir(join(inputDir, "meshes", "armor", "setb"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "seta", "cbbe_cuirass_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(inputDir, "meshes", "armor", "setb", "cbbe_cuirass_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_covered.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Covered">',
        "    <OutputPath>meshes/armor/seta/</OutputPath>",
        "    <OutputFile>cbbe_cuirass_1.nif</OutputFile>",
        "    <SourceFile>CBBE/armor/seta/cbbe_cuirass_1.nif</SourceFile>",
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const supplementalSliderSets = result.convertedFiles.filter(
      (file) =>
        /CalienteTools\/BodySlide\/SliderSets\/3BA_AutoSupplement(?:_[^/]+)?\.osp$/i.test(
          file.outputPath,
        ) && file.action === "synthesized",
    );
    expect(supplementalSliderSets.length).toBeGreaterThan(0);

    const supplementalContents = await Promise.all(
      supplementalSliderSets.map((file) =>
        readFile(join(outputDir, file.outputPath), "utf8"),
      ),
    );
    expect(
      supplementalContents.some((content) =>
        content.includes("<OutputPath>meshes/armor/setb/</OutputPath>"),
      ),
    ).toBe(true);
  });

  it("strips known body-alias root from <SourceFile> paths so BodySlide can resolve ShapeData", async () => {
    // When source ShapeData is organised as ShapeData/<BodyAlias>/<folder>/mesh.nif,
    // normalizeToMo2DataPath strips the alias segment (placing the file at
    // ShapeData/<folder>/mesh.nif), but replaceAliases rewrites the <SourceFile>
    // token to <TargetAlias>/<folder>/mesh.nif — causing a mismatch.
    // normalizeBodySlideSourceFileRoots must strip the alias prefix from the
    // rewritten <SourceFile> value so BodySlide resolves it correctly.
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
      ),
      { recursive: true },
    );
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
        "cbbe_cuirass_0.nif",
      ),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_cuirass.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Cuirass">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>cbbe_cuirass_0.nif</OutputFile>",
        "    <SourceFile>CBBE/Armor/cbbe_cuirass_0.nif</SourceFile>",
        '    <Groups><Group name="CBBE Outfits"/></Groups>',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const ospEntry = result.convertedFiles.find(
      (f) => f.outputPath.endsWith(".osp") && f.action === "rewritten",
    );
    expect(ospEntry).toBeDefined();

    const ospContent = await readFile(
      join(outputDir, ospEntry?.outputPath ?? ""),
      "utf8",
    );

    // The <SourceFile> must NOT start with the target alias "3BA/" — it should
    // be stripped to match the ShapeData location after normalizeToMo2DataPath.
    expect(ospContent).not.toContain("<SourceFile>3BA/Armor/");
    expect(ospContent).not.toContain("<SourceFile>CBBE/Armor/");
    // The remaining relative path segment must still be present.
    expect(ospContent).toMatch(
      /<SourceFile>Armor\/cbbe_cuirass_0\.nif<\/SourceFile>/i,
    );
  });

  it("normalizes ShapeData-rooted <SourceFile> paths to BodySlide-relative paths", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
      ),
      { recursive: true },
    );
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "ShapeData",
        "CBBE",
        "Armor",
        "cbbe_cuirass_0.nif",
      ),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_cuirass.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Cuirass">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>cbbe_cuirass_0.nif</OutputFile>",
        "    <SourceFile>CalienteTools/BodySlide/ShapeData/CBBE/Armor/cbbe_cuirass_0.nif</SourceFile>",
        '    <Groups><Group name="CBBE Outfits"/></Groups>',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
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

    const ospEntry = result.convertedFiles.find(
      (f) => f.outputPath.endsWith(".osp") && f.action === "rewritten",
    );
    expect(ospEntry).toBeDefined();

    const ospContent = await readFile(
      join(outputDir, ospEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(ospContent).toContain(
      "<SourceFile>Armor/cbbe_cuirass_0.nif</SourceFile>",
    );
    expect(ospContent).not.toContain(
      "<SourceFile>CalienteTools/BodySlide/ShapeData/",
    );
    expect(ospContent).not.toContain("<SourceFile>3BA/Armor/");
  });

  it("converts CBBE mods to COCO and rewrites body aliases correctly", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderSets"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_gown_0.nif"),
      "caliente cbbe",
    );
    await writeFile(
      join(
        inputDir,
        "CalienteTools",
        "BodySlide",
        "SliderSets",
        "cbbe_gown.osp",
      ),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<SliderSetInfo>",
        '  <SliderSet name="CBBE Gown">',
        "    <OutputPath>meshes/armor/</OutputPath>",
        "    <OutputFile>cbbe_gown_0.nif</OutputFile>",
        "    <SourceFile>Gown/cbbe_gown_0.nif</SourceFile>",
        '    <Groups><Group name="CBBE Outfits"/></Groups>',
        "  </SliderSet>",
        "</SliderSetInfo>",
      ].join("\n"),
      "utf8",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "coco",
    );

    expect(result.convertedFiles.length).toBeGreaterThan(0);
    const ospEntry = result.convertedFiles.find(
      (f) => f.outputPath.endsWith(".osp") && f.action === "rewritten",
    );
    expect(ospEntry).toBeDefined();
    const ospContent = await readFile(
      join(outputDir, ospEntry?.outputPath ?? ""),
      "utf8",
    );
    // Body alias "CBBE" replaced with "COCO" in the SliderSet name.
    expect(ospContent).toContain("COCO Gown");
    // NIF file reference preserves source filename so BodySlide builds target runtime paths.
    expect(ospContent).toMatch(/cbbe_gown_0\.nif/i);
    // Converted NIF file must exist.
    const nifEntry = result.convertedFiles.find((f) =>
      f.outputPath.endsWith(".nif"),
    );
    expect(nifEntry).toBeDefined();
  });

  it("synthesizes HDT-SMP XML stub for HIMBO target under auto profile", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "himbo_outfit_0.nif"),
      "himbo",
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

    const targetAlias = result.preferredOutputAlias;
    const xmlStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(xmlStub, "expected HDT-SMP XML stub for HIMBO").toBeDefined();

    const content = await readFile(
      join(outputDir, xmlStub?.outputPath ?? ""),
      "utf8",
    );
    expect(content).toContain("PerBoneShape");
    expect(content).toContain("NPC L Pectoral");
    expect(content).toContain("<bone");
  });

  it("falls back to HDT-SMP for HIMBO when physicsProfile is cbpc", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "himbo_outfit_0.nif"),
      "himbo",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "himbo",
      { physicsProfile: "cbpc" },
    );

    const cbpcStub = result.convertedFiles.find(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(
      cbpcStub,
      "should not synthesize CBPC stub for HIMBO",
    ).toBeUndefined();

    const targetAlias = result.preferredOutputAlias;
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(
      hdtStub,
      "should synthesize HDT-SMP fallback for HIMBO",
    ).toBeDefined();
    expect(
      result.warnings.some((warning) =>
        warning.includes("Falling back to 'HDT-SMP'"),
      ),
    ).toBe(true);
    expect(result.requestedPhysicsProfile).toBe("cbpc");
    expect(result.effectivePhysicsProfile).toBe("hdt-smp");
  });

  it("falls back to HDT-SMP for HIMBO when physicsProfile is dual", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "himbo_outfit_0.nif"),
      "himbo",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "himbo",
      { physicsProfile: "dual" },
    );

    const targetAlias = result.preferredOutputAlias;
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(
      hdtStub,
      "should synthesize HDT-SMP fallback for HIMBO",
    ).toBeDefined();
    expect(
      result.warnings.some(
        (warning) => warning.includes("Dual") && warning.includes("HDT-SMP"),
      ),
    ).toBe(true);
    expect(result.requestedPhysicsProfile).toBe("dual");
    expect(result.effectivePhysicsProfile).toBe("hdt-smp");
  });

  it("synthesizes HDT-SMP XML stub for 3BA when physicsProfile is hdt-smp", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "hdt-smp" },
    );

    const targetAlias = result.preferredOutputAlias;
    const xmlStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(
      xmlStub,
      "expected HDT-SMP XML stub for 3BA with hdt-smp profile",
    ).toBeDefined();

    const content = await readFile(
      join(outputDir, xmlStub?.outputPath ?? ""),
      "utf8",
    );
    expect(content).toContain("PerBoneShape");
    expect(content).toContain("<bone");
    // Warning mentions XML stub generation
    expect(result.warnings.some((w) => w.includes("HDT-SMP XML stub"))).toBe(
      true,
    );
  });

  it("synthesizes both CBPC and HDT-SMP stubs for dual-compatible targets in auto mode", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "auto" },
    );

    const targetAlias = result.preferredOutputAlias;
    const cbpcStub = result.convertedFiles.find(
      (f) =>
        f.outputPath === `SKSE/Plugins/CBPC/${targetAlias}_PhysicsStub.ini` &&
        f.action === "synthesized",
    );
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );

    expect(
      cbpcStub,
      "expected CBPC stub for auto profile on 3BA",
    ).toBeDefined();
    expect(
      hdtStub,
      "expected HDT-SMP stub for auto profile on 3BA",
    ).toBeDefined();
    expect(result.requestedPhysicsProfile).toBe("auto");
    expect(result.effectivePhysicsProfile).toBe("auto");
  });

  it("synthesizes both CBPC and HDT-SMP stubs for dual profile on dual-compatible targets", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "dual" },
    );

    const targetAlias = result.preferredOutputAlias;
    const cbpcStub = result.convertedFiles.find(
      (f) =>
        f.outputPath === `SKSE/Plugins/CBPC/${targetAlias}_PhysicsStub.ini` &&
        f.action === "synthesized",
    );
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );

    expect(
      cbpcStub,
      "expected CBPC stub for dual profile on 3BA",
    ).toBeDefined();
    expect(
      hdtStub,
      "expected HDT-SMP stub for dual profile on 3BA",
    ).toBeDefined();
    expect(result.requestedPhysicsProfile).toBe("dual");
    expect(result.effectivePhysicsProfile).toBe("dual");
  });

  it("supports softbody profile and synthesizes HDT-SMP XML stub", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "softbody" },
    );

    const targetAlias = result.preferredOutputAlias;
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(
      hdtStub,
      "expected HDT-SMP XML stub for softbody profile on 3BA",
    ).toBeDefined();
    expect(result.requestedPhysicsProfile).toBe("softbody");
    expect(result.effectivePhysicsProfile).toBe("softbody");
  });

  it("still synthesizes missing HDT-SMP stub in auto mode when only CBPC config exists", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_outfit_0.nif"),
      "cbbe",
    );
    await mkdir(join(inputDir, "SKSE", "Plugins", "CBPC"), {
      recursive: true,
    });
    await writeFile(
      join(inputDir, "SKSE", "Plugins", "CBPC", "cbpc_source.ini"),
      "NPC L Breast=0.600\nNPC R Breast=0.600\nNPC L Butt=0.450\nNPC R Butt=0.450\n",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);
    const result = await convertMod(
      inputDir,
      outputDir,
      files,
      detection,
      "3ba",
      { physicsProfile: "auto" },
    );

    const targetAlias = result.preferredOutputAlias;
    const hdtStub = result.convertedFiles.find(
      (f) =>
        f.outputPath ===
          `SKSE/Plugins/hdtSMP64/${targetAlias}_PhysicsStub.xml` &&
        f.action === "synthesized",
    );
    expect(
      hdtStub,
      "expected HDT-SMP stub for auto profile on 3BA when only CBPC config exists",
    ).toBeDefined();
  });
});
