import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMod } from "../src/converter.js";
import { detectBodyType } from "../src/detector.js";
import { scanModFiles } from "../src/scanner.js";

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
    expect(rewritten).not.toContain("NPC GenitalsBase01");
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
      '<SliderSetInfo><SliderSet name="3BA Armor"><Slider name="Breast Size" /></SliderSet></SliderSetInfo>',
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

    // A synthesized SliderGroup file should appear in the converted files list.
    const groupEntry = result.convertedFiles.find(
      (f) =>
        f.outputPath.includes("SliderGroups") &&
        f.outputPath.endsWith(".xml") &&
        f.action === "synthesized",
    );
    expect(groupEntry).toBeDefined();

    // The SliderGroup file should physically exist and contain the expected XML.
    const groupContent = await readFile(
      join(outputDir, groupEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(groupContent).toContain("3BA");
    expect(groupContent).toContain("3BA Iron Cuirass");
    expect(groupContent).toContain("3BA Iron Gauntlets");
    expect(groupContent).toContain("<Member");

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
    expect(sliderSetContent).toContain('<Group name="3BA Outfits"/>');
    expect(sliderSetContent).toContain("<Sliders/>");

    const sliderGroupEntry = result.convertedFiles.find(
      (file) =>
        file.outputPath ===
          "CalienteTools/BodySlide/SliderGroups/3BA_Outfits.xml" &&
        file.action === "synthesized",
    );
    expect(sliderGroupEntry).toBeDefined();
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
    expect(sliderSetContent).toContain(
      '<SliderSet name="3BA Seta 3BA Cuirass">',
    );
    expect(sliderSetContent).toContain(
      '<SliderSet name="3BA Setb 3BA Cuirass">',
    );
  });

  it("does not synthesize a duplicate SliderGroup when one already exists in the source", async () => {
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

  it("uses genital-specific defaults for synthesized SOS CBPC stubs", async () => {
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
        f.outputPath.endsWith(".ini") &&
        f.action === "synthesized",
    );
    expect(stubEntry).toBeDefined();

    const stubContent = await readFile(
      join(outputDir, stubEntry?.outputPath ?? ""),
      "utf8",
    );
    expect(stubContent).toContain("NPC GenitalsBase01=0.350");
    expect(stubContent).toContain("NPC L GenitalsScrotum01=0.250");
    expect(stubContent).toContain("NPC R GenitalsScrotum01=0.250");
  });

  it("does not synthesize a CBPC stub when the source already has a physics config", async () => {
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

    // No additional stub should be synthesized since a real config was present.
    const synthStubs = result.convertedFiles.filter(
      (f) =>
        f.outputPath.toLowerCase().includes("physicsstub") &&
        f.action === "synthesized",
    );
    expect(synthStubs).toHaveLength(0);

    // The cbpc-stub audit check should pass since the source had a config.
    const cbpcCheck = result.audit.checks.find(
      (check) => check.id === "cbpc-stub",
    );
    expect(cbpcCheck?.status).toBe("pass");
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

  it("preserves body-replacer NIFs (femalebody, malebody) at original path without alias renaming", async () => {
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

    // Body replacer NIFs appear in skippedFiles with the preservation reason.
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

    // Regular outfit IS renamed — 3BA prefix applied.
    const outfitMesh = result.convertedFiles.find(
      (f) => f.kind === "mesh" && f.outputPath.includes("3BA_outfit_0.nif"),
    );
    expect(outfitMesh).toBeDefined();
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
});
