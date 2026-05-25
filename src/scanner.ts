import type { Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { ScannedFile } from "./types.js";

const TEXT_PREVIEW_BYTES = 4096;
const BINARY_PREVIEW_BYTES = 512;
const PREVIEW_BYTE_LIMITS = new Map<string, number>([
  [".txt", TEXT_PREVIEW_BYTES],
  [".xml", TEXT_PREVIEW_BYTES],
  [".osp", TEXT_PREVIEW_BYTES],
  [".ini", TEXT_PREVIEW_BYTES],
  [".json", TEXT_PREVIEW_BYTES],
  [".nif", BINARY_PREVIEW_BYTES],
  [".tri", BINARY_PREVIEW_BYTES],
  [".osd", BINARY_PREVIEW_BYTES],
]);

// Maximum number of concurrent readdir calls during BFS walk.
// Keeps the OS file-descriptor count under control on large mod trees.
const WALK_CONCURRENCY = 8;

// Maximum number of concurrent file-preview reads.
// Prevents EMFILE (too many open files) on large mod folders.
const READ_CONCURRENCY = 32;

// Hard cap on the number of files scanned in one pass.
// Typical Skyrim mod folders contain well under 10 000 files;
// very large collections should be scanned one mod at a time.
const MAX_SCAN_FILES = 100_000;

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

/**
 * Runs up to `limit` async tasks concurrently, returning results in the same
 * order as `tasks`. Replaces unbounded `Promise.all` calls to keep OS
 * file-descriptor usage bounded on large directories.
 */
async function asyncPool<T>(
  limit: number,
  tasks: ReadonlyArray<() => Promise<T>>,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      if (task !== undefined) {
        results[i] = await task();
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

/**
 * BFS directory walk with bounded readdir concurrency.
 *
 * The previous recursive-`Promise.all` implementation opened every directory
 * level in parallel (potentially thousands of simultaneous `readdir` calls on
 * deep/wide mod trees), which exhausted OS file-descriptor limits and caused
 * the application to crash or hang. This iterative BFS version processes at
 * most WALK_CONCURRENCY directories at a time.
 */
async function walk(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  const dirQueue: string[] = [rootDir];
  let capped = false;

  while (dirQueue.length > 0 && !capped) {
    const batch = dirQueue.splice(0, WALK_CONCURRENCY);
    const batchEntries = await asyncPool<Dirent[]>(
      WALK_CONCURRENCY,
      batch.map(
        (dir) => async () =>
          readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]),
      ),
    );

    for (let bi = 0; bi < batch.length && !capped; bi++) {
      const dir = batch[bi];
      const entries = batchEntries[bi];
      if (!dir || !entries) continue;
      for (const entry of entries) {
        if (capped) break;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRNAMES.has(entry.name.toLowerCase())) {
            dirQueue.push(fullPath);
          }
        } else {
          if (!SKIP_FILENAMES.has(entry.name.toLowerCase())) {
            result.push(fullPath);
            if (result.length >= MAX_SCAN_FILES) {
              capped = true;
            }
          }
        }
      }
    }
  }

  if (capped) {
    process.stderr.write(
      `[scanner] Reached the ${MAX_SCAN_FILES.toLocaleString()}-file scan limit; some files were not processed. Scan a smaller sub-folder or increase MAX_SCAN_FILES if needed.\n`,
    );
  }

  return result;
}

async function readPreview(path: string, extension: string): Promise<string> {
  const previewBytes = PREVIEW_BYTE_LIMITS.get(extension);
  if (previewBytes === undefined) {
    return "";
  }

  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.allocUnsafe(previewBytes);
      const { bytesRead } = await handle.read(buffer, 0, previewBytes, 0);
      return buffer.subarray(0, bytesRead).toString("latin1").toLowerCase();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export async function scanModFiles(inputDir: string): Promise<ScannedFile[]> {
  const files = await walk(inputDir);
  const scanned = await asyncPool(
    READ_CONCURRENCY,
    files.map((file) => async () => {
      const extension = extname(file).toLowerCase();
      return {
        absolutePath: file,
        relativePath: relative(inputDir, file),
        extension,
        basename: basename(file).toLowerCase(),
        preview: await readPreview(file, extension),
      };
    }),
  );
  return scanned;
}
