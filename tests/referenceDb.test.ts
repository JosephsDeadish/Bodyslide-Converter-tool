import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BODY_TYPES } from "../src/types.js";

type ReferenceBody = {
  topology: string;
  topologyReference: string;
  canonicalVertexMap: string;
  partitionProfile?: string;
  sliderMappings: Record<string, string>;
  boneMap: Record<string, string>;
  morphEquivalents: Record<string, string>;
  physicsBones: string[];
  physicsConfig?: {
    cbpcCompatible?: boolean;
    hdtSmpCompatible?: boolean;
    softbodySupported?: boolean;
    boneNamingConvention?: string;
  };
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

function normalizeBodyKey(value: string): string {
  return value.trim().toLowerCase();
}

function invertAdapterProfileDirection(profile: string): string {
  if (profile.includes("upgrade") && !profile.includes("downgrade")) {
    return profile.replace("upgrade", "downgrade");
  }
  if (profile.includes("downgrade") && !profile.includes("upgrade")) {
    return profile.replace("downgrade", "upgrade");
  }
  return profile;
}

function resolveAdapterProfile(
  db: ReferenceDb,
  source: string,
  target: string,
): string {
  const adapters = db.adapters ?? [];
  const sourceKey = normalizeBodyKey(source);
  const targetKey = normalizeBodyKey(target);
  const resolutionOrder: Array<{
    source: string;
    target: string;
    reverse: boolean;
  }> = [
    { source: sourceKey, target: targetKey, reverse: false },
    { source: sourceKey, target: "*", reverse: false },
    { source: "*", target: targetKey, reverse: false },
    { source: "*", target: "*", reverse: false },
    { source: targetKey, target: sourceKey, reverse: true },
    { source: targetKey, target: "*", reverse: true },
    { source: "*", target: sourceKey, reverse: true },
  ];

  for (const candidate of resolutionOrder) {
    for (const adapter of adapters) {
      if (
        normalizeBodyKey(adapter.source) !== candidate.source ||
        normalizeBodyKey(adapter.target) !== candidate.target
      ) {
        continue;
      }

      const profile = adapter.profile.trim();
      if (!profile) {
        continue;
      }

      return candidate.reverse
        ? invertAdapterProfileDirection(profile)
        : profile;
    }
  }

  return "default";
}

function bodyHasPhysics(body: ReferenceBody): boolean {
  if (body.physicsBones.length > 0) {
    return true;
  }

  return Boolean(
    body.physicsConfig?.cbpcCompatible ||
      body.physicsConfig?.hdtSmpCompatible ||
      body.physicsConfig?.softbodySupported,
  );
}

function requiresExplicitAdapterProfile(
  source: ReferenceBody,
  target: ReferenceBody,
  profile: string,
): boolean {
  if (profile !== "default") {
    return false;
  }

  if (source.topology !== target.topology) {
    return true;
  }

  const sourcePartition = source.partitionProfile ?? "";
  const targetPartition = target.partitionProfile ?? "";
  if (sourcePartition !== targetPartition) {
    return true;
  }

  const sourceConvention =
    source.physicsConfig?.boneNamingConvention?.trim().toLowerCase() ?? "";
  const targetConvention =
    target.physicsConfig?.boneNamingConvention?.trim().toLowerCase() ?? "";
  if (
    sourceConvention &&
    targetConvention &&
    sourceConvention !== targetConvention
  ) {
    return true;
  }

  return bodyHasPhysics(source) !== bodyHasPhysics(target);
}

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

    const cbbeFamily = ["cbbe", "3ba", "coco", "tbd"] as const;
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

    const cbbeFamily = ["cbbe", "3ba", "coco", "tbd"] as const;
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

  it("has adapter coverage for every high-risk body-to-body conversion pair", async () => {
    const db = await loadReferenceDb();
    const missingProfiles: string[] = [];

    for (const sourceType of BODY_TYPES) {
      for (const targetType of BODY_TYPES) {
        if (sourceType === targetType) {
          continue;
        }

        const sourceBody = db.bodies[sourceType];
        const targetBody = db.bodies[targetType];
        const resolvedProfile = resolveAdapterProfile(
          db,
          sourceType,
          targetType,
        );
        if (
          requiresExplicitAdapterProfile(
            sourceBody,
            targetBody,
            resolvedProfile,
          )
        ) {
          missingProfiles.push(`${sourceType}->${targetType}`);
        }
      }
    }

    expect(missingProfiles).toEqual([]);
  });
});
