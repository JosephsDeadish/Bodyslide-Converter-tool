import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BODY_TYPES } from "../src/types.js";

type ReferenceBody = {
  topology: string;
  topologyReference: string;
  canonicalVertexMap: string;
  sliderMappings: Record<string, string>;
  boneMap: Record<string, string>;
  morphEquivalents: Record<string, string>;
  physicsBones: string[];
  correctiveSmoothingZones: string[];
};

type ReferenceDb = {
  schemaVersion: number;
  bodies: Record<string, ReferenceBody>;
  adapters: Array<{
    source: string;
    target: string;
    profile: string;
  }>;
};

async function loadReferenceDb(): Promise<ReferenceDb> {
  const raw = await readFile(
    new URL(
      "../python_engine/slidesmith_engine/references/body_reference_db.json",
      import.meta.url,
    ),
    "utf8",
  );
  return JSON.parse(raw) as ReferenceDb;
}

describe("body reference database", () => {
  it("contains all supported body types with required mapping fields", async () => {
    const db = await loadReferenceDb();
    expect(db.schemaVersion).toBeGreaterThanOrEqual(2);

    for (const bodyType of BODY_TYPES) {
      const body = db.bodies[bodyType];
      expect(body, `missing body metadata for ${bodyType}`).toBeDefined();
      expect(body.topology).toBeTruthy();
      expect(body.topologyReference).toBeTruthy();
      expect(body.canonicalVertexMap).toBeTruthy();
      expect(Object.keys(body.sliderMappings).length).toBeGreaterThan(0);
      expect(Object.keys(body.boneMap).length).toBeGreaterThan(0);
      expect(Object.keys(body.morphEquivalents).length).toBeGreaterThan(0);
      expect(
        Array.isArray(body.correctiveSmoothingZones) &&
          body.correctiveSmoothingZones.length > 0,
        `${bodyType} is missing correctiveSmoothingZones`,
      ).toBe(true);
    }
  });

  it("keeps canonical slider and morph keysets aligned by topology families", async () => {
    const db = await loadReferenceDb();

    const cbbeFamily = ["cbbe", "3ba", "tbd"] as const;
    const unpFamily = ["unp", "bhunp", "uunp", "7base"] as const;
    const maleFamily = ["himbo", "bodytalk", "sos", "sam"] as const;

    const families = [cbbeFamily, unpFamily, maleFamily];
    for (const family of families) {
      const baseline = db.bodies[family[0]];
      const sliderKeys = new Set(Object.keys(baseline.sliderMappings));
      const morphKeys = new Set(Object.keys(baseline.morphEquivalents));

      for (const bodyType of family.slice(1)) {
        const body = db.bodies[bodyType];
        expect(new Set(Object.keys(body.sliderMappings))).toEqual(sliderKeys);
        expect(new Set(Object.keys(body.morphEquivalents))).toEqual(morphKeys);
      }
    }
  });

  it("keeps baseline canonical bone chains present in each topology family", async () => {
    const db = await loadReferenceDb();

    const cbbeFamily = ["cbbe", "3ba", "tbd"] as const;
    const unpFamily = ["unp", "bhunp", "uunp", "7base"] as const;
    const maleFamily = ["himbo", "bodytalk", "sos", "sam"] as const;
    const families = [cbbeFamily, unpFamily, maleFamily];

    for (const family of families) {
      const requiredBoneKeys = Object.keys(db.bodies[family[0]].boneMap);
      for (const bodyType of family.slice(1)) {
        const boneKeys = new Set(Object.keys(db.bodies[bodyType].boneMap));
        for (const requiredKey of requiredBoneKeys) {
          expect(
            boneKeys.has(requiredKey),
            `${bodyType} is missing required canonical bone key '${requiredKey}'`,
          ).toBe(true);
        }
      }
    }
  });

  it("ensures physics bone entries are representable through canonical bone maps", async () => {
    const db = await loadReferenceDb();

    for (const bodyType of BODY_TYPES) {
      const body = db.bodies[bodyType];
      const mappedBones = new Set(Object.values(body.boneMap));
      for (const physicsBone of body.physicsBones) {
        expect(
          mappedBones.has(physicsBone),
          `${bodyType} physics bone '${physicsBone}' is not mapped in boneMap`,
        ).toBe(true);
      }
    }
  });

  it("corrective smoothing zones contain the critical joint regions", async () => {
    const db = await loadReferenceDb();

    const requiredZones = [
      "armpit-left",
      "armpit-right",
      "crotch",
      "elbow-left",
      "elbow-right",
      "knee-left",
      "knee-right",
    ];
    for (const bodyType of BODY_TYPES) {
      const body = db.bodies[bodyType];
      const zones = new Set(body.correctiveSmoothingZones);
      for (const zone of requiredZones) {
        expect(
          zones.has(zone),
          `${bodyType} is missing corrective smoothing zone '${zone}'`,
        ).toBe(true);
      }
    }
  });
});
