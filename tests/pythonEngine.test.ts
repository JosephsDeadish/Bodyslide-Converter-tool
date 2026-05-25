import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PythonEngineRunSummary } from "../src/types.js";

const runnerPath = fileURLToPath(
  new URL("../python_engine/runner.py", import.meta.url),
);

const tempDirs: string[] = [];

type RunnerOptions = {
  dbPath?: string;
  isolateSitePackages?: boolean;
};

type RunnerPayload = {
  runId: string;
  inputPath: string;
  outputPath: string;
  sourceBodyType: string;
  targetBodyType: string;
  files: Array<{
    relativePath: string;
    extension: string;
    preview: string;
  }>;
};

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slidesmith-python-"));
  tempDirs.push(dir);
  return dir;
}

async function runRunner(
  payload: RunnerPayload,
  options: RunnerOptions = {},
): Promise<PythonEngineRunSummary> {
  const commands = [process.env.SLIDESMITH_PYTHON, "python3", "python"].filter(
    (value): value is string => Boolean(value),
  );

  let lastError: Error | undefined;
  for (const command of commands) {
    try {
      return await runRunnerWithCommand(command, payload, options);
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code === "ENOENT") {
        lastError = candidate;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ?? new Error("No Python interpreter was available for tests.")
  );
}

async function runRunnerWithCommand(
  command: string,
  payload: RunnerPayload,
  options: RunnerOptions,
): Promise<PythonEngineRunSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [...(options.isolateSitePackages ? ["-S"] : []), runnerPath],
      {
        env: {
          ...process.env,
          ...(options.dbPath
            ? { SLIDESMITH_REFERENCE_DB: options.dbPath }
            : undefined),
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | undefined;

    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (spawnError) {
        reject(spawnError);
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `runner exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }

      const events = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const errorEvent = events.find((event) => event.type === "error");
      if (errorEvent) {
        reject(new Error(String(errorEvent.error ?? "Unknown runner error")));
        return;
      }

      const completeEvent = events.find((event) => event.type === "complete");
      if (!completeEvent || typeof completeEvent.run !== "object") {
        reject(
          new Error(`runner did not emit a complete event\nstdout:\n${stdout}`),
        );
        return;
      }

      resolve(completeEvent.run as PythonEngineRunSummary);
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("python engine runner", () => {
  it("requires topology references and canonical vertex maps from the reference database", async () => {
    const tempDir = await makeTempDir();
    const dbPath = join(tempDir, "body_reference_db.json");

    await writeFile(
      dbPath,
      JSON.stringify(
        {
          schemaVersion: 2,
          bodies: {
            cbbe: {
              topology: "cbbe",
              sliderMappings: { waist: "Waist" },
              boneMap: { spine: "NPC Spine2" },
              morphEquivalents: { heavy: "CBBE Curvy" },
              physicsBones: [],
              correctiveSmoothingZones: [
                "armpit-left",
                "armpit-right",
                "crotch",
                "elbow-left",
                "elbow-right",
                "knee-left",
                "knee-right",
              ],
            },
            "3ba": {
              topology: "cbbe",
              topologyReference: "3BA Body Amazing",
              canonicalVertexMap: "cbbe-female-canonical",
              sliderMappings: { waist: "Waist" },
              boneMap: { spine: "NPC Spine2", belly: "NPC Belly" },
              morphEquivalents: { heavy: "3BA Curvy" },
              physicsBones: ["NPC Belly"],
              correctiveSmoothingZones: [
                "armpit-left",
                "armpit-right",
                "crotch",
                "elbow-left",
                "elbow-right",
                "knee-left",
                "knee-right",
              ],
            },
          },
          adapters: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const run = await runRunner(
      {
        runId: "metadata-test",
        inputPath: tempDir,
        outputPath: tempDir,
        sourceBodyType: "cbbe",
        targetBodyType: "3ba",
        files: [
          {
            relativePath: "meshes/armor/test_1.nif",
            extension: ".nif",
            preview: "mesh payload",
          },
          {
            relativePath: "CalienteTools/BodySlide/SliderSets/test.osp",
            extension: ".osp",
            preview: "<SliderSet></SliderSet>",
          },
        ],
      },
      { dbPath, isolateSitePackages: true },
    );

    const referenceStage = run.stages.find(
      (stage) => stage.id === "reference-body",
    );
    const surfaceStage = run.stages.find(
      (stage) => stage.id === "surface-reprojection",
    );

    expect(referenceStage?.status).toBe("attention");
    expect(referenceStage?.details).toContain(
      "cbbe body metadata is missing topologyReference, canonicalVertexMap.",
    );
    expect(surfaceStage?.details).toContain(
      "Source canonical vertex map is missing for cbbe.",
    );
  });

  it("reports missing core geometry libraries when Python site packages are disabled", async () => {
    const tempDir = await makeTempDir();

    const run = await runRunner(
      {
        runId: "library-test",
        inputPath: tempDir,
        outputPath: tempDir,
        sourceBodyType: "cbbe",
        targetBodyType: "3ba",
        files: [
          {
            relativePath: "meshes/armor/test_1.nif",
            extension: ".nif",
            preview: "mesh payload",
          },
          {
            relativePath: "meshes/armor/test_1.tri",
            extension: ".tri",
            preview: "tri payload",
          },
          {
            relativePath: "CalienteTools/BodySlide/SliderSets/test.osp",
            extension: ".osp",
            preview: "<SliderSet></SliderSet>",
          },
        ],
      },
      { isolateSitePackages: true },
    );

    const referenceStage = run.stages.find(
      (stage) => stage.id === "reference-body",
    );
    const surfaceStage = run.stages.find(
      (stage) => stage.id === "surface-reprojection",
    );

    expect(referenceStage?.status).toBe("pass");
    expect(run.libraries).toEqual({
      pyffi: false,
      numpy: false,
      scipy: false,
      trimesh: false,
      pyvista: false,
    });
    expect(run.warnings).toContain(
      "PyFFI is not installed in the active Python environment; full NIF IO fallback mode is active.",
    );
    expect(
      surfaceStage?.details.some((detail) =>
        detail.includes(
          "Missing required Python libraries for nearest-surface reprojection:",
        ),
      ),
    ).toBe(true);
  });

  it("flags high-risk conversion pairs that are missing explicit adapter profiles", async () => {
    const tempDir = await makeTempDir();
    const dbPath = join(tempDir, "body_reference_db.json");

    await writeFile(
      dbPath,
      JSON.stringify(
        {
          schemaVersion: 3,
          bodies: {
            cbbe: {
              topology: "cbbe",
              topologyReference: "CBBE SE Curvy",
              canonicalVertexMap: "cbbe-female-canonical",
              partitionProfile: "female-default",
              sliderMappings: { waist: "Waist" },
              boneMap: { spine: "NPC Spine2", pelvis: "NPC Pelvis" },
              morphEquivalents: { heavy: "CBBE Curvy" },
              physicsBones: [],
              correctiveSmoothingZones: [
                "armpit-left",
                "armpit-right",
                "crotch",
                "elbow-left",
                "elbow-right",
                "knee-left",
                "knee-right",
              ],
            },
            uunp: {
              topology: "unp",
              topologyReference: "UUNP Special",
              canonicalVertexMap: "unp-female-canonical",
              partitionProfile: "female-physics",
              sliderMappings: { waist: "Waist" },
              boneMap: { spine: "NPC Spine2", pelvis: "NPC Pelvis" },
              morphEquivalents: { heavy: "UUNP Curvy" },
              physicsBones: ["NPC L Breast01", "NPC R Breast01"],
              correctiveSmoothingZones: [
                "armpit-left",
                "armpit-right",
                "crotch",
                "elbow-left",
                "elbow-right",
                "knee-left",
                "knee-right",
              ],
              physicsConfig: {
                cbpcCompatible: true,
                hdtSmpCompatible: true,
                softbodySupported: true,
                physicsLevel: "tbbp",
                boneNamingConvention: "cbbe-standard",
              },
            },
          },
          adapters: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const run = await runRunner(
      {
        runId: "adapter-test",
        inputPath: tempDir,
        outputPath: tempDir,
        sourceBodyType: "cbbe",
        targetBodyType: "uunp",
        files: [
          {
            relativePath: "meshes/armor/test_1.nif",
            extension: ".nif",
            preview: "mesh payload",
          },
          {
            relativePath: "CalienteTools/BodySlide/SliderSets/test.osp",
            extension: ".osp",
            preview: "<SliderSet></SliderSet>",
          },
        ],
      },
      { dbPath, isolateSitePackages: true },
    );

    const referenceStage = run.stages.find(
      (stage) => stage.id === "reference-body",
    );

    expect(referenceStage?.status).toBe("attention");
    expect(referenceStage?.details).toContain(
      "Missing explicit adapter profile for high-risk conversion pair cbbe -> uunp.",
    );
  });
});
