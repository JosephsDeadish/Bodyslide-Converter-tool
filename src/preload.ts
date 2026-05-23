import { contextBridge, ipcRenderer } from "electron";
import type { BodyTypeInfo } from "./bodyTypeInfo.js";
import type {
  BodyType,
  ConversionPlan,
  ConversionResult,
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

contextBridge.exposeInMainWorld("bodyslideAPI", {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openDirectory"),

  getBodyTypes: (): Promise<BodyTypeOption[]> =>
    ipcRenderer.invoke("get:bodyTypes"),

  detectSource: (input: string): Promise<DetectionResult> =>
    ipcRenderer.invoke("scan:detect", input),

  getBodyTypeInfo: (bodyType: BodyType): Promise<BodyTypeInfo | null> =>
    ipcRenderer.invoke("get:bodyTypeInfo", bodyType),

  runScan: (args: {
    input: string;
    target: BodyType;
    output: string;
    sourceOverride?: BodyType;
  }): Promise<ScanResult> => ipcRenderer.invoke("scan:run", args),

  openPatreonSupport: (): Promise<boolean> =>
    ipcRenderer.invoke("open:patreonSupport"),
});
