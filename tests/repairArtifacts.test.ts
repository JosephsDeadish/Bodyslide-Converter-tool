import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRepairArtifacts } from "../src/repairArtifacts.js";
import type { PythonEngineRunSummary } from "../src/types.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slidesmith-repair-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

function makeSummary(
  stages: PythonEngineRunSummary["stages"],
  options: Partial<
    Pick<PythonEngineRunSummary, "qualityGates" | "warnings">
  > = {},
): PythonEngineRunSummary {
  return {
    runId: "repair-run",
    backend: "python",
    stages,
    qualityGates: options.qualityGates ?? [],
    warnings: options.warnings ?? [],
    libraries: {
      pyffi: true,
      numpy: true,
      scipy: true,
      trimesh: true,
      pyvista: true,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("repair artifact generation", () => {
  it("skips artifact generation when no repair signals are present", async () => {
    const reportsDir = await makeTempDir();
    const { artifacts } = await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "3ba",
      pythonSummary: makeSummary([
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "pass",
          summary: "Reference mapping resolved.",
          details: [],
        },
      ]),
    });

    expect(artifacts).toEqual([]);
    await expect(access(join(reportsDir, "repairs"))).rejects.toBeDefined();
  });

  it("generates missing-NIF repair templates when no NIF mesh warnings are present", async () => {
    const reportsDir = await makeTempDir();
    const { artifacts } = await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "3ba",
      pythonSummary: makeSummary([
        {
          id: "corrective-smoothing",
          title: "Corrective smoothing",
          status: "attention",
          summary:
            "Corrective smoothing skipped because no NIF mesh was found.",
          details: [
            "Armpit, breast/chest, crotch, elbow, and knee zones could not be evaluated.",
          ],
        },
      ]),
    });

    expect(artifacts.map((artifact) => artifact.relativePath)).toContain(
      "_SlideSmith/repairs/missing-nif-mesh-template.txt",
    );

    const manifest = JSON.parse(
      await readFile(
        join(reportsDir, "repairs", "repair-manifest.json"),
        "utf8",
      ),
    ) as { issues: Array<{ id: string }> };
    expect(
      manifest.issues.some((issue) => issue.id === "missing-nif-mesh"),
    ).toBe(true);
  });

  it("generates body metadata patch template for incomplete metadata warnings", async () => {
    const reportsDir = await makeTempDir();
    await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "uunp",
      pythonSummary: makeSummary([
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "attention",
          summary: "Reference body metadata is incomplete for this pair.",
          details: [
            "Populate topology, topologyReference, canonicalVertexMap, sliderMappings, boneMap, and morphEquivalents for both source and target bodies.",
          ],
        },
      ]),
    });

    const patch = JSON.parse(
      await readFile(
        join(reportsDir, "repairs", "body-reference-db.patch.json"),
        "utf8",
      ),
    ) as {
      bodies: Record<string, unknown>;
      adapters: Array<{ source: string; target: string }>;
    };
    expect(Object.keys(patch.bodies)).toEqual(["cbbe", "uunp"]);
    expect(
      (
        patch.bodies.cbbe as {
          physicsConfig?: { boneNamingConvention?: string };
          correctiveSmoothingZones?: string[];
        }
      ).physicsConfig?.boneNamingConvention,
    ).toBe("TODO-bone-naming-convention");
    expect(
      (patch.bodies.uunp as { correctiveSmoothingZones?: string[] })
        .correctiveSmoothingZones,
    ).toContain("breast-left");
    expect(patch.adapters).toContainEqual({
      source: "cbbe",
      target: "uunp",
      profile: "TODO-adapter-profile-name",
    });
  });

  it("generates targeted repair templates for adapter, smoothing, morph, and physics gaps", async () => {
    const reportsDir = await makeTempDir();
    const { artifacts } = await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "bhunp",
      pythonSummary: makeSummary([
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "attention",
          summary:
            "Reference metadata is present, but this high-risk pair has no explicit adapter profile.",
          details: [
            "Missing explicit adapter profile for high-risk conversion pair cbbe -> bhunp.",
          ],
        },
        {
          id: "corrective-smoothing",
          title: "Corrective smoothing",
          status: "attention",
          summary:
            "Corrective smoothing zone definitions are missing from body metadata.",
          details: [
            "Populate correctiveSmoothingZones in body_reference_db.json for both source and target bodies.",
          ],
        },
        {
          id: "morph-transfer",
          title: "Delta morph transfer",
          status: "attention",
          summary: "Morph-transfer prerequisites are incomplete.",
          details: [
            "Populate overlapping canonical morphEquivalents for both bodies.",
            "Populate overlapping canonical sliderMappings for both bodies.",
          ],
        },
        {
          id: "physics-preservation",
          title: "Physics and partitions",
          status: "attention",
          summary:
            "Physics metadata is present but target boneMap coverage is incomplete.",
          details: [
            "Missing physics entries in target boneMap: BHUNP Breast L01",
            "Bone naming convention mismatch (cbbe-3ba → bhunp): physics config files (CBPC ini / HDT-SMP XML) must be regenerated for the target body.",
          ],
        },
      ]),
    });

    expect(artifacts.map((artifact) => artifact.relativePath)).toEqual(
      expect.arrayContaining([
        "_SlideSmith/repairs/adapter-profile-template.json",
        "_SlideSmith/repairs/corrective-smoothing-template.json",
        "_SlideSmith/repairs/morph-mapping-template.json",
        "_SlideSmith/repairs/physics-metadata-template.json",
      ]),
    );

    const adapterTemplate = JSON.parse(
      await readFile(
        join(reportsDir, "repairs", "adapter-profile-template.json"),
        "utf8",
      ),
    ) as {
      adapters: Array<{ source: string; target: string; profile: string }>;
    };
    expect(adapterTemplate.adapters).toContainEqual({
      source: "cbbe",
      target: "bhunp",
      profile: "TODO-adapter-profile-name",
    });

    const morphTemplate = JSON.parse(
      await readFile(
        join(reportsDir, "repairs", "morph-mapping-template.json"),
        "utf8",
      ),
    ) as {
      bodies: Record<
        string,
        {
          sliderMappings?: Record<string, string>;
          morphEquivalents?: Record<string, string>;
        }
      >;
    };
    expect(morphTemplate.bodies.cbbe.sliderMappings?.breast).toBe("Breasts");
    expect(morphTemplate.bodies.bhunp.morphEquivalents?.zapBelly).toBe(
      "BHUNP Zap Belly",
    );

    const physicsTemplate = JSON.parse(
      await readFile(
        join(reportsDir, "repairs", "physics-metadata-template.json"),
        "utf8",
      ),
    ) as {
      bodies: Record<
        string,
        {
          physicsBones?: string[];
          physicsConfig?: { notes?: string };
        }
      >;
    };
    // BHUNP has real physics bones — template should be pre-filled, not TODO.
    expect(physicsTemplate.bodies.bhunp.physicsBones).toContain(
      "BHUNP Breast L01",
    );
    // CBBE has no physics bones — notes come from its skeleton guidance.
    expect(physicsTemplate.bodies.cbbe.physicsConfig?.notes).toContain("CBBE");
  });

  it("detects repair issues from quality gates and warnings when stage summaries are sparse", async () => {
    const reportsDir = await makeTempDir();
    const { artifacts } = await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "bhunp",
      pythonSummary: makeSummary(
        [
          {
            id: "reference-body",
            title: "Reference body mapping",
            status: "pass",
            summary: "Reference mapping resolved.",
            details: [],
          },
        ],
        {
          qualityGates: [
            {
              id: "morph-validity",
              status: "attention",
              summary:
                "Morph validity warning: slider mapping overlap is incomplete.",
            },
            {
              id: "physics-markers",
              status: "attention",
              summary:
                "Physics marker coverage warning: target physics markers are missing.",
            },
          ],
          warnings: [
            "Reference metadata is incomplete in body_reference_db.json for this conversion pair.",
            "Missing explicit adapter entry for cbbe -> bhunp.",
          ],
        },
      ),
    });

    expect(artifacts.map((artifact) => artifact.relativePath)).toEqual(
      expect.arrayContaining([
        "_SlideSmith/repairs/body-reference-db.patch.json",
        "_SlideSmith/repairs/adapter-profile-template.json",
        "_SlideSmith/repairs/morph-mapping-template.json",
        "_SlideSmith/repairs/physics-metadata-template.json",
      ]),
    );
  });

  it("dual-writes repair artifacts to userData/repairs and auto-merges metadata patch into user reference DB with notices", async () => {
    const reportsDir = await makeTempDir();
    const userDataDir = await makeTempDir();
    const userReferenceDbPath = join(userDataDir, "body_reference_db.json");
    const originalUserDb = JSON.stringify(
      {
        schemaVersion: 3,
        bodies: {
          cbbe: { topology: "cbbe" },
        },
        adapters: [],
      },
      null,
      2,
    );
    await writeFile(userReferenceDbPath, `${originalUserDb}\n`, "utf8");

    const { artifacts, dbMergeNotices } = await generateRepairArtifacts({
      reportsDir,
      userDataDir,
      sourceBodyType: "cbbe",
      targetBodyType: "uunp",
      pythonSummary: makeSummary([
        {
          id: "reference-body",
          title: "Reference body mapping",
          status: "attention",
          summary: "Reference body metadata is incomplete for this pair.",
          details: [
            "Populate topology, topologyReference, canonicalVertexMap, sliderMappings, boneMap, and morphEquivalents for both source and target bodies.",
          ],
        },
      ]),
    });

    // All generated artifacts must exist in both the output and userData repairs folders.
    expect(artifacts.map((artifact) => artifact.relativePath)).toContain(
      "_SlideSmith/repairs/repair-manifest.json",
    );
    for (const artifact of artifacts) {
      const fileName = artifact.relativePath.split("/").pop();
      if (!fileName) {
        throw new Error("Generated repair artifact must include a file name.");
      }
      await expect(access(join(reportsDir, "repairs", fileName))).resolves
        .toBeUndefined;
      await expect(access(join(userDataDir, "repairs", fileName))).resolves
        .toBeUndefined;
    }

    // Metadata patch should have been auto-merged into the user reference DB.
    const mergedDb = JSON.parse(
      await readFile(userReferenceDbPath, "utf8"),
    ) as {
      bodies: Record<string, unknown>;
      adapters: unknown[];
    };
    // Original cbbe entry preserved, uunp scaffold added.
    expect(Object.keys(mergedDb.bodies)).toContain("cbbe");
    expect(Object.keys(mergedDb.bodies)).toContain("uunp");

    // A human-readable notice must be returned.
    expect(dbMergeNotices.length).toBeGreaterThan(0);
    expect(dbMergeNotices[0]).toMatch(/Reference DB auto-updated/i);
    expect(dbMergeNotices[0]).toMatch(/cbbe.*uunp/i);
  });
});
