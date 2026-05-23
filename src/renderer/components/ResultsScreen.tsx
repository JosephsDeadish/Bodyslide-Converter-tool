import type {
  ConversionAuditCheck,
  ConversionOperation,
  ConversionPlan,
  ConversionResult,
  ConvertedFile,
  DetectionResult,
  ScanResult,
  SkippedFile,
} from "../api-types";

interface ResultsScreenProps {
  result: ScanResult;
  onNewConversion(): void;
}

export function ResultsScreen({ result, onNewConversion }: ResultsScreenProps) {
  const {
    detection,
    plan,
    result: conversion,
    reportPath,
    summaryPath,
  } = result;
  const warnings = [
    ...new Set([...(plan.warnings ?? []), ...(conversion.warnings ?? [])]),
  ];

  return (
    <div className="screen active">
      <div className="results-header">
        <h2>Conversion Results</h2>
        <span className="badge badge-success">
          {detection.bodyType.toUpperCase()} →{" "}
          {conversion.targetBodyType.toUpperCase()}
        </span>
      </div>

      <div className="card-grid">
        <div className="card">
          <h3>Detection</h3>
          <DetectionCard
            detection={detection}
            filesAnalyzed={conversion.filesAnalyzed}
          />
        </div>
        <div className="card">
          <h3>Conversion Plan &amp; Output</h3>
          <PlanCard conversion={conversion} plan={plan} />
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="card warnings">
          <h3>⚠ Warnings</h3>
          <ul id="warningsList">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="output-path-row">
        <span>Report:</span>
        <code>{reportPath}</code>
      </div>
      <div className="output-path-row">
        <span>Summary:</span>
        <code>{summaryPath}</code>
      </div>

      <div className="results-footer">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onNewConversion}
        >
          ← New Conversion
        </button>
      </div>
    </div>
  );
}

function DetectionCard({
  detection,
  filesAnalyzed,
}: {
  detection: DetectionResult;
  filesAnalyzed: number;
}) {
  const confPct = Math.round(detection.confidence * 100);
  const signals = (detection.matchedSignals ?? []).slice(0, 5);

  return (
    <>
      <div className="detection-type">{detection.bodyType.toUpperCase()}</div>
      <div className="conf-label">Confidence: {confPct}%</div>
      <div className="conf-bar">
        <div className="conf-fill" style={{ width: `${confPct}%` }} />
      </div>

      {detection.rankedCandidates.length > 0 && (
        <>
          <div className="candidates-title">Top matches</div>
          {detection.rankedCandidates.map((c) => {
            const pct = Math.round(c.share * 100);
            return (
              <div key={c.bodyType} className="candidate-row">
                <span className="candidate-name">{c.bodyType}</span>
                <div className="candidate-bar">
                  <div
                    className="candidate-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="candidate-pct">{pct}%</span>
              </div>
            );
          })}
        </>
      )}

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#8888b8" }}>
        Files scanned: {filesAnalyzed}
      </div>

      {signals.length > 0 && (
        <>
          <div className="result-section-title">Matched signals</div>
          <ul className="meta-list">
            {signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function PlanCard({
  conversion,
  plan,
}: {
  conversion: ConversionResult;
  plan: ConversionPlan;
}) {
  return (
    <>
      <div className="result-stats">
        <span>
          {conversion.conversionMode === "native"
            ? "Native path"
            : "Compatibility path"}
        </span>
        <span>{conversion.conversionPath}</span>
        <span>Alias: {conversion.preferredOutputAlias}</span>
        <span>{conversion.convertedFiles.length} converted</span>
        <span>{conversion.skippedFiles.length} safe copies</span>
      </div>

      <div className="result-section-title">Naming notes</div>
      <ul className="meta-list">
        {conversion.namingNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <div className="result-section-title">
        Conversion audit ({conversion.audit.overallStatus})
      </div>
      <ul className="op-list">
        {conversion.audit.checks.map((check) => (
          <AuditCheckItem key={check.id} check={check} />
        ))}
      </ul>

      <div className="result-section-title">Generated conversion plan</div>
      <ul className="op-list">
        {plan.operations.map((op) => (
          <OperationItem key={op.id} op={op} />
        ))}
      </ul>

      <div className="result-section-title">Converted files</div>
      <ul className="op-list">
        {conversion.convertedFiles.length === 0 ? (
          <li className="op-item">
            <div className="op-name">No files converted</div>
            <div className="op-desc">
              The selected mod did not contain files supported by the current
              native converter.
            </div>
          </li>
        ) : (
          conversion.convertedFiles.map((f) => (
            <ConvertedFileItem key={f.outputPath} file={f} />
          ))
        )}
      </ul>

      {conversion.skippedFiles.length > 0 && (
        <>
          <div className="result-section-title">Safe copied files</div>
          <ul className="op-list">
            {conversion.skippedFiles.map((f) => (
              <SkippedFileItem key={f.outputPath} file={f} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function AuditCheckItem({ check }: { check: ConversionAuditCheck }) {
  return (
    <li className="op-item">
      <div className="op-name">
        [{check.status}] {check.title}
      </div>
      <div className="op-desc">{check.summary}</div>
      {check.details.length > 0 && (
        <div className="op-desc">{check.details.join(" • ")}</div>
      )}
    </li>
  );
}

function OperationItem({ op }: { op: ConversionOperation }) {
  return (
    <li className="op-item">
      <div className="op-name">{op.name}</div>
      <div className="op-desc">{op.description}</div>
    </li>
  );
}

function ConvertedFileItem({ file }: { file: ConvertedFile }) {
  return (
    <li className="op-item">
      <div className="op-name">{file.outputPath}</div>
      <div className="op-desc">
        {file.kind} • {file.action} • source: {file.sourcePath}
      </div>
    </li>
  );
}

function SkippedFileItem({ file }: { file: SkippedFile }) {
  return (
    <li className="op-item">
      <div className="op-name">{file.outputPath}</div>
      <div className="op-desc">
        {file.reason} • source: {file.sourcePath}
      </div>
    </li>
  );
}
