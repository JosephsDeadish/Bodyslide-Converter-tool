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
        file.outputPath.endsWith("character assets/malebody_0.nif"),
      ),
    ).toBe(true);
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
    // Must NOT be in SliderGroups
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes("SliderGroups"),
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
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.includes("SliderGroups"),
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
        "NPC L Breast01=0.7",
        "NPC L Breast02=0.6",
        "NPC L Breast03=0.5",
        "NPC RBreastRoot=1",
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
        warning.includes("No direct physics-bone map exists"),
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
});
