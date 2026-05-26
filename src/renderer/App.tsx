import { useEffect, useState } from "react";
import type {
  BodyType,
  BodyTypeInfo,
  BodyTypeOption,
  ConversionJobEvent,
  ConversionPhysicsProfile,
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

function normalizePhysicsProfileForTarget(
  profile: ConversionPhysicsProfile,
  bodyTypeInfo: BodyTypeInfo | null,
): ConversionPhysicsProfile {
  if (!bodyTypeInfo) return profile;
  if (!bodyTypeInfo.physicsSupport) return "none";
  if (profile === "none" || profile === "auto") return profile;
  if (profile === "dual") {
    if (bodyTypeInfo.cbpcCompatible && bodyTypeInfo.hdtSmpCompatible) {
      return "dual";
    }
    if (bodyTypeInfo.hdtSmpCompatible) return "hdt-smp";
    if (bodyTypeInfo.cbpcCompatible) return "cbpc";
    return "none";
  }
  if (profile === "cbpc") {
    if (bodyTypeInfo.cbpcCompatible) return "cbpc";
    if (bodyTypeInfo.hdtSmpCompatible) return "hdt-smp";
    return "none";
  }
  if (profile === "hdt-smp" || profile === "softbody") {
    if (bodyTypeInfo.hdtSmpCompatible) return profile;
    if (bodyTypeInfo.cbpcCompatible) return "cbpc";
    return "none";
  }
  return profile;
}

export function App() {
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [outputPathAuto, setOutputPathAuto] = useState(false);
  const [bodyTypes, setBodyTypes] = useState<BodyTypeOption[]>([]);
  const [targetBodyType, setTargetBodyType] = useState("");
  const [bodyTypeInfo, setBodyTypeInfo] = useState<BodyTypeInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectionResult | null>(
    null,
  );
  const [sourceOverride, setSourceOverride] = useState("");
  const [physicsProfile, setPhysicsProfile] =
    useState<ConversionPhysicsProfile>("auto");
  const [mixedGender, setMixedGender] = useState(false);
  const [maleSource, setMaleSource] = useState("");
  const [maleTarget, setMaleTarget] = useState("");
  const [maleBodyTypeInfo, setMaleBodyTypeInfo] = useState<BodyTypeInfo | null>(
    null,
  );
  const [malePhysicsProfile, setMalePhysicsProfile] =
    useState<ConversionPhysicsProfile>("auto");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [status, setStatus] = useState<Status>("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(
    "Converting mod assets…",
  );
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [loadingStage, setLoadingStage] = useState<string>("");

  useEffect(() => {
    void api.getBodyTypes().then(setBodyTypes);
  }, []);

  useEffect(() => {
    const unsubscribe = api.onScanJobEvent((event: ConversionJobEvent) => {
      if (activeJobId === null || event.jobId !== activeJobId) return;
      if (event.type === "status") {
        setLoadingMessage(`${event.message} (${event.progress}%)`);
        setLoadingProgress(event.progress);
        setLoadingStage(event.stage);
        return;
      }
      if (event.type === "complete") {
        setScanResult(event.result);
        setStatus("success");
        setScreen("results");
        setActiveJobId(null);
        setLoadingProgress(100);
        return;
      }
      if (event.type === "error") {
        setErrorMsg(event.error);
        setStatus("error");
        setScreen("error");
        setActiveJobId(null);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [activeJobId]);

  useEffect(() => {
    const normalized = normalizePhysicsProfileForTarget(
      physicsProfile,
      bodyTypeInfo,
    );
    if (normalized !== physicsProfile) {
      setPhysicsProfile(normalized);
    }
  }, [bodyTypeInfo, physicsProfile]);

  useEffect(() => {
    const normalized = normalizePhysicsProfileForTarget(
      malePhysicsProfile,
      maleBodyTypeInfo,
    );
    if (normalized !== malePhysicsProfile) {
      setMalePhysicsProfile(normalized);
    }
  }, [maleBodyTypeInfo, malePhysicsProfile]);

  async function handleBrowseInput() {
    const path = await api.openDirectory();
    if (!path) return;
    setInputPath(path);
    const autoOut = `${path}-bodyslide-output`;
    if (!outputPath || outputPathAuto) {
      setOutputPath(autoOut);
      setOutputPathAuto(true);
    }
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
    if (path) {
      setOutputPath(path);
      setOutputPathAuto(false);
    }
  }

  function handleClearInput() {
    setInputPath("");
    setDetectResult(null);
    setSourceOverride("");
    setMixedGender(false);
    setMaleSource("");
    setMaleTarget("");
    setMaleBodyTypeInfo(null);
    setMalePhysicsProfile("auto");
    if (outputPathAuto) {
      setOutputPath("");
      setOutputPathAuto(false);
    }
  }

  function handleClearOutput() {
    setOutputPath("");
    setOutputPathAuto(false);
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

  async function handleMaleTargetChange(value: string) {
    setMaleTarget(value);
    if (!value) {
      setMaleBodyTypeInfo(null);
      return;
    }
    const info = await api.getBodyTypeInfo(value as BodyType);
    setMaleBodyTypeInfo(info);
  }

  async function handleConvert() {
    if (!inputPath || !outputPath || !targetBodyType || !sourceOverride) return;
    if (mixedGender && (!maleSource || !maleTarget)) return;
    setScreen("loading");
    setStatus("scanning");
    setLoadingMessage("Starting conversion job…");
    setLoadingProgress(0);
    setLoadingStage("queued");
    try {
      const { jobId } = await api.startScanJob({
        input: inputPath,
        target: targetBodyType as BodyType,
        output: outputPath,
        sourceOverride: sourceOverride as BodyType,
        physicsProfile,
        ...(mixedGender && maleSource && maleTarget
          ? {
              maleSource: maleSource as BodyType,
              maleTarget: maleTarget as BodyType,
              malePhysicsProfile,
            }
          : {}),
      });
      setActiveJobId(jobId);
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

  async function handleOpenOutputFolder() {
    if (!outputPath) return;
    try {
      await api.openOutputFolder(outputPath);
    } catch {
      // Best-effort: silently ignore if the folder doesn't exist yet
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
        outputPathAuto={outputPathAuto}
        bodyTypes={bodyTypes}
        targetBodyType={targetBodyType}
        bodyTypeInfo={bodyTypeInfo}
        detecting={detecting}
        detectResult={detectResult}
        sourceOverride={sourceOverride}
        physicsProfile={physicsProfile}
        maleBodyTypeInfo={maleBodyTypeInfo}
        malePhysicsProfile={malePhysicsProfile}
        mixedGender={mixedGender}
        maleSource={maleSource}
        maleTarget={maleTarget}
        status={status}
        canConvert={Boolean(
          inputPath &&
            outputPath &&
            targetBodyType &&
            sourceOverride &&
            (!mixedGender || (maleSource && maleTarget)),
        )}
        onBrowseInput={() => {
          void handleBrowseInput();
        }}
        onBrowseOutput={() => {
          void handleBrowseOutput();
        }}
        onClearInput={handleClearInput}
        onClearOutput={handleClearOutput}
        onTargetChange={(v) => {
          void handleTargetChange(v);
        }}
        onSourceOverrideChange={setSourceOverride}
        onMixedGenderChange={setMixedGender}
        onPhysicsProfileChange={setPhysicsProfile}
        onMaleSourceChange={setMaleSource}
        onMaleTargetChange={(v) => {
          void handleMaleTargetChange(v);
        }}
        onMalePhysicsProfileChange={setMalePhysicsProfile}
        onConvert={() => {
          void handleConvert();
        }}
        onPatreon={() => {
          void handlePatreon();
        }}
      />
      <main className="content">
        {screen === "welcome" && <WelcomeScreen />}
        {screen === "loading" && (
          <LoadingScreen
            message={loadingMessage}
            progress={loadingProgress}
            stage={loadingStage}
          />
        )}
        {screen === "results" && scanResult !== null && (
          <ResultsScreen
            result={scanResult}
            outputPath={outputPath}
            onNewConversion={handleBack}
            onOpenOutputFolder={() => {
              void handleOpenOutputFolder();
            }}
          />
        )}
        {screen === "error" && (
          <ErrorScreen message={errorMsg} onBack={handleBack} />
        )}
      </main>
    </div>
  );
}
