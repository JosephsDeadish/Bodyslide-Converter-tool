import type { BodyType, ScannedFile } from "./types.js";

const MALE_GENERAL_HINTS = [
  "character assets male",
  "/maleassets/",
  "_male_",
  "/male/",
  "/malebody",
  "/malehands",
  "/malefeet",
  "/malehead",
];

const FEMALE_BODY_HINTS = [
  "cbbe",
  "3ba",
  "tbd",
  "unp",
  "bhunp",
  "uunp",
  "ube",
  "7base",
  "vanilla",
];

const MALE_BODY_HINTS: Record<BodyType, string[]> = {
  cbbe: [],
  "3ba": [],
  himbo: ["himbo", "highly improved male body overhaul"],
  bodytalk: ["bodytalk", "bt3", "bt2"],
  tbd: [],
  sos: ["sos", "schlong", "schlongs", "genitals"],
  unp: [],
  bhunp: [],
  uunp: [],
  ube: [],
  "7base": [],
  sam: ["sam", "shape atlas for men"],
  vanilla: [],
};

function hasAnyHint(text: string, hints: readonly string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

function toLowerSearchBlob(file: ScannedFile): string {
  return `${file.relativePath}\n${file.basename}\n${file.preview}`.toLowerCase();
}

export function filterFilesForMalePass(
  files: ScannedFile[],
  maleSource: BodyType,
): ScannedFile[] {
  const sourceHints = MALE_BODY_HINTS[maleSource];
  return files.filter((file) => {
    const blob = toLowerSearchBlob(file);
    const sourceSpecificHit = hasAnyHint(blob, sourceHints);
    if (sourceSpecificHit) {
      return true;
    }
    const maleGeneralHit = hasAnyHint(blob, MALE_GENERAL_HINTS);
    if (!maleGeneralHit) {
      return false;
    }
    const femaleHit = hasAnyHint(blob, FEMALE_BODY_HINTS);
    return !femaleHit;
  });
}
