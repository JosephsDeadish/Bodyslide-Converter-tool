import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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

function makeSummary(stages: PythonEngineRunSummary["stages"]): PythonEngineRunSummary {
  return {
    runId: "repair-run",
    backend: "python",
    stages,
    qualityGates: [],
    warnings: [],
    libraries: {
      pynifly: true,
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
    const artifacts = await generateRepairArtifacts({
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
    const artifacts = await generateRepairArtifacts({
      reportsDir,
      sourceBodyType: "cbbe",
      targetBodyType: "3ba",
      pythonSummary: makeSummary([
        {
          id: "corrective-smoothing",
          title: "Corrective smoothing",
          status: "attention",
          summary: "Corrective smoothing skipped because no NIF mesh was found.",
          details: ["Armpit, breast/chest, crotch, elbow, and knee zones could not be evaluated."],
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
    expect(manifest.issues.some((issue) => issue.id === "missing-nif-mesh")).toBe(
      true,
    );
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
    expect(patch.adapters).toContainEqual({
      source: "cbbe",
      target: "uunp",
      profile: "TODO-adapter-profile-name",
    });
  });
});
