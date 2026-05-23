import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { ScannedFile } from "./types.js";

const TEXT_PREVIEW_BYTES = 4096;

async function walk(currentDir: string): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }

      return [fullPath];
    }),
  );

  return files.flat();
}

async function readPreview(path: string): Promise<string> {
  try {
    const buffer = await readFile(path);
    return buffer
      .subarray(0, TEXT_PREVIEW_BYTES)
      .toString("latin1")
      .toLowerCase();
  } catch {
    return "";
  }
}

export async function scanModFiles(inputDir: string): Promise<ScannedFile[]> {
  const files = await walk(inputDir);
  const scanned = await Promise.all(
    files.map(async (file) => ({
      absolutePath: file,
      relativePath: relative(inputDir, file),
      extension: extname(file).toLowerCase(),
      basename: basename(file).toLowerCase(),
      preview: await readPreview(file),
    })),
  );

  return scanned;
}
