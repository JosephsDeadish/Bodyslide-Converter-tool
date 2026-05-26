import { describe, expect, it } from "vitest";
import { filterFilesForMalePass } from "../src/conversionScope.js";
import type { ScannedFile } from "../src/types.js";

function makeFile(
  relativePath: string,
  preview = "",
  extension = ".nif",
): ScannedFile {
  const normalized = relativePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const basename =
    slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return {
    absolutePath: `/tmp/${normalized}`,
    relativePath: normalized,
    extension,
    basename,
    preview,
  };
}

describe("filterFilesForMalePass", () => {
  it("keeps source-specific male files", () => {
    const files = [
      makeFile("meshes/armor/himbo/himbo_armor_0.nif", "himbo mesh"),
      makeFile("meshes/armor/cbbe/cbbe_armor_0.nif", "cbbe mesh"),
    ];

    const scoped = filterFilesForMalePass(files, "himbo");

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.relativePath).toContain("himbo_armor_0.nif");
  });

  it("keeps generic male-character assets and excludes female assets", () => {
    const files = [
      makeFile(
        "meshes/actors/character/character assets male/malebody_0.nif",
        "default male body",
      ),
      makeFile(
        "meshes/actors/character/character assets/femalebody_0.nif",
        "default female body",
      ),
    ];

    const scoped = filterFilesForMalePass(files, "sam");

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.relativePath).toContain("malebody_0.nif");
  });

  it("keeps SOS-tagged text configs for male pass", () => {
    const files = [
      makeFile(
        "SKSE/Plugins/CBPC/cbpc_sos_config.ini",
        "NPC GenitalsBase01=0.3",
        ".ini",
      ),
      makeFile(
        "SKSE/Plugins/CBPC/cbpc_3ba_config.ini",
        "NPC L Breast01=0.5",
        ".ini",
      ),
    ];

    const scoped = filterFilesForMalePass(files, "sos");

    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.relativePath).toContain("cbpc_sos_config.ini");
  });
});
