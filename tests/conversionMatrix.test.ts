import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBodyTypeOptions } from "../src/bodyTypes.js";
import { BODY_TYPE_INFO } from "../src/bodyTypeInfo.js";
import { convertMod } from "../src/converter.js";
import { scanModFiles } from "../src/scanner.js";
import { BODY_TYPES, type BodyType, type DetectionResult } from "../src/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slidesmith-matrix-"));
  tempDirs.push(dir);
  return dir;
}

function makeDetection(bodyType: BodyType): DetectionResult {
  const scores = Object.fromEntries(BODY_TYPES.map((type) => [type, 0])) as Record<
    BodyType,
    number
  >;
  scores[bodyType] = 1;

  return {
    bodyType,
    confidence: 1,
    scores,
    packaging: {
      fomod: false,
      mo2: false,
      vortex: false,
    },
    rankedCandidates: [
      {
        bodyType,
        score: 1,
        share: 1,
      },
    ],
    matchedSignals: [bodyType],
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("conversion matrix coverage", () => {
  it("returns output options for every supported body type", () => {
    const options = listBodyTypeOptions();

    expect(options.map((option) => option.value)).toEqual(BODY_TYPES);
    expect(new Set(options.map((option) => option.value)).size).toBe(
      BODY_TYPES.length,
    );

    for (const option of options) {
      expect(option.label).toBe(BODY_TYPE_INFO[option.value].displayName);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("converts every source body type to every target body type", async () => {
    const convertedPairs: string[] = [];

    for (const source of BODY_TYPES) {
      const inputDir = await makeTempDir();
      await mkdir(join(inputDir, "meshes", "armor"), { recursive: true });
      await mkdir(join(inputDir, "CalienteTools", "BodySlide", "SliderGroups"), {
        recursive: true,
      });

      await writeFile(
        join(inputDir, "meshes", "armor", `${source}_outfit_0.nif`),
        `${source} mesh`,
        "utf8",
      );
      await writeFile(
        join(
          inputDir,
          "CalienteTools",
          "BodySlide",
          "SliderGroups",
          `${source}_armor.xml`,
        ),
        `<SliderGroups><Group name="${source} Armor">${source} preset</Group></SliderGroups>`,
        "utf8",
      );

      const files = await scanModFiles(inputDir);
      const detection = makeDetection(source);

      for (const target of BODY_TYPES) {
        const outputDir = await makeTempDir();
        const result = await convertMod(inputDir, outputDir, files, detection, target);
        const targetAlias = result.preferredOutputAlias;

        convertedPairs.push(`${source}->${target}`);
        expect(result.sourceBodyType).toBe(source);
        expect(result.targetBodyType).toBe(target);
        expect(result.convertedFiles.length).toBeGreaterThan(0);
        expect(targetAlias.length).toBeGreaterThan(0);
        expect(
          result.convertedFiles.some((file) => file.outputPath.includes(targetAlias)),
        ).toBe(true);

        const rewrittenXmlPath = join(
          outputDir,
          "CalienteTools",
          "BodySlide",
          "SliderGroups",
          `${targetAlias}_armor.xml`,
        );
        const rewrittenXml = await readFile(rewrittenXmlPath, "utf8");
        expect(rewrittenXml).toContain(targetAlias);
      }
    }

    expect(convertedPairs).toHaveLength(BODY_TYPES.length * BODY_TYPES.length);
  });
});
