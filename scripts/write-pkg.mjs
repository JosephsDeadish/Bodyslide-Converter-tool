// Writes dist-main/package.json with "type":"commonjs" so Node treats
// the tsc-compiled CJS output files correctly when Electron loads them.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEST_PKG = join(ROOT, "dist-main", "package.json");

await mkdir(join(ROOT, "dist-main"), { recursive: true });
await writeFile(
  DEST_PKG,
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Wrote dist-main/package.json\n");
