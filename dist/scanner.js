import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
const TEXT_PREVIEW_BYTES = 4096;
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
async function asyncPool(limit, tasks) {
    if (tasks.length === 0)
        return [];
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
        while (next < tasks.length) {
            const i = next++;
            const task = tasks[i];
            if (task !== undefined) {
                results[i] = await task();
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
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
async function walk(rootDir) {
    const result = [];
    const dirQueue = [rootDir];
    let capped = false;
    while (dirQueue.length > 0 && !capped) {
        const batch = dirQueue.splice(0, WALK_CONCURRENCY);
        const batchEntries = await asyncPool(WALK_CONCURRENCY, batch.map((dir) => async () => readdir(dir, { withFileTypes: true }).catch(() => [])));
        for (let bi = 0; bi < batch.length && !capped; bi++) {
            const dir = batch[bi];
            const entries = batchEntries[bi];
            if (!dir || !entries)
                continue;
            for (const entry of entries) {
                if (capped)
                    break;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!SKIP_DIRNAMES.has(entry.name.toLowerCase())) {
                        dirQueue.push(fullPath);
                    }
                }
                else {
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
        process.stderr.write(`[scanner] Reached the ${MAX_SCAN_FILES.toLocaleString()}-file scan limit; some files were not processed. Scan a smaller sub-folder or increase MAX_SCAN_FILES if needed.\n`);
    }
    return result;
}
async function readPreview(path) {
    try {
        const buffer = await readFile(path);
        return buffer
            .subarray(0, TEXT_PREVIEW_BYTES)
            .toString("latin1")
            .toLowerCase();
    }
    catch {
        return "";
    }
}
export async function scanModFiles(inputDir) {
    const files = await walk(inputDir);
    const scanned = await asyncPool(READ_CONCURRENCY, files.map((file) => async () => ({
        absolutePath: file,
        relativePath: relative(inputDir, file),
        extension: extname(file).toLowerCase(),
        basename: basename(file).toLowerCase(),
        preview: await readPreview(file),
    })));
    return scanned;
}
//# sourceMappingURL=scanner.js.map