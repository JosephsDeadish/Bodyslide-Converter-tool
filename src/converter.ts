import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import type {
  BodyType,
  ConversionResult,
  DetectionResult,
  ScannedFile,
} from "./types.js";

const TEXT_EXTENSIONS = new Set([".xml", ".osp", ".txt", ".json", ".ini"]);
const MESH_EXTENSIONS = new Set([".nif", ".tri"]);

type ConversionPath = {
  label: string;
  namingNotes: string[];
};

const FEMALE_FAMILIES = new Set(["cbbe", "unp"]);
const MALE_FAMILIES = new Set(["male", "addon"]);

const CROSS_GENDER_NOTES = [
  "Rewrites target aliases plus common female/male asset markers in file names and metadata.",
  "Preserves source meshes for safety, so cross-gender outputs still require manual refit and weight cleanup in Outfit Studio.",
];

const FAMILY_PATHS = {
  cbbe: {
    label: "CBBE ↔ 3BA ↔ TBD",
    namingNotes: [
      "Uses canonical CBBE-family output aliases in rewritten file names and BodySlide metadata.",
      "Preserves meshes for safety, so CBBE-family cross-conversions still need manual mesh QA.",
    ],
  },
  unp: {
    label: "UNP ↔ UUNP ↔ BHUNP ↔ 7Base",
    namingNotes: [
      "Uses canonical UNP-family output aliases, including UUNP/BHUNP/7Base naming signals where available.",
      "UNP-family compatibility mode rewrites names and metadata only; legacy 7Base outputs should be reviewed carefully.",
    ],
  },
  male: {
    label: "HIMBO ↔ SAM ↔ BodyTalk ↔ SOS",
    namingNotes: [
      "Uses canonical male-body output aliases for HIMBO, SAM, BodyTalk, and SOS style projects.",
      "Male-family compatibility mode rewrites names and metadata only; it does not retarget mesh proportions.",
    ],
  },
} satisfies Record<"cbbe" | "unp" | "male", ConversionPath>;

const BODY_TYPE_OUTPUT_ALIASES: Record<BodyType, string> = {
  cbbe: "CBBE",
  "3ba": "3BA",
  himbo: "HIMBO",
  bodytalk: "BodyTalk",
  tbd: "TBD",
  sos: "SOS",
  unp: "UNP",
  bhunp: "BHUNP",
  uunp: "UUNP",
  "7base": "7Base",
  sam: "SAM",
  vanilla: "Vanilla",
};

const BODY_TYPE_ALIASES: Record<BodyType, string[]> = {
  cbbe: ["cbbe", "caliente", "calientetools", "cbbe body"],
  "3ba": [
    "cbbe 3bbb",
    "cbbe 3ba",
    "cbbe_3ba",
    "cbbe-3ba",
    "3bbb amazing body",
    "3bbb amazing",
    "3bbb",
    "3ba",
  ],
  himbo: [
    "highly improved male body",
    "high poly male body",
    "highpolymalebody",
    "himbo",
  ],
  bodytalk: [
    "bodytalk v3",
    "bodytalk v2",
    "bodytalk_body",
    "bodytalk body",
    "bodytalk",
    "bt3",
  ],
  tbd: ["touched by dibella", "tbd body", "tbd"],
  sos: [
    "schlongs of skyrim",
    "schlongsofskyrim",
    "sos regular",
    "sos light",
    "sos body",
    "sos",
  ],
  unp: ["dimonized", "unpb body", "unpb", "unp"],
  bhunp: ["bonehunger unp", "unp next generation", "bhunp 3bbb", "bhunp"],
  uunp: ["unified unp", "uunp special", "uunp"],
  "7base": ["7base", "sevenbase", "seven base"],
  sam: ["shape atlas for men", "sam light", "samlight", "sam"],
  vanilla: ["base game body", "default body", "vanilla"],
};

const FEMALE_TO_MALE_MARKERS = [
  ["1stpersonfemalehands", "1stpersonmalehands"],
  ["femalehands", "malehands"],
  ["femalefeet", "malefeet"],
  ["femalebody", "malebody"],
  ["femalehead", "malehead"],
  ["female_", "male_"],
  ["_female", "_male"],
  ["-female", "-male"],
  ["female-", "male-"],
  ["_f_", "_m_"],
  ["-f-", "-m-"],
] as const;

const MALE_TO_FEMALE_MARKERS = FEMALE_TO_MALE_MARKERS.map(
  ([female, male]) => [male, female] as const,
);

function hasFamilyPath(
  family: (typeof BODY_TYPE_INFO)[BodyType]["family"],
): family is keyof typeof FAMILY_PATHS {
  return family in FAMILY_PATHS;
}

