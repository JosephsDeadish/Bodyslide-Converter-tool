import { contextBridge, ipcRenderer } from "electron";
import type { BodyTypeInfo } from "./bodyTypeInfo.js";
import type {
  BodyType,
  ConversionJobEvent,
  ConversionPlan,
  ConversionResult,
  ConversionRunArgs,
  DetectionResult,
} from "./types.js";

export type BodyTypeOption = { value: BodyType; label: string };
export type ScanResult = {
  detection: DetectionResult;
  plan: ConversionPlan;
  result: ConversionResult;
  reportPath: string;
  summaryPath: string;
};

const JOB_EVENT_CHANNEL = "scan:jobEvent";

contextBridge.exposeInMainWorld("bodyslideAPI", {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openDirectory"),

  getBodyTypes: (): Promise<BodyTypeOption[]> =>
    ipcRenderer.invoke("get:bodyTypes"),

  detectSource: (input: string): Promise<DetectionResult> =>
    ipcRenderer.invoke("scan:detect", input),

  getBodyTypeInfo: (bodyType: BodyType): Promise<BodyTypeInfo | null> =>
    ipcRenderer.invoke("get:bodyTypeInfo", bodyType),

  runScan: (args: ConversionRunArgs): Promise<ScanResult> =>
    ipcRenderer.invoke("scan:run", args),

  startScanJob: (args: ConversionRunArgs): Promise<{ jobId: string }> =>
    ipcRenderer.invoke("scan:startJob", args),

  onScanJobEvent: (
    listener: (event: ConversionJobEvent) => void,
  ): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown) => {
      listener(payload as ConversionJobEvent);
    };
    ipcRenderer.on(JOB_EVENT_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(JOB_EVENT_CHANNEL, wrapped);
    };
  },

  openPatreonSupport: (): Promise<boolean> =>
    ipcRenderer.invoke("open:patreonSupport"),

  openOutputFolder: (folderPath: string): Promise<boolean> =>
    ipcRenderer.invoke("open:outputFolder", folderPath),
});
