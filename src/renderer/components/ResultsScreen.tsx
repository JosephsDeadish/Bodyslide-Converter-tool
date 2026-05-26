import type {
  ConversionAuditCheck,
  ConversionOperation,
  ConversionPlan,
  ConversionResult,
  ConvertedFile,
  DetectionResult,
  PythonEngineRunSummary,
  ScanResult,
  SkippedFile,
} from "../api-types";
import { Tooltip } from "./Tooltip";

interface ResultsScreenProps {
  result: ScanResult;
  outputPath: string;
  onNewConversion(): void;
  onOpenOutputFolder(): void;
}

export function ResultsScreen({
  result,
  outputPath,
  onNewConversion,
  onOpenOutputFolder,
}: ResultsScreenProps) {
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
        <Tooltip
          text={`Successfully converted from ${detection.bodyType.toUpperCase()} to ${conversion.targetBodyType.toUpperCase()}. Your mod is now living its best life.`}
        >
          <span className="badge badge-success">
            {detection.bodyType.toUpperCase()} →{" "}
            {conversion.targetBodyType.toUpperCase()}
          </span>
        </Tooltip>
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
          <h3>Conversion Output</h3>
          <PipelineCard conversion={conversion} plan={plan} />
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="card warnings">
          <Tooltip text="These warnings don't stop the conversion, but they mean SlideSmith noticed something worth double-checking. Like that one NPC who always clips through chairs.">
            <h3>⚠ Warnings</h3>
          </Tooltip>
          <ul id="warningsList">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {conversion.pythonEngine && (
        <PythonEngineCard engine={conversion.pythonEngine} />
      )}

      <div className="output-path-row">
        <Tooltip text="Full path to the machine-readable JSON report. Great for debugging or confirming exactly what SlideSmith did to your mod.">
          <span>Report:</span>
        </Tooltip>
        <code>{reportPath}</code>
      </div>
      <div className="output-path-row">
        <Tooltip text="Human-readable summary file. Perfect for copying into a Nexus post so everyone knows what conversion you ran.">
          <span>Summary:</span>
        </Tooltip>
        <code>{summaryPath}</code>
      </div>

      <div className="results-footer">
        <div className="results-footer-row">
          <Tooltip text="← Head back to the main screen to convert another mod. Your growth as a BodySlide converter is immeasurable.">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onNewConversion}
            >
              ← New Conversion
            </button>
          </Tooltip>
          {outputPath && (
            <Tooltip text="📂 Opens the output folder in your file manager so you can install the converted mod. Or just stare at the files in existential wonder.">
              <button
                type="button"
                className="btn-open-folder"
                onClick={onOpenOutputFolder}
              >
                📂 Open Output Folder
              </button>
            </Tooltip>
          )}
        </div>
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
  const packagingTags = [
    detection.packaging.fomod ? "FOMOD" : null,
    detection.packaging.mo2 ? "MO2" : null,
    detection.packaging.vortex ? "Vortex" : null,
  ].filter((tag): tag is string => tag !== null);

  return (
    <>
      <Tooltip
        text={`Detected body type: ${detection.bodyType.toUpperCase()}. ${confPct >= 70 ? "High confidence — this is probably right." : "Lower confidence — consider double-checking with the source override."}`}
      >
        <div className="detection-type">{detection.bodyType.toUpperCase()}</div>
      </Tooltip>
      <Tooltip
        text={`Confidence score: ${confPct}%. Based on file paths, slider names, and mesh signals found in the mod.`}
      >
        <div className="conf-label">Confidence: {confPct}%</div>
      </Tooltip>
      <div className="conf-bar">
        <div className="conf-fill" style={{ width: `${confPct}%` }} />
      </div>

      {detection.rankedCandidates.length > 0 && (
        <>
          <Tooltip text="All body types ranked by match score. The top candidate wins. It's like a democracy, but the vote is based on file paths.">
            <div className="candidates-title">Top matches</div>
          </Tooltip>
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

      <Tooltip
        text={`We scanned ${filesAnalyzed} files in your mod. Every. Single. One. You're welcome.`}
      >
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#8888b8" }}>
          Files scanned: {filesAnalyzed}
        </div>
      </Tooltip>

      {packagingTags.length > 0 && (
        <>
          <Tooltip text="Packaging formats detected in the mod. These are preserved in the output so your converted mod installs cleanly through FOMOD, MO2, or Vortex.">
            <div className="result-section-title">Detected packaging</div>
          </Tooltip>
          <div className="result-stats">
            {packagingTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </>
      )}

      {signals.length > 0 && (
        <>
          <Tooltip text="The specific file paths and keywords that tipped off the body type detection. CSI: BodySlide Edition.">
            <div className="result-section-title">Matched signals</div>
          </Tooltip>
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

function PipelineCard({
  conversion,
  plan,
}: {
  conversion: ConversionResult;
  plan: ConversionPlan;
}) {
  return (
    <>
      <div className="result-stats">
        <Tooltip
          text={
            conversion.conversionMode === "native"
              ? "Native path: SlideSmith has a first-class adapter for this body pair. Maximum quality."
              : "Compatibility path: no direct adapter — SlideSmith did its best and it's pretty good."
          }
        >
          <span>
            {conversion.conversionMode === "native"
              ? "Native path"
              : "Compatibility path"}
          </span>
        </Tooltip>
        <Tooltip text="The internal conversion route taken. Useful if you're debugging or just curious how the sausage gets made.">
          <span>{conversion.conversionPath}</span>
        </Tooltip>
        <Tooltip text="The preferred BodySlide output folder alias used in the converted project files. This is how your output will appear in BodySlide's filter list.">
          <span>Alias: {conversion.preferredOutputAlias}</span>
        </Tooltip>
        <Tooltip text="Files that were actively rewritten (mesh/text data converted). These are the ones that got the full treatment.">
          <span>{conversion.convertedFiles.length} converted</span>
        </Tooltip>
        <Tooltip text="Files that were preserved, synthesized, or excluded without direct conversion rewrites.">
          <span>{conversion.skippedFiles.length} non-converted decisions</span>
        </Tooltip>
      </div>

      {conversion.namingNotes.length > 0 && (
        <>
          <Tooltip text="Notes about how SlideSmith named things in the output. Mostly informational — unless something looks weird, in which case: noted.">
            <div className="result-section-title">Naming notes</div>
          </Tooltip>
          <ul className="meta-list">
            {conversion.namingNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}

      <Tooltip text="The conversion audit runs a series of checks on the output. Pass = all good. Attention = worth reviewing — not necessarily broken, just notable.">
        <div className="result-section-title">
          Conversion audit ({conversion.audit.overallStatus})
        </div>
      </Tooltip>
      <ul className="op-list">
        {conversion.audit.checks.map((check) => (
          <AuditCheckItem key={check.id} check={check} />
        ))}
      </ul>

      <Tooltip text="Execution stages SlideSmith completed during this run.">
        <div className="result-section-title">Executed pipeline stages</div>
      </Tooltip>
      <ul className="op-list">
        {plan.operations.map((op) => (
          <OperationItem key={op.id} op={op} />
        ))}
      </ul>

      <Tooltip text="Every file that was converted. If this list is empty, the mod may not have had BodySlide-compatible assets in paths the converter recognizes.">
        <div className="result-section-title">Converted files</div>
      </Tooltip>
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
          <Tooltip text="Files that were preserved, synthesized, or excluded based on conversion scope and post-processing safeguards.">
            <div className="result-section-title">Non-converted file decisions</div>
          </Tooltip>
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
  const statusEmoji =
    check.status === "pass" ? "✅" : check.status === "attention" ? "⚠" : "—";
  return (
    <Tooltip
      text={
        check.details.length > 0 ? check.details.join(" • ") : check.summary
      }
    >
      <li className="op-item">
        <div className="op-name">
          {statusEmoji} {check.title}
        </div>
        <div className="op-desc">{check.summary}</div>
      </li>
    </Tooltip>
  );
}

function OperationItem({ op }: { op: ConversionOperation }) {
  return (
    <Tooltip text={op.description}>
      <li className="op-item">
        <div className="op-name">{op.name}</div>
        <div className="op-desc">{op.description}</div>
      </li>
    </Tooltip>
  );
}

function ConvertedFileItem({ file }: { file: ConvertedFile }) {
  return (
    <Tooltip
      text={`Source: ${file.sourcePath} | Kind: ${file.kind} | Action: ${file.action}`}
    >
      <li className="op-item">
        <div className="op-name">{file.outputPath}</div>
        <div className="op-desc">
          {file.kind} • {file.action} • source: {file.sourcePath}
        </div>
      </li>
    </Tooltip>
  );
}

function SkippedFileItem({ file }: { file: SkippedFile }) {
  return (
    <Tooltip text={`Reason: ${file.reason} | Source: ${file.sourcePath}`}>
      <li className="op-item">
        <div className="op-name">{file.outputPath}</div>
        <div className="op-desc">
          {file.reason} • source: {file.sourcePath}
        </div>
      </li>
    </Tooltip>
  );
}

function PythonEngineCard({ engine }: { engine: PythonEngineRunSummary }) {
  const libs = engine.libraries;
  const libEntries = [
    { name: "pyffi", ok: libs.pyffi },
    { name: "numpy", ok: libs.numpy },
    { name: "scipy", ok: libs.scipy },
    { name: "trimesh", ok: libs.trimesh },
    { name: "pyvista", ok: libs.pyvista },
  ];
  return (
    <div className="card engine-summary" style={{ marginBottom: "16px" }}>
      <Tooltip text="The Python engine handles mesh-level operations: surface reprojection, weight transfer, morph transfer, and quality gates. Results from each stage are listed below.">
        <div className="engine-summary-title">Python Engine Report</div>
      </Tooltip>
      <div className="engine-lib-row">
        {libEntries.map((lib) => (
          <Tooltip
            key={lib.name}
            text={
              lib.ok
                ? `${lib.name} is available and working.`
                : `${lib.name} is missing! Some mesh operations may be degraded.`
            }
          >
            <span className={`engine-lib ${lib.ok ? "ok" : "missing"}`}>
              {lib.ok ? "✓" : "✗"} {lib.name}
            </span>
          </Tooltip>
        ))}
      </div>
      {engine.stages.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          {engine.stages.map((s) => (
            <Tooltip
              key={s.id}
              text={s.details.length > 0 ? s.details.join(" • ") : s.summary}
            >
              <div className="engine-stage-row">
                <span className={`stage-dot ${s.status}`} />
                <span>{s.title}</span>
                <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
                  — {s.summary}
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
      )}
      {engine.warnings.length > 0 && (
        <ul className="meta-list" style={{ marginTop: "6px" }}>
          {engine.warnings.map((w) => (
            <li key={w} style={{ color: "#e0c070" }}>
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
