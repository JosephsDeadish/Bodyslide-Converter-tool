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

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });

    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_1.nif"),
      "caliente",
    );
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "cbbe_armor.xml"),
      '<set name="CBBE Armor">cbbe curvy</set>',
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
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_armor.xml"),
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3BA_cuirass_1.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "bodyslide", "slidersets", "3BA_armor.xml"),
      "utf8",
    );
    expect(rewritten).toContain("3BA");
  });

  it("remaps known physics bone references in text configs", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

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
    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });

    await writeFile(
      join(inputDir, "meshes", "armor", "bhunp_boots_0.nif"),
      "bhunp body",
    );
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "bhunp_armor.xml"),
      '<set name="BHUNP Armor">bhunp preset</set>',
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
      join(outputDir, "bodyslide", "slidersets", "UUNP_armor.xml"),
      "utf8",
    );
    expect(rewritten).toContain("UUNP");
  });

  it("supports compatible CBBE-family metadata rewrites", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "tbd_fitted.xml"),
      '<set name="TBD Armor">touched by dibella</set>',
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
      join(outputDir, "bodyslide", "slidersets", "CBBE_fitted.xml"),
      "utf8",
    );
    expect(rewritten).toContain("CBBE");
  });

  it("supports compatible male-body metadata rewrites", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "HIMBO_armor.xml"),
      '<set name="HIMBO Armor">highpolymalebody</set>',
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
      join(outputDir, "bodyslide", "slidersets", "SAM_armor.xml"),
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
      '<set name="CBBE Female Outfit">femalehands cbbe curvy</set>',
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
      join(outputDir, "bodyslide", "slidersets", "HIMBO_male_outfit.xml"),
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

    await mkdir(join(inputDir, "bodyslide", "slidersets"), { recursive: true });
    await writeFile(
      join(inputDir, "bodyslide", "slidersets", "sam_armor.xml"),
      '<set name="SAM Armor">shape atlas for men</set>',
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
      join(outputDir, "bodyslide", "slidersets", "BodyTalk_armor.xml"),
      "utf8",
    );
    expect(rewritten).toContain("BodyTalk");
  });
});
