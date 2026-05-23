import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
} from "electron";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { convertMod } from "./converter.js";
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
    title: "SlideSmith",
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

ipcMain.handle("dialog:openDirectory", async (event: IpcMainInvokeEvent) => {
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

ipcMain.handle(
  "scan:detect",
  async (_event: IpcMainInvokeEvent, input: string) => {
    const files = await scanModFiles(input);
    return detectBodyType(files);
  },
);

ipcMain.handle(
  "get:bodyTypeInfo",
  (_event: IpcMainInvokeEvent, bodyType: BodyType) => {
    const info = BODY_TYPE_INFO[bodyType];
    return info ?? null;
  },
);

ipcMain.handle(
  "scan:run",
  async (
    _event: IpcMainInvokeEvent,
    args: {
      input: string;
      target: BodyType;
      output: string;
      sourceOverride?: BodyType;
    },
  ) => {
    const { input, target, output, sourceOverride } = args;

    const files = await scanModFiles(input);
    const autoDetection = detectBodyType(files);

    // Allow the user to override the auto-detected source body type.
    const detection =
      sourceOverride && sourceOverride !== autoDetection.bodyType
        ? { ...autoDetection, bodyType: sourceOverride as BodyType | "unknown" }
        : autoDetection;
    const plan = createConversionPlan(detection, target, files);
    const result = await convertMod(input, output, files, detection, target);

    await mkdir(output, { recursive: true });

    // Reports go into a dedicated subfolder so MO2's virtual filesystem does
    // not surface them as Skyrim game assets inside the conversion output mod.
    const reportsDir = join(output, "_SlideSmith");
    await mkdir(reportsDir, { recursive: true });

    const reportPath = join(reportsDir, "conversion-report.json");
    const summaryPath = join(reportsDir, "conversion-summary.txt");

    await writeFile(
      reportPath,
      `${JSON.stringify({ detection, plan, result }, null, 2)}\n`,
      "utf8",
    );

    await writeFile(
      summaryPath,
      [
        `SlideSmith — Conversion Summary`,
        `Generated: ${result.generatedAt}`,
        `Files analyzed: ${result.filesAnalyzed}`,
        ``,
        `SOURCE: ${detection.bodyType} (confidence ${Math.round(detection.confidence * 100)}%)`,
        `TARGET: ${target}`,
        `MODE: ${result.conversionMode}`,
        `PATH: ${result.conversionPath}`,
        `OUTPUT ALIAS: ${result.preferredOutputAlias}`,
        ``,
        detection.rankedCandidates.length > 0
          ? `Top candidates: ${detection.rankedCandidates.map((c) => `${c.bodyType} ${Math.round(c.share * 100)}%`).join(" | ")}`
          : `No strong candidates detected.`,
        ``,
        `CONVERSION PLAN`,
        `===============`,
        ...plan.operations.map(
          (operation, i) =>
            `${i + 1}. ${operation.name}\n   ${operation.description}`,
        ),
        ``,
        `PLAN WARNINGS`,
        `=============`,
        ...plan.warnings.map((warning, i) => `${i + 1}. ${warning}`),
        ``,
        `NAMING NOTES`,
        `============`,
        ...result.namingNotes.map((note, i) => `${i + 1}. ${note}`),
        ``,
        `CONVERSION AUDIT`,
        `================`,
        `Overall status: ${result.audit.overallStatus}`,
        ...result.audit.checks.map(
          (check, i) =>
            `${i + 1}. [${check.status}] ${check.title}\n   ${check.summary}${check.details.length > 0 ? `\n   ${check.details.join("\n   ")}` : ""}`,
        ),
        ``,
        `CONVERTED FILES`,
        `===============`,
        ...result.convertedFiles.map(
          (file, i) =>
            `${i + 1}. [${file.kind}/${file.action}] ${file.sourcePath}\n   -> ${file.outputPath}`,
        ),
        ``,
        `WARNINGS`,
        `========`,
        ...result.warnings.map((w, i) => `${i + 1}. ${w}`),
      ].join("\n"),
      "utf8",
    );

    return { detection, plan, result, reportPath, summaryPath };
  },
);
