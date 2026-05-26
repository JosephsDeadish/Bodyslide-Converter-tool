/// <reference types="vite/client" />

import type {
  BodyType,
  BodyTypeInfo,
  BodyTypeOption,
  ConversionJobEvent,
  ConversionRunArgs,
  DetectionResult,
  ScanResult,
  UserPreferences,
} from "./api-types";

declare global {
  interface Window {
    bodyslideAPI: {
      openDirectory(): Promise<string | null>;
      getBodyTypes(): Promise<BodyTypeOption[]>;
      detectSource(input: string): Promise<DetectionResult>;
      getBodyTypeInfo(bodyType: BodyType): Promise<BodyTypeInfo | null>;
      runScan(args: ConversionRunArgs): Promise<ScanResult>;
      startScanJob(args: ConversionRunArgs): Promise<{ jobId: string }>;
      onScanJobEvent(listener: (event: ConversionJobEvent) => void): () => void;
      openPatreonSupport(): Promise<boolean>;
      openOutputFolder(folderPath: string): Promise<boolean>;
      loadPreferences(): Promise<UserPreferences>;
      savePreferences(prefs: UserPreferences): Promise<boolean>;
    };
  }
}
