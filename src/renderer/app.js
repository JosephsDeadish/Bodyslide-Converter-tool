/* global window.bodyslideAPI */

const api = window.bodyslideAPI;

// ── DOM refs ────────────────────────────────────────────────────
const inputPathEl = document.getElementById("inputPath");
const outputPathEl = document.getElementById("outputPath");
const browseInputBtn = document.getElementById("browseInput");
const browseOutputBtn = document.getElementById("browseOutput");
const targetSelect = document.getElementById("targetSelect");
const bodyInfoBox = document.getElementById("bodyInfoBox");
const convertBtn = document.getElementById("convertBtn");
const statusBadge = document.getElementById("statusBadge");
const sourceDetectSection = document.getElementById("sourceDetectSection");
const sourceDetectLabel = document.getElementById("sourceDetectLabel");
const sourceOverrideSelect = document.getElementById("sourceOverrideSelect");

const screenWelcome = document.getElementById("screenWelcome");
const screenLoading = document.getElementById("screenLoading");
const screenResults = document.getElementById("screenResults");
const screenError = document.getElementById("screenError");

const detectionBody = document.getElementById("detectionBody");
const planBody = document.getElementById("planBody");
const warningsBlock = document.getElementById("warningsBlock");
const warningsList = document.getElementById("warningsList");
const resultBadge = document.getElementById("resultBadge");
const reportPathResult = document.getElementById("reportPathResult");
const summaryPathResult = document.getElementById("summaryPathResult");
const errorMsg = document.getElementById("errorMsg");
const errorBackBtn = document.getElementById("errorBackBtn");
const newConversionBtn = document.getElementById("newConversionBtn");
const supportPatreonBtn = document.getElementById("supportPatreonBtn");

// ── State ───────────────────────────────────────────────────────
let inputPath = "";
let outputPath = "";

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

// ── Init ────────────────────────────────────────────────────────
(async function init() {
  const types = await api.getBodyTypes();
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "— Select output body —";
  targetSelect.innerHTML = "";
  targetSelect.appendChild(defaultOpt);

  // Populate source-override select with the same list
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t.value;
    opt.textContent = t.label;
    targetSelect.appendChild(opt);

    const overrideOpt = document.createElement("option");
    overrideOpt.value = t.value;
    overrideOpt.textContent = t.label;
    sourceOverrideSelect.appendChild(overrideOpt);
  }
  updateConvertBtn();
})();

// ── Browse buttons ──────────────────────────────────────────────
browseInputBtn.addEventListener("click", async () => {
  const path = await api.openDirectory();
  if (path) {
    inputPath = path;
    inputPathEl.value = path;
    if (!outputPath) {
      outputPath = `${path}-bodyslide-output`;
      outputPathEl.value = outputPath;
    }
    updateConvertBtn();

    // Kick off a lightweight detect-only scan so the user can see (and
    // optionally override) the app's recommendation before converting.
    sourceDetectSection.classList.remove("hidden");
    sourceDetectLabel.textContent = "Scanning…";
    sourceDetectLabel.className = "source-detect-value source-detect-scanning";
    sourceOverrideSelect.value = "";

    try {
      const detection = await api.detectSource(path);
      const bodyType = detection.bodyType;
      const confPct = Math.round(detection.confidence * 100);
      if (bodyType === "unknown") {
        sourceDetectLabel.textContent = "Unknown — no body signals found";
        sourceDetectLabel.className =
          "source-detect-value source-detect-unknown";
      } else {
        sourceDetectLabel.textContent = `${bodyType.toUpperCase()} — ${confPct}% confidence`;
        sourceDetectLabel.className = "source-detect-value source-detect-found";
        // Pre-select the detected value in the override dropdown as a visible hint
        // without actually setting an override (the empty "Use auto-detected" entry is still default).
        // We highlight it via a data attribute for CSS, but keep value="" to mean "no override".
        sourceOverrideSelect.dataset.detected = bodyType;
      }
    } catch {
      sourceDetectLabel.textContent = "Detection failed";
      sourceDetectLabel.className = "source-detect-value source-detect-unknown";
    }
  }
});

browseOutputBtn.addEventListener("click", async () => {
  const path = await api.openDirectory();
  if (path) {
    outputPath = path;
    outputPathEl.value = path;
    updateConvertBtn();
  }
});

