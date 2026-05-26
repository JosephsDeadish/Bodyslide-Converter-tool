import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";
import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { listBodyTypeOptions } from "./bodyTypes.js";
import { filterFilesForMalePass } from "./conversionScope.js";
import { convertMod } from "./converter.js";
import { detectBodyType } from "./detector.js";
import { runPythonEngine } from "./engine/pythonEngine.js";
import { buildExecutedOperations } from "./executedOperations.js";
import { createConversionPlan } from "./planner.js";
import { generateRepairArtifacts } from "./repairArtifacts.js";
import { scanModFiles } from "./scanner.js";
import type {
  BodyType,
  ConversionAuditCheck,
  ConversionJobEvent,
  ConversionResult,
  ConversionRunArgs,
  EngineQualityGate,
  EngineStageReport,
  PythonEngineRunSummary,
} from "./types.js";

const PATREON_SUPPORT_URL = "https://www.patreon.com/cw/DeadOnTheInside";
const ICON_CANDIDATES = ["build/icon.ico", "build/icon.icns", "build/icon.png"];

type ScanResult = {
  detection: Awaited<ReturnType<typeof detectBodyType>>;
  plan: ReturnType<typeof createConversionPlan>;
  result: ConversionResult;
  reportPath: string;
  summaryPath: string;
};

type JobStatus = {
  stage:
    | "queued"
    | "scan"
    | "python-engine"
    | "conversion"
    | "reports"
    | "done";
  message: string;
  progress: number;
};

async function resolveAppIconPath(): Promise<string | null> {
  const roots = [process.cwd(), __dirname, resolve(__dirname, "..")];
  for (const root of roots) {
    for (const relativeIconPath of ICON_CANDIDATES) {
      const absoluteIconPath = resolve(root, relativeIconPath);
      try {
        await access(absoluteIconPath, constants.R_OK);
        return absoluteIconPath;
      } catch {
        // Continue through candidate list.
      }
    }
  }
  return null;
}

async function createWindow(): Promise<BrowserWindow> {
  const iconPath = await resolveAppIconPath();
  const windowOptions: Record<string, unknown> = {
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
  };
  if (iconPath) {
    windowOptions.icon = iconPath;
  }
  const win = new BrowserWindow(windowOptions);

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.editFlags.canCut) template.push({ role: "cut" });
    if (params.editFlags.canCopy && params.selectionText.trim().length > 0) {
      template.push({ role: "copy" });
    }
    if (params.editFlags.canPaste) template.push({ role: "paste" });
    if (params.editFlags.canSelectAll) template.push({ role: "selectAll" });

    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  void win.loadFile(join(__dirname, "renderer", "index.html"));
  win.setMenuBarVisibility(false);
  return win;
}

