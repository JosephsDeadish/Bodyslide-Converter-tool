import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { detectBodyType } from "./detector.js";
import { createConversionPlan } from "./planner.js";
import { scanModFiles } from "./scanner.js";
import type { BodyType } from "./types.js";
import { BODY_TYPES } from "./types.js";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: "Bodyslide Converter",
    backgroundColor: "#0d0d1a",
    show: false,
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  void win.loadFile(join(__dirname, "renderer", "index.html"));
  win.setMenuBarVisibility(false);
  return win;
}

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((err: unknown) => {
    process.stderr.write(String(err));
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:openDirectory", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
  return canceled ? null : (filePaths[0] ?? null);
});

ipcMain.handle("get:bodyTypes", () =>
  BODY_TYPES.map((bt) => ({
    value: bt,
    label: BODY_TYPE_INFO[bt].displayName,
  })),
);

ipcMain.handle("get:bodyTypeInfo", (_event, bodyType: BodyType) => {
  const info = BODY_TYPE_INFO[bodyType];
  return info ?? null;
});

ipcMain.handle(
  "scan:run",
  async (_event, args: { input: string; target: BodyType; output: string }) => {
    const { input, target, output } = args;

    const files = await scanModFiles(input);
    const detection = detectBodyType(files);
    const plan = createConversionPlan(detection, target, files);

    await mkdir(output, { recursive: true });

    const reportPath = join(output, "conversion-report.json");
    const planPath = join(output, "conversion-plan.txt");

    await writeFile(
      reportPath,
      `${JSON.stringify({ detection, plan }, null, 2)}\n`,
      "utf8",
    );

    await writeFile(
      planPath,
      [
        `Bodyslide Converter — Conversion Plan`,
        `Generated: ${plan.generatedAt}`,
        `Files analyzed: ${plan.filesAnalyzed}`,
        ``,
        `SOURCE: ${detection.bodyType} (confidence ${Math.round(detection.confidence * 100)}%)`,
        `TARGET: ${target}`,
        ``,
        detection.rankedCandidates.length > 0
          ? `Top candidates: ${detection.rankedCandidates.map((c) => `${c.bodyType} ${Math.round(c.share * 100)}%`).join(" | ")}`
          : `No strong candidates detected.`,
        ``,
        `PLANNED OPERATIONS`,
        `==================`,
        ...plan.operations.map(
          (op, i) => `${i + 1}. ${op.name}\n   ${op.description}`,
        ),
        ``,
        `WARNINGS`,
        `========`,
        ...plan.warnings.map((w, i) => `${i + 1}. ${w}`),
      ].join("\n"),
      "utf8",
    );

    return { detection, plan, reportPath, planPath };
  },
);