// ── Body type info panel ────────────────────────────────────────
targetSelect.addEventListener("change", async () => {
  const val = targetSelect.value;
  updateConvertBtn();
  if (!val) {
    bodyInfoBox.classList.add("hidden");
    return;
  }
  const info = await api.getBodyTypeInfo(val);
  if (!info) {
    bodyInfoBox.classList.add("hidden");
    return;
  }
  const physTag = info.physicsSupport
    ? `<span class="tag physics">⚡ Physics (CBPC/HDT-SMP)</span>`
    : `<span class="tag">No physics</span>`;
  const genderTag = `<span class="tag">${info.gender === "both" ? "Any gender" : info.gender === "male" ? "♂ Male" : "♀ Female"}</span>`;
  bodyInfoBox.innerHTML = `
    <div class="info-name">${escapeHtml(info.displayName)}</div>
    <div class="info-tags">${genderTag}${physTag}</div>
    <div>${escapeHtml(info.description)}</div>
    <div class="info-notes"><strong>Skeleton profile:</strong> ${escapeHtml(info.skeletonProfile)} — ${escapeHtml(info.skeletonNotes)}</div>
    <div class="info-notes"><strong>Conversion notes:</strong> ${escapeHtml(info.conversionNotes)}</div>
  `;
  bodyInfoBox.classList.remove("hidden");
});

// ── Convert ─────────────────────────────────────────────────────
convertBtn.addEventListener("click", async () => {
  const target = targetSelect.value;
  if (!inputPath || !outputPath || !target) return;

  convertBtn.disabled = true;
  showScreen("loading");
  setStatus("scanning");

  try {
    const sourceOverride = sourceOverrideSelect.value || undefined;
    const result = await api.runScan({
      input: inputPath,
      target,
      output: outputPath,
      sourceOverride,
    });
    renderResults(result);
    showScreen("results");
    setStatus("success");
  } catch (err) {
    errorMsg.textContent = err instanceof Error ? err.message : String(err);
    showScreen("error");
    setStatus("error");
  } finally {
    convertBtn.disabled = false;
  }
});

errorBackBtn.addEventListener("click", () => {
  showScreen("welcome");
  setStatus("idle");
});

newConversionBtn.addEventListener("click", () => {
  showScreen("welcome");
  setStatus("idle");
});

supportPatreonBtn.addEventListener("click", async () => {
  try {
    await api.openPatreonSupport();
  } catch (err) {
    errorMsg.textContent = err instanceof Error ? err.message : String(err);
    showScreen("error");
    setStatus("error");
  }
});