app
  .whenReady()
  .then(async () => {
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
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

ipcMain.handle("get:bodyTypes", () => listBodyTypeOptions());

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

const activeJobs = new Map<string, number>();

ipcMain.handle(
  "scan:startJob",
  async (event: IpcMainInvokeEvent, args: ConversionRunArgs) => {
    const jobId = randomUUID();
    activeJobs.set(jobId, event.sender.id);

    sendJobEvent(event.sender, {
      jobId,
      type: "status",
      stage: "queued",
      progress: 0,
      message: "Queued conversion job.",
    });

    void runJob(event.sender, jobId, args);
    return { jobId };
  },
);

ipcMain.handle(
  "scan:run",
  async (_event: IpcMainInvokeEvent, args: ConversionRunArgs) =>
    executeConversion(args),
);

ipcMain.handle("open:patreonSupport", async () => {
  await shell.openExternal(PATREON_SUPPORT_URL);
  return true;
});

ipcMain.handle(
  "open:outputFolder",
  async (_event: IpcMainInvokeEvent, folderPath: string) => {
    await shell.openPath(folderPath);
    return true;
  },
);

function sendJobEvent(
  contents: IpcMainInvokeEvent["sender"],
  event: ConversionJobEvent,
): void {
  contents.send("scan:jobEvent", event);
}

async function runJob(
  sender: IpcMainInvokeEvent["sender"],
  jobId: string,
  args: ConversionRunArgs,
): Promise<void> {
  try {
    const result = await executeConversion(args, (status) => {
      sendJobEvent(sender, {
        jobId,
        type: "status",
        stage: status.stage,
        message: status.message,
        progress: status.progress,
      });
    });

    sendJobEvent(sender, {
      jobId,
      type: "complete",
      result,
    });
  } catch (err) {
    sendJobEvent(sender, {
      jobId,
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    activeJobs.delete(jobId);
  }
}

async function executeConversion(
  args: ConversionRunArgs,
  onStatus?: (status: JobStatus) => void,
): Promise<ScanResult> {
  const { input, target, output, sourceOverride, maleSource, maleTarget } =
    args;
  const physicsProfile = args.physicsProfile ?? "auto";

  if (resolve(input) === resolve(output)) {
    throw new Error(
      "Input and output directories must be different. Using the same folder as both input and output would overwrite your source files.",
    );
  }

  onStatus?.({
    stage: "scan",
    message: "Scanning mod files and detecting source body.",
    progress: 10,
  });

  const files = await scanModFiles(input);
  const autoDetection = detectBodyType(files);
  const detection =
    sourceOverride && sourceOverride !== autoDetection.bodyType
      ? { ...autoDetection, bodyType: sourceOverride as BodyType | "unknown" }
      : autoDetection;

  const plan = createConversionPlan(detection, target, files);

  onStatus?.({
    stage: "python-engine",
    message: "Running Python core geometry pipeline.",
    progress: 20,
  });

  const pythonSourceType =
    detection.bodyType === "unknown" ? target : detection.bodyType;
  const pythonSummary = await runPythonEngine(
    {
      inputPath: input,
      outputPath: output,
      sourceBodyType: pythonSourceType,
      targetBodyType: target,
      files,
    },
    {
      onProgress: (event) => {
        onStatus?.({
          stage: "python-engine",
          message: event.message,
          progress: Math.min(
            65,
            Math.max(20, Math.round(20 + event.progress * 0.45)),
          ),
        });
      },
    },
  );

  onStatus?.({
    stage: "conversion",
    message: "Applying conversion outputs and compatibility remaps.",
    progress: 70,
  });

  const result = await convertMod(input, output, files, detection, target, {
    physicsProfile,
  });
  applyPythonSummaryToAudit(result, pythonSummary);

  // ── Male conversion pass (mixed-gender mods) ─────────────────────────────
  if (maleSource && maleTarget) {
    onStatus?.({
      stage: "conversion",
      message: "Running male body conversion pass.",
      progress: 75,
    });
    const maleSourceType = maleSource as BodyType;
    const maleTargetType = maleTarget as BodyType;
    const maleFiles = filterFilesForMalePass(files, maleSourceType);
    if (maleFiles.length > 0) {
      const maleDetection = { ...detection, bodyType: maleSourceType };
      const maleResult = await convertMod(
        input,
        output,
        maleFiles,
        maleDetection,
        maleTargetType,
        {
          physicsProfile,
        },
      );
      result.convertedFiles = [
        ...result.convertedFiles,
        ...maleResult.convertedFiles,
      ];
      result.skippedFiles = [
        ...result.skippedFiles,
        ...maleResult.skippedFiles,
      ];
      result.warnings = [
        ...new Set([...result.warnings, ...maleResult.warnings]),
      ];
      result.namingNotes = [
        ...new Set([...result.namingNotes, ...maleResult.namingNotes]),
      ];
    } else {
      result.warnings = [
        ...new Set([
          ...result.warnings,
          `Mixed-gender male pass skipped: no assets matched male-source hints for ${maleSourceType.toUpperCase()}.`,
        ]),
      ];
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  onStatus?.({
    stage: "reports",
    message: "Writing conversion report and summary files.",
    progress: 90,
  });

  const reportsDir = join(output, "_SlideSmith");
  await mkdir(reportsDir, { recursive: true });
  const repairArtifacts = await generateRepairArtifacts({
    reportsDir,
    sourceBodyType: pythonSourceType,
    targetBodyType: target,
    pythonSummary,
  });
  if (repairArtifacts.length > 0) {
    result.warnings = [
      ...new Set([
        ...result.warnings,
        `Generated ${repairArtifacts.length} repair helper file(s) in _SlideSmith/repairs for missing assets/metadata follow-up.`,
      ]),
    ];
  }
  plan.operations = buildExecutedOperations({
    filesAnalyzed: files.length,
    conversion: result,
    pythonSummary,
    repairArtifactsCount: repairArtifacts.length,
  });

  const reportPath = join(reportsDir, "conversion-report.json");
  const summaryPath = join(reportsDir, "conversion-summary.txt");

  await writeFile(
    reportPath,
    `${JSON.stringify({ detection, plan, result, repairArtifacts }, null, 2)}\n`,
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
      `PHYSICS PROFILE (SELECTED): ${result.requestedPhysicsProfile}`,
      `PHYSICS PROFILE (EFFECTIVE): ${result.effectivePhysicsProfile}`,
      `OUTPUT ALIAS: ${result.preferredOutputAlias}`,
      ``,
      detection.rankedCandidates.length > 0
        ? `Top candidates: ${detection.rankedCandidates.map((c) => `${c.bodyType} ${Math.round(c.share * 100)}%`).join(" | ")}`
        : `No strong candidates detected.`,
      ``,
      `CONVERSION ACTIONS EXECUTED`,
      `===========================`,
      ...plan.operations.map(
        (operation, i) =>
          `${i + 1}. ${operation.name}\n   ${operation.description}`,
      ),
      ``,
      `CONVERSION WARNINGS`,
      `===================`,
      ...plan.warnings.map((warning, i) => `${i + 1}. ${warning}`),
      ``,
      `PYTHON CORE ENGINE`,
      `==================`,
      `Run ID: ${pythonSummary.runId}`,
      `Backend: ${pythonSummary.backend}`,
      ...pythonSummary.stages.map(
        (stage, i) =>
          `${i + 1}. [${stage.status}] ${stage.title}\n   ${stage.summary}`,
      ),
      ...pythonSummary.qualityGates.map(
        (gate, i) =>
          `${i + 1 + pythonSummary.stages.length}. [${gate.status}] ${gate.id}\n   ${gate.summary}`,
      ),
      ...pythonSummary.warnings.map(
        (warning, i) =>
          `${i + 1 + pythonSummary.stages.length + pythonSummary.qualityGates.length}. [attention] warning\n   ${warning}`,
      ),
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
      ``,
      `REPAIR ARTIFACTS`,
      `================`,
      ...(repairArtifacts.length > 0
        ? repairArtifacts.map(
            (artifact, i) =>
              `${i + 1}. ${artifact.relativePath}\n   ${artifact.description}`,
          )
        : ["No repair artifacts were required for this run."]),
    ].join("\n"),
    "utf8",
  );

  onStatus?.({
    stage: "done",
    message: "Conversion completed.",
    progress: 100,
  });

  return { detection, plan, result, reportPath, summaryPath };
}

function applyPythonSummaryToAudit(
  result: ConversionResult,
  summary: PythonEngineRunSummary,
): void {
  result.pythonEngine = summary;

  const stageChecks = summary.stages.map((stage) =>
    createAuditCheckFromStage(stage, "python-stage"),
  );
  const gateChecks = summary.qualityGates.map((gate) =>
    createAuditCheckFromQualityGate(gate),
  );
  const warningChecks = summary.warnings.map((warning, index) => ({
    id: `python-warning-${index + 1}`,
    title: "Python core engine warning",
    status: "attention" as const,
    summary: warning,
    details: ["Conversion continued in compatibility-safe fallback mode."],
    evidence: [],
  }));

  result.audit.checks.push(...stageChecks, ...gateChecks, ...warningChecks);
  if (result.audit.checks.some((check) => check.status === "attention")) {
    result.audit.overallStatus = "attention";
  }

  result.warnings = [...new Set([...result.warnings, ...summary.warnings])];
}

function createAuditCheckFromStage(
  stage: EngineStageReport,
  prefix: string,
): ConversionAuditCheck {
  return {
    id: `${prefix}-${stage.id}`,
    title: `${stage.title} (Python core)`,
    status: stage.status,
    summary: stage.summary,
    details: stage.details,
    evidence: [],
  };
}

function createAuditCheckFromQualityGate(
  gate: EngineQualityGate,
): ConversionAuditCheck {
  return {
    id: `python-gate-${gate.id}`,
    title: `${gate.id} gate`,
    status: gate.status,
    summary: gate.summary,
    details: ["Generated by Python core quality-gate pass."],
    evidence: [],
  };
}