function getGender(bodyType: BodyType): "female" | "male" | "both" {
  return BODY_TYPE_INFO[bodyType].gender;
}

function rewriteGenderMarkers(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  const sourceGender = getGender(source);
  const targetGender = getGender(target);

  if (
    sourceGender === targetGender ||
    sourceGender === "both" ||
    targetGender === "both"
  ) {
    return value;
  }

  const replacements =
    sourceGender === "female" && targetGender === "male"
      ? FEMALE_TO_MALE_MARKERS
      : MALE_TO_FEMALE_MARKERS;

  return replacements.reduce(
    (next, [from, to]) =>
      next.replaceAll(new RegExp(escapeRegExp(from), "gi"), to),
    value,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAliases(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  let next = value;
  const aliases = [...new Set(BODY_TYPE_ALIASES[source])].sort(
    (left, right) => right.length - left.length,
  );

  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "gi");
    next = next.replace(pattern, BODY_TYPE_OUTPUT_ALIASES[target]);
  }

  return next;
}

function rewriteRelativePath(
  relativePath: string,
  source: BodyType,
  target: BodyType,
): string {
  return relativePath
    .split(/[\\/]/)
    .map((segment) =>
      replaceAliases(
        rewriteGenderMarkers(segment, source, target),
        source,
        target,
      ),
    )
    .join("/");
}

function getConversionPath(
  source: BodyType,
  target: BodyType,
): {
  mode: ConversionResult["conversionMode"];
  label: string;
  preferredOutputAlias: string;
  namingNotes: string[];
} {
  if (source === target) {
    return {
      mode: "native",
      label: "Same-body output",
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: [
        `Uses the canonical ${BODY_TYPE_OUTPUT_ALIASES[target]} alias for generated file names and rewritten metadata.`,
      ],
    };
  }

  const sourceInfo = BODY_TYPE_INFO[source];
  const targetInfo = BODY_TYPE_INFO[target];

  if (
    (sourceInfo.family === targetInfo.family &&
      hasFamilyPath(sourceInfo.family)) ||
    (FEMALE_FAMILIES.has(sourceInfo.family) &&
      FEMALE_FAMILIES.has(targetInfo.family) &&
      sourceInfo.gender === "female" &&
      targetInfo.gender === "female")
  ) {
    const family =
      sourceInfo.family === targetInfo.family
        ? sourceInfo.family
        : "female-cross-family";
    if (family !== "female-cross-family") {
      const path = FAMILY_PATHS[family as keyof typeof FAMILY_PATHS];
      if (path) {
        return {
          mode: "compatibility",
          label: path.label,
          preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
          namingNotes: path.namingNotes,
        };
      }
    }

    return {
      mode: "compatibility",
      label: "Cross-family female adaptation",
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: [
        "Rewrites target aliases across female-body metadata, output paths, and BodySlide assets.",
        "Preserves meshes for safety; female cross-family conversions still need seam and slider QA.",
      ],
    };
  }

  if (
    (sourceInfo.family === targetInfo.family &&
      hasFamilyPath(sourceInfo.family)) ||
    (MALE_FAMILIES.has(sourceInfo.family) &&
      MALE_FAMILIES.has(targetInfo.family) &&
      sourceInfo.gender === "male" &&
      targetInfo.gender === "male")
  ) {
    const path = FAMILY_PATHS.male;
    return {
      mode: "compatibility",
      label: path.label,
      preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
      namingNotes: path.namingNotes,
    };
  }

  return {
    mode: "compatibility",
    label:
      sourceInfo.gender === "both" || targetInfo.gender === "both"
        ? "Vanilla compatibility adaptation"
        : "Cross-gender outfit adaptation",
    preferredOutputAlias: BODY_TYPE_OUTPUT_ALIASES[target],
    namingNotes:
      sourceInfo.gender === "both" || targetInfo.gender === "both"
        ? [
            "Rewrites target aliases across vanilla-style asset names and BodySlide metadata.",
            "Vanilla compatibility mode preserves meshes, so seam checks are still required.",
          ]
        : CROSS_GENDER_NOTES,
  };
}

function createWarnings(
  detection: DetectionResult,
  source: BodyType,
  target: BodyType,
  path: ReturnType<typeof getConversionPath>,
): string[] {
  const warnings = [...path.namingNotes];

  if (detection.confidence < 0.55) {
    warnings.push(
      `Detection confidence is low (${Math.round(detection.confidence * 100)}%). Review output meshes before release.`,
    );
  }

  if (source !== target) {
    warnings.push(
      `Native conversion is running in compatibility mode for '${source}' → '${target}' via ${path.label}. BodySlide metadata and asset paths were rewritten to ${path.preferredOutputAlias}, but meshes were preserved for safety, so manual QA in Outfit Studio/NifSkope is still required.`,
    );
  }

  const targetInfo = BODY_TYPE_INFO[target];
  if (targetInfo.physicsSupport) {
    warnings.push(
      `${target.toUpperCase()} uses physics-aware assets. This native pass rewrites BodySlide metadata and preserves meshes, but you should still verify runtime physics behavior.`,
    );
  }

  const sourceInfo = BODY_TYPE_INFO[source];
  if (sourceInfo.physicsSupport !== targetInfo.physicsSupport) {
    warnings.push(
      sourceInfo.physicsSupport
        ? `Source body '${source}' includes physics-aware data that '${target}' does not. Review copied meshes and configs for leftover physics references.`
        : `Target body '${target}' expects physics-aware data that '${source}' does not include. Review copied meshes and configs for any missing physics references.`,
    );
  }

  if (
    sourceInfo.gender !== targetInfo.gender &&
    sourceInfo.gender !== "both" &&
    targetInfo.gender !== "both"
  ) {
    warnings.push(
      `Cross-gender adaptation rewrote common ${sourceInfo.gender} asset markers to ${targetInfo.gender} markers so the generated outfit is labelled for the ${target.toUpperCase()} target body.`,
    );
  }

  if (sourceInfo.topology !== targetInfo.topology) {
    warnings.push(
      `Source topology '${sourceInfo.topology}' differs from target topology '${targetInfo.topology}'. Review ${targetInfo.adaptationFocus.slice(0, 3).join(", ")} before release.`,
    );
  }

  if (sourceInfo.family === "addon" || targetInfo.family === "addon") {
    warnings.push(
      "Addon-style body support (for example SOS) keeps partition-sensitive meshes intact. Verify slot assignments and exposed seams before release.",
    );
  }

  return warnings;
}

export async function convertMod(
  _inputDir: string,
  outputDir: string,
  files: ScannedFile[],
  detection: DetectionResult,
  targetBodyType: BodyType,
): Promise<ConversionResult> {
  if (detection.bodyType === "unknown") {
    throw new Error(
      "Cannot run native conversion when the source body type is unknown. Please choose a mod with detectable body-type assets first.",
    );
  }

  const sourceBodyType = detection.bodyType;
  const conversionPath = getConversionPath(sourceBodyType, targetBodyType);

  await mkdir(outputDir, { recursive: true });

  const convertedFiles: ConversionResult["convertedFiles"] = [];
  const skippedFiles: ConversionResult["skippedFiles"] = [];

  for (const file of files) {
    const rewrittenRelativePath = rewriteRelativePath(
      file.relativePath,
      sourceBodyType,
      targetBodyType,
    );
    const outputPath = join(outputDir, rewrittenRelativePath);
    await mkdir(dirname(outputPath), { recursive: true });

    if (TEXT_EXTENSIONS.has(file.extension)) {
      const content = await readFile(file.absolutePath, "utf8");
      const nextContent = replaceAliases(
        rewriteGenderMarkers(content, sourceBodyType, targetBodyType),
        sourceBodyType,
        targetBodyType,
      );
      await writeFile(outputPath, nextContent, "utf8");
      convertedFiles.push({
        sourcePath: file.relativePath,
        outputPath: rewrittenRelativePath,
        kind: "text",
        action: nextContent === content ? "copied" : "rewritten",
      });
      continue;
    }

    if (MESH_EXTENSIONS.has(file.extension)) {
      await copyFile(file.absolutePath, outputPath);
      convertedFiles.push({
        sourcePath: file.relativePath,
        outputPath: rewrittenRelativePath,
        kind: "mesh",
        action: "copied",
      });
      continue;
    }

    await copyFile(file.absolutePath, outputPath);
    skippedFiles.push({
      sourcePath: file.relativePath,
      outputPath: rewrittenRelativePath,
      reason: "Copied without body-specific changes.",
    });
  }

  return {
    sourceBodyType,
    targetBodyType,
    conversionMode: conversionPath.mode,
    conversionPath: conversionPath.label,
    preferredOutputAlias: conversionPath.preferredOutputAlias,
    namingNotes: conversionPath.namingNotes,
    detectionConfidence: detection.confidence,
    convertedFiles,
    skippedFiles,
    warnings: createWarnings(
      detection,
      sourceBodyType,
      targetBodyType,
      conversionPath,
    ),
    filesAnalyzed: files.length,
    generatedAt: new Date().toISOString(),
  };
}
