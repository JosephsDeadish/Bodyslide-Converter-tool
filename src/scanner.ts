import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { ScannedFile } from "./types.js";

const TEXT_PREVIEW_BYTES = 4096;

// Directory names that should never be walked — prevents report bleed-back
// when scanning an output folder and avoids leaking VCS metadata into signals.
const SKIP_DIRNAMES = new Set(["_slidesmith", ".git", "__macosx", ".svn"]);

// File names to skip — system thumbnails and OS metadata files that add noise
// to detection haystacks without containing any meaningful body-type signals.
const SKIP_FILENAMES = new Set([
  ".ds_store",
  "desktop.ini",
  "thumbs.db",
  "ehthumbs.db",
]);

async function walk(currentDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    // Skip directories that cannot be read (permission errors, broken links, etc.)
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRNAMES.has(entry.name.toLowerCase())) return [];
        return walk(fullPath);
      }

      if (SKIP_FILENAMES.has(entry.name.toLowerCase())) return [];
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