// ── Render helpers ──────────────────────────────────────────────
function renderResults(result) {
  const {
    detection,
    plan,
    result: conversion,
    reportPath,
    summaryPath,
  } = result;

  // Result badge
  resultBadge.textContent = `${detection.bodyType.toUpperCase()} → ${conversion.targetBodyType.toUpperCase()}`;
  resultBadge.className = "badge badge-success";

  // Detection card
  const confPct = Math.round(detection.confidence * 100);
  let candidatesHtml = "";
  if (detection.rankedCandidates && detection.rankedCandidates.length > 0) {
    candidatesHtml = '<div class="candidates-title">Top matches</div>';
    for (const c of detection.rankedCandidates) {
      const pct = Math.round(c.share * 100);
      candidatesHtml += `
        <div class="candidate-row">
          <span class="candidate-name">${escapeHtml(c.bodyType)}</span>
          <div class="candidate-bar"><div class="candidate-fill" style="width:${pct}%"></div></div>
          <span class="candidate-pct">${pct}%</span>
        </div>`;
    }
  }
  const matchedSignals = (detection.matchedSignals ?? [])
    .slice(0, 5)
    .map((signal) => `<li>${escapeHtml(signal)}</li>`)
    .join("");
  detectionBody.innerHTML = `
    <div class="detection-type">${escapeHtml(detection.bodyType.toUpperCase())}</div>
    <div class="conf-label">Confidence: ${confPct}%</div>
    <div class="conf-bar"><div class="conf-fill" style="width:${confPct}%"></div></div>
    ${candidatesHtml}
    <div style="margin-top:10px;font-size:12px;color:#8888b8">Files scanned: ${conversion.filesAnalyzed}</div>
    ${matchedSignals ? `<div class="result-section-title">Matched signals</div><ul class="meta-list">${matchedSignals}</ul>` : ""}
  `;

  // Conversion card
  let opsHtml = `
    <div class="result-stats">
      <span>${escapeHtml(conversion.conversionMode === "native" ? "Native path" : "Compatibility path")}</span>
      <span>${escapeHtml(conversion.conversionPath)}</span>
      <span>Alias: ${escapeHtml(conversion.preferredOutputAlias)}</span>
      <span>${conversion.convertedFiles.length} converted</span>
      <span>${conversion.skippedFiles.length} safe copies</span>
    </div>
    <div class="result-section-title">Naming notes</div>
    <ul class="meta-list">
      ${conversion.namingNotes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join("")}
    </ul>
    <div class="result-section-title">Conversion audit (${escapeHtml(conversion.audit.overallStatus)})</div>
    <ul class="op-list">
      ${conversion.audit.checks
        .map(
          (check) => `
            <li class="op-item">
              <div class="op-name">[${escapeHtml(check.status)}] ${escapeHtml(check.title)}</div>
              <div class="op-desc">${escapeHtml(check.summary)}</div>
              ${
                check.details.length > 0
                  ? `<div class="op-desc">${escapeHtml(check.details.join(" • "))}</div>`
                  : ""
              }
            </li>`,
        )
        .join("")}
    </ul>
    <div class="result-section-title">Generated conversion plan</div>
    <ul class="op-list">
      ${plan.operations
        .map(
          (operation) => `
            <li class="op-item">
              <div class="op-name">${escapeHtml(operation.name)}</div>
              <div class="op-desc">${escapeHtml(operation.description)}</div>
            </li>`,
        )
        .join("")}
    </ul>
    <div class="result-section-title">Converted files</div>
    <ul class="op-list">
  `;
  for (const file of conversion.convertedFiles) {
    opsHtml += `
      <li class="op-item">
        <div class="op-name">${escapeHtml(file.outputPath)}</div>
        <div class="op-desc">${escapeHtml(file.kind)} • ${escapeHtml(file.action)} • source: ${escapeHtml(file.sourcePath)}</div>
      </li>`;
  }
  if (conversion.convertedFiles.length === 0) {
    opsHtml += `
      <li class="op-item">
        <div class="op-name">No files converted</div>
        <div class="op-desc">The selected mod did not contain files supported by the current native converter.</div>
      </li>`;
  }
  opsHtml += "</ul>";
  if (conversion.skippedFiles.length > 0) {
    opsHtml += `
      <div class="result-section-title">Safe copied files</div>
      <ul class="op-list">
        ${conversion.skippedFiles
          .map(
            (file) => `
              <li class="op-item">
                <div class="op-name">${escapeHtml(file.outputPath)}</div>
                <div class="op-desc">${escapeHtml(file.reason)} • source: ${escapeHtml(file.sourcePath)}</div>
              </li>`,
          )
          .join("")}
      </ul>
    `;
  }
  planBody.innerHTML = opsHtml;

  // Warnings
  const warnings = [
    ...new Set([...(plan.warnings ?? []), ...(conversion.warnings ?? [])]),
  ];
  if (warnings.length > 0) {
    warningsList.innerHTML = warnings
      .map((w) => `<li>${escapeHtml(w)}</li>`)
      .join("");
    warningsBlock.classList.remove("hidden");
  } else {
    warningsBlock.classList.add("hidden");
  }

  // Output paths
  reportPathResult.textContent = reportPath;
  summaryPathResult.textContent = summaryPath;
}

// ── Screen / Status helpers ─────────────────────────────────────
function showScreen(name) {
  screenWelcome.classList.remove("active");
  screenLoading.classList.remove("active");
  screenResults.classList.remove("active");
  screenError.classList.remove("active");
  const map = {
    welcome: screenWelcome,
    loading: screenLoading,
    results: screenResults,
    error: screenError,
  };
  if (map[name]) map[name].classList.add("active");
}

function setStatus(state) {
  statusBadge.className = `badge badge-${state}`;
  const labels = {
    idle: "Idle",
    scanning: "Scanning…",
    success: "Done",
    error: "Error",
  };
  statusBadge.textContent = labels[state] || state;
}

function updateConvertBtn() {
  convertBtn.disabled = !(inputPath && outputPath && targetSelect.value);
}
