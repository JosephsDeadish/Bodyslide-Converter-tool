// Writes dist-main/package.json with "type":"commonjs" so Node treats
// the tsc-compiled CJS output files correctly when Electron loads them.
import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_MAIN = join(ROOT, "dist-main");
const DEST_PKG = join(ROOT, "dist-main", "package.json");
const SRC_PYTHON_ENGINE = join(ROOT, "python_engine");
const DEST_PYTHON_ENGINE = join(DIST_MAIN, "python_engine");
const SRC_BUILD_ASSETS = join(ROOT, "build");
const DEST_BUILD_ASSETS = join(DIST_MAIN, "build");
const SRC_PYTHON_DEPS = join(ROOT, "python_deps");
const DEST_PYTHON_DEPS = join(DIST_MAIN, "python_deps");

await mkdir(DIST_MAIN, { recursive: true });
await writeFile(
  DEST_PKG,
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Wrote dist-main/package.json\n");

await cp(SRC_PYTHON_ENGINE, DEST_PYTHON_ENGINE, {
  recursive: true,
  force: true,
});
process.stdout.write("Copied python_engine/ into dist-main/python_engine/\n");

await cp(SRC_BUILD_ASSETS, DEST_BUILD_ASSETS, {
  recursive: true,
  force: true,
});
process.stdout.write("Copied build/ into dist-main/build/\n");

try {
  await access(SRC_PYTHON_DEPS);
  await cp(SRC_PYTHON_DEPS, DEST_PYTHON_DEPS, {
    recursive: true,
    force: true,
  });
  process.stdout.write("Copied python_deps/ into dist-main/python_deps/\n");
} catch {
  process.stdout.write(
    "No python_deps/ directory found; skipping bundled Python deps copy.\n",
  );
}
