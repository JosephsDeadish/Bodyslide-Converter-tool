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
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3ba_armor.xml"),
      ),
    ).toBe(true);
    expect(
      result.convertedFiles.some((file) =>
        file.outputPath.endsWith("3ba_cuirass_1.nif"),
      ),
    ).toBe(true);

    const rewritten = await readFile(
      join(outputDir, "bodyslide", "slidersets", "3ba_armor.xml"),
      "utf8",
    );
    expect(rewritten).toContain("3ba");
  });

  it("rejects unsupported native conversion paths", async () => {
    const inputDir = await makeTempDir();
    const outputDir = await makeTempDir();

    await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
    await writeFile(
      join(inputDir, "meshes", "armor", "cbbe_cuirass_1.nif"),
      "caliente",
    );

    const files = await scanModFiles(inputDir);
    const detection = detectBodyType(files);

    await expect(
      convertMod(inputDir, outputDir, files, detection, "himbo"),
    ).rejects.toThrow("is not implemented yet");
  });
});
