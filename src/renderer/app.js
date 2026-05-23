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

const screenWelcome = document.getElementById("screenWelcome");
const screenLoading = document.getElementById("screenLoading");
const screenResults = document.getElementById("screenResults");
const screenError = document.getElementById("screenError");

const detectionBody = document.getElementById("detectionBody");
const planBody = document.getElementById("planBody");
const warningsBlock = document.getElementById("warningsBlock");
const warningsList = document.getElementById("warningsList");
const resultBadge = document.getElementById("resultBadge");
const outputPathResult = document.getElementById("outputPathResult");
const errorMsg = document.getElementById("errorMsg");
const errorBackBtn = document.getElementById("errorBackBtn");

// ── State ───────────────────────────────────────────────────────
let inputPath = "";
let outputPath = "";

// ── Init ────────────────────────────────────────────────────────
(async function init() {
  const types = await api.getBodyTypes();
  targetSelect.innerHTML = '<option value="">— Select target body —</option>';
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t.value;
    opt.textContent = t.label;
    targetSelect.appendChild(opt);
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
    <div class="info-name">${info.displayName}</div>
    <div class="info-tags">${genderTag}${physTag}</div>
    <div>${info.description}</div>
    <div class="info-notes" style="margin-top:6px;font-size:11px;color:#7a7aaa;"><strong>Conversion notes:</strong> ${info.conversionNotes}</div>
  `;
  bodyInfoBox.classList.remove("hidden");
});

// ── Convert ─────────────────────────────────────────────────────
convertBtn.addEventListener("click", async () => {
  const target = targetSelect.value;
  if (!inputPath || !outputPath || !target) return;

  showScreen("loading");
  setStatus("scanning");

  try {
    const result = await api.runScan({
      input: inputPath,
      target,
      output: outputPath,
    });
    renderResults(result);
    showScreen("results");
    setStatus("success");
  } catch (err) {
    errorMsg.textContent = err instanceof Error ? err.message : String(err);
    showScreen("error");
    setStatus("error");
  }
});

errorBackBtn.addEventListener("click", () => {
  showScreen("welcome");
  setStatus("idle");
});

// ── Render helpers ──────────────────────────────────────────────
function renderResults(result) {
  const { detection, result: conversion, reportPath } = result;

  // Result badge
  resultBadge.textContent = `${detection.bodyType.toUpperCase()} → ${conversion.targetBodyType.toUpperCase()}`;
  resultBadge.className = "badge badge-success";

  // Detection card
  const confPct = Math.round(detection.confidence * 100);
  let candidatesHtml = "";
  if (detection.rankedCandidates && detection.rankedCandidates.length > 0) {
    candidatesHtml = `<div class="candidates-title">Top matches</div>`;
    for (const c of detection.rankedCandidates) {
      const pct = Math.round(c.share * 100);
      candidatesHtml += `
        <div class="candidate-row">
          <span class="candidate-name">${c.bodyType}</span>
          <div class="candidate-bar"><div class="candidate-fill" style="width:${pct}%"></div></div>
          <span class="candidate-pct">${pct}%</span>
        </div>`;
    }
  }
  detectionBody.innerHTML = `
    <div class="detection-type">${detection.bodyType.toUpperCase()}</div>
    <div class="conf-label">Confidence: ${confPct}%</div>
    <div class="conf-bar"><div class="conf-fill" style="width:${confPct}%"></div></div>
    ${candidatesHtml}
    <div style="margin-top:10px;font-size:12px;color:#8888b8">Files scanned: ${conversion.filesAnalyzed}</div>
  `;

  // Conversion card
  let opsHtml = '<ul class="op-list">';
  for (const file of conversion.convertedFiles) {
    opsHtml += `
      <li class="op-item">
        <div class="op-name">${file.outputPath}</div>
        <div class="op-desc">${file.kind} • ${file.action} • source: ${file.sourcePath}</div>
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
  planBody.innerHTML = opsHtml;

  // Warnings
  if (conversion.warnings && conversion.warnings.length > 0) {
    warningsList.innerHTML = conversion.warnings
      .map((w) => `<li>${w}</li>`)
      .join("");
    warningsBlock.classList.remove("hidden");
  } else {
    warningsBlock.classList.add("hidden");
  }

  // Output path
  outputPathResult.textContent = reportPath;
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
