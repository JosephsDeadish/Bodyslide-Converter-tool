/// <reference types="vite/client" />

import type {
  BodyType,
  BodyTypeInfo,
  BodyTypeOption,
  DetectionResult,
  ScanResult,
} from "./api-types";

declare global {
  interface Window {
    bodyslideAPI: {
      openDirectory(): Promise<string | null>;
      getBodyTypes(): Promise<BodyTypeOption[]>;
      detectSource(input: string): Promise<DetectionResult>;
      getBodyTypeInfo(bodyType: BodyType): Promise<BodyTypeInfo | null>;
      runScan(args: {
        input: string;
        target: BodyType;
        output: string;
        sourceOverride?: BodyType;
      }): Promise<ScanResult>;
      openPatreonSupport(): Promise<boolean>;
    };
  }
}
