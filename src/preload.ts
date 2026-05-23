import { contextBridge, ipcRenderer } from "electron";
import type { BodyTypeInfo } from "./bodyTypeInfo.js";
import type { BodyType, ConversionResult, DetectionResult } from "./types.js";

export type BodyTypeOption = { value: BodyType; label: string };
export type ScanResult = {
  detection: DetectionResult;
  result: ConversionResult;
  reportPath: string;
  summaryPath: string;
};

contextBridge.exposeInMainWorld("bodyslideAPI", {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke<string | null>("dialog:openDirectory"),

  getBodyTypes: (): Promise<BodyTypeOption[]> =>
    ipcRenderer.invoke<BodyTypeOption[]>("get:bodyTypes"),

  getBodyTypeInfo: (bodyType: BodyType): Promise<BodyTypeInfo | null> =>
    ipcRenderer.invoke<BodyTypeInfo | null>("get:bodyTypeInfo", bodyType),

  runScan: (args: {
    input: string;
    target: BodyType;
    output: string;
  }): Promise<ScanResult> => ipcRenderer.invoke<ScanResult>("scan:run", args),
});
