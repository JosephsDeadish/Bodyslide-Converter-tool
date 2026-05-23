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

  getBodyTypeInfo: (bodyType: BodyType): Promise<BodyTypeInfo | null> =>
    ipcRenderer.invoke("get:bodyTypeInfo", bodyType),

  runScan: (args: {
    input: string;
    target: BodyType;
    output: string;
  }): Promise<ScanResult> => ipcRenderer.invoke("scan:run", args),
});
