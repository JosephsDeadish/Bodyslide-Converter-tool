import type {
  BodyTypeInfo,
  BodyTypeOption,
  DetectionResult,
} from "../api-types";

type Status = "idle" | "scanning" | "success" | "error";

interface SidebarProps {
  inputPath: string;
  outputPath: string;
  bodyTypes: BodyTypeOption[];
  targetBodyType: string;
  bodyTypeInfo: BodyTypeInfo | null;
  detecting: boolean;
  detectResult: DetectionResult | null;
  sourceOverride: string;
  status: Status;
  canConvert: boolean;
  onBrowseInput(): void;
  onBrowseOutput(): void;
  onTargetChange(value: string): void;
  onSourceOverrideChange(value: string): void;
  onConvert(): void;
  onPatreon(): void;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "Idle",
  scanning: "Scanning…",
  success: "Done",
  error: "Error",
};

export function Sidebar({
  inputPath,
  outputPath,
  bodyTypes,
  targetBodyType,
  bodyTypeInfo,
  detecting,
  detectResult,
  sourceOverride,
  status,
  canConvert,
  onBrowseInput,
  onBrowseOutput,
  onTargetChange,
  onSourceOverrideChange,
  onConvert,
  onPatreon,
}: SidebarProps) {
  const showDetect = Boolean(inputPath);
  const detectedType = detectResult?.bodyType;
  const confPct = detectResult ? Math.round(detectResult.confidence * 100) : 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <span className="logo">⚙</span>
        <span>SlideSmith</span>
      </div>

      <div className="form-section">
        <div className="field-label" style={{ marginTop: "1rem" }}>
          Source Mod Folder
        </div>
        <div className="path-row">
          <input
            className="path-input"
            type="text"
            placeholder="Select folder…"
            value={inputPath}
            readOnly
          />
          <button
            type="button"
            className="btn btn-secondary"
            title="Browse"
            onClick={onBrowseInput}
          >
            📁
          </button>
        </div>

        {showDetect && (
          <div className="source-detect-section">
            <div className="field-label" style={{ marginTop: "1rem" }}>
              Detected Source Body
            </div>
            <div className="source-detect-status">
              {detecting ? (
                <span className="source-detect-value source-detect-scanning">
                  Scanning…
                </span>
              ) : detectedType === "unknown" ? (
                <span className="source-detect-value source-detect-unknown">
                  Unknown — no body signals found
                </span>
              ) : detectedType !== undefined ? (
                <span className="source-detect-value source-detect-found">
                  {detectedType.toUpperCase()} — {confPct}% confidence
                </span>
              ) : (
                <span className="source-detect-value source-detect-unknown">
                  Detection failed
                </span>
              )}
            </div>
            <div className="field-label" style={{ marginTop: "0.6rem" }}>
              Override Source Body
            </div>
            <div className="field-hint">
              App recommendation is used by default — change only if detection
              is wrong
            </div>
            <select
              className="select-control"
              style={{ marginTop: "4px" }}
              value={sourceOverride}
              onChange={(e) => onSourceOverrideChange(e.target.value)}
            >
              <option value="">Use auto-detected</option>
              {bodyTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <div className="field-label">Convert To — Output Body Type</div>
          <div className="field-hint">
            Select which body type you want the mod converted to
          </div>
        </div>
        <select
          className="select-control"
          style={{ marginTop: "4px" }}
          value={targetBodyType}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">— Select output body —</option>
          {bodyTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {bodyTypeInfo !== null && <BodyInfoBox info={bodyTypeInfo} />}

        <div className="field-label" style={{ marginTop: "1rem" }}>
          Output Folder
        </div>
        <div className="path-row">
          <input
            className="path-input"
            type="text"
            placeholder="Select folder…"
            value={outputPath}
            readOnly
          />
          <button
            type="button"
            className="btn btn-secondary"
            title="Browse"
            onClick={onBrowseOutput}
          >
            📁
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!canConvert}
          onClick={onConvert}
        >
          ▶ Convert
        </button>
      </div>

      <div className="sidebar-footer">
        <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
        <button
          type="button"
          className="btn btn-secondary btn-support"
          onClick={onPatreon}
        >
          ❤ Support on Patreon
        </button>
      </div>
    </aside>
  );
}

function BodyInfoBox({ info }: { info: BodyTypeInfo }) {
  const genderLabel =
    info.gender === "both"
      ? "Any gender"
      : info.gender === "male"
        ? "♂ Male"
        : "♀ Female";

  return (
    <div className="body-info-box">
      <div className="info-name">{info.displayName}</div>
      <div className="info-tags">
        <span className="tag">{genderLabel}</span>
        {info.physicsSupport ? (
          <span className="tag physics">⚡ Physics (CBPC/HDT-SMP)</span>
        ) : (
          <span className="tag">No physics</span>
        )}
      </div>
      <div>{info.description}</div>
      <div className="info-notes">
        <strong>Skeleton profile:</strong> {info.skeletonProfile} —{" "}
        {info.skeletonNotes}
      </div>
      <div className="info-notes">
        <strong>Conversion notes:</strong> {info.conversionNotes}
      </div>
    </div>
  );
}
