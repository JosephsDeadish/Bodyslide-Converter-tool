import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the Electron renderer (React/TSX) into dist-main/renderer/
// so electron-builder picks it up alongside the compiled main process.
export default defineConfig({
  plugins: [react()],
  base: "./",
  root: "src/renderer",
  build: {
    outDir: "../../dist-main/renderer",
    emptyOutDir: true,
    sourcemap: false,
  },
});
