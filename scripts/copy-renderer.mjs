// Copies renderer/ assets into dist-main/renderer/ and writes a package.json
// with "type":"commonjs" into dist-main/ so Node treats CJS .js files correctly.
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_RENDERER = join(ROOT, "src", "renderer");
const DEST_RENDERER = join(ROOT, "dist-main", "renderer");
const DEST_PKG = join(ROOT, "dist-main", "package.json");

await mkdir(DEST_RENDERER, { recursive: true });

const entries = await readdir(SRC_RENDERER, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isFile()) {
    await copyFile(
      join(SRC_RENDERER, entry.name),
      join(DEST_RENDERER, entry.name),
    );
    process.stdout.write(`Copied renderer/${entry.name}\n`);
  }
}

await writeFile(
  DEST_PKG,
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Wrote dist-main/package.json\n");
