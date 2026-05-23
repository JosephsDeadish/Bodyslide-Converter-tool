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

const NATIVE_COMPATIBILITY: Record<BodyType, ReadonlySet<BodyType>> = {
  cbbe: new Set(["cbbe", "3ba", "tbd"]),
  "3ba": new Set(["3ba", "cbbe", "tbd"]),
  himbo: new Set(["himbo"]),
  tbd: new Set(["tbd", "cbbe", "3ba"]),
  sos: new Set(["sos"]),
  unp: new Set(["unp", "uunp", "bhunp"]),
  bhunp: new Set(["bhunp", "unp", "uunp"]),
  uunp: new Set(["uunp", "unp", "bhunp"]),
  "7base": new Set(["7base"]),
  sam: new Set(["sam"]),
  vanilla: new Set(["vanilla"]),
};

const SUPPORTED_NATIVE_PATHS = [
  "same-body output",
  "CBBE ↔ 3BA ↔ TBD",
  "UNP ↔ UUNP ↔ BHUNP",
];

const BODY_TYPE_ALIASES: Record<BodyType, string[]> = {
  cbbe: ["cbbe", "caliente"],
  "3ba": ["3ba", "3bbb", "3bbb amazing body"],
  himbo: ["himbo"],
  tbd: ["tbd", "touched by dibella"],
  sos: ["sos", "schlongs of skyrim"],
  unp: ["unp", "unpb", "dimonized"],
  bhunp: ["bhunp", "bonehunger unp"],
  uunp: ["uunp", "unified unp"],
  "7base": ["7base", "sevenbase", "seven base"],
  sam: ["sam light", "sam", "shape atlas for men"],
  vanilla: ["vanilla", "default body"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAliases(
  value: string,
  source: BodyType,
  target: BodyType,
): string {
  let next = value;

  for (const alias of BODY_TYPE_ALIASES[source]) {
    const pattern = new RegExp(escapeRegExp(alias), "gi");
    next = next.replace(pattern, (match) => {
      if (match === match.toUpperCase()) {
        return target.toUpperCase();
      }
      if (match[0] && match[0] === match[0].toUpperCase()) {
        return target.charAt(0).toUpperCase() + target.slice(1);
      }
      return target;
    });
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
    .map((segment) => replaceAliases(segment, source, target))
    .join("/");
}

function isNativeConversionSupported(
  source: BodyType,
  target: BodyType,
): boolean {
  return NATIVE_COMPATIBILITY[source].has(target);
}

function createWarnings(
  detection: DetectionResult,
  source: BodyType,
  target: BodyType,
): string[] {
  const warnings: string[] = [];

  if (detection.confidence < 0.55) {
    warnings.push(
      `Detection confidence is low (${Math.round(detection.confidence * 100)}%). Review output meshes before release.`,
    );
  }

  if (source !== target) {
    warnings.push(
      `Native conversion is running in compatibility mode for '${source}' → '${target}'. BodySlide metadata and asset paths were rewritten, but meshes were preserved for safety, so manual QA in Outfit Studio/NifSkope is still required.`,
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
  if (!isNativeConversionSupported(sourceBodyType, targetBodyType)) {
    throw new Error(
      `Native conversion is currently supported for: ${SUPPORTED_NATIVE_PATHS.join(", ")}. '${sourceBodyType}' → '${targetBodyType}' is not implemented yet.`,
    );
  }

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
        content,
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
    detectionConfidence: detection.confidence,
    convertedFiles,
    skippedFiles,
    warnings: createWarnings(detection, sourceBodyType, targetBodyType),
    filesAnalyzed: files.length,
    generatedAt: new Date().toISOString(),
  };
}
