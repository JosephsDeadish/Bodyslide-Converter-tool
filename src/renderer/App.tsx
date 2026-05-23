import { useEffect, useState } from "react";
import type {
  BodyType,
  BodyTypeInfo,
  BodyTypeOption,
  DetectionResult,
  ScanResult,
} from "./api-types";
import { ErrorScreen } from "./components/ErrorScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { ResultsScreen } from "./components/ResultsScreen";
import { Sidebar } from "./components/Sidebar";
import { WelcomeScreen } from "./components/WelcomeScreen";

const api = window.bodyslideAPI;

type Screen = "welcome" | "loading" | "results" | "error";
type Status = "idle" | "scanning" | "success" | "error";

export function App() {
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [bodyTypes, setBodyTypes] = useState<BodyTypeOption[]>([]);
  const [targetBodyType, setTargetBodyType] = useState("");
  const [bodyTypeInfo, setBodyTypeInfo] = useState<BodyTypeInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectionResult | null>(
    null,
  );
  const [sourceOverride, setSourceOverride] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [status, setStatus] = useState<Status>("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    void api.getBodyTypes().then(setBodyTypes);
  }, []);

  async function handleBrowseInput() {
    const path = await api.openDirectory();
    if (!path) return;
    setInputPath(path);
    if (!outputPath) setOutputPath(`${path}-bodyslide-output`);
    setDetectResult(null);
    setSourceOverride("");
    setDetecting(true);
    try {
      const detection = await api.detectSource(path);
      setDetectResult(detection);
    } finally {
      setDetecting(false);
    }
  }

  async function handleBrowseOutput() {
    const path = await api.openDirectory();
    if (path) setOutputPath(path);
  }

  async function handleTargetChange(value: string) {
    setTargetBodyType(value);
    if (!value) {
      setBodyTypeInfo(null);
      return;
    }
    const info = await api.getBodyTypeInfo(value as BodyType);
    setBodyTypeInfo(info);
  }

  async function handleConvert() {
    if (!inputPath || !outputPath || !targetBodyType) return;
    setScreen("loading");
    setStatus("scanning");
    try {
      const result = await api.runScan({
        input: inputPath,
        target: targetBodyType as BodyType,
        output: outputPath,
        sourceOverride: sourceOverride
          ? (sourceOverride as BodyType)
          : undefined,
      });
      setScanResult(result);
      setScreen("results");
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setScreen("error");
      setStatus("error");
    }
  }

  async function handlePatreon() {
    try {
      await api.openPatreonSupport();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setScreen("error");
      setStatus("error");
    }
  }

  function handleBack() {
    setScreen("welcome");
    setStatus("idle");
  }

  return (
    <div className="layout">
      <Sidebar
        inputPath={inputPath}
        outputPath={outputPath}
        bodyTypes={bodyTypes}
        targetBodyType={targetBodyType}
        bodyTypeInfo={bodyTypeInfo}
        detecting={detecting}
        detectResult={detectResult}
        sourceOverride={sourceOverride}
        status={status}
        canConvert={Boolean(inputPath && outputPath && targetBodyType)}
        onBrowseInput={() => {
          void handleBrowseInput();
        }}
        onBrowseOutput={() => {
          void handleBrowseOutput();
        }}
        onTargetChange={(v) => {
          void handleTargetChange(v);
        }}
        onSourceOverrideChange={setSourceOverride}
        onConvert={() => {
          void handleConvert();
        }}
        onPatreon={() => {
          void handlePatreon();
        }}
      />
      <main className="content">
        {screen === "welcome" && <WelcomeScreen />}
        {screen === "loading" && <LoadingScreen />}
        {screen === "results" && scanResult !== null && (
          <ResultsScreen result={scanResult} onNewConversion={handleBack} />
        )}
        {screen === "error" && (
          <ErrorScreen message={errorMsg} onBack={handleBack} />
        )}
      </main>
    </div>
  );
}
