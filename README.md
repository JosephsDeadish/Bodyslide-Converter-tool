# SlideSmith

Modern Electron + React desktop app and TypeScript CLI for scanning armor/clothing mod folders, auto-detecting likely source body type, and running conversion passes for supported target body types.

The desktop path now uses a **Python core conversion engine** (invoked by Electron main process) for staged mesh/geometry pipeline orchestration.

## Supported target body types

- cbbe
- 3ba
- himbo
- bodytalk
- tbd
- sos
- unp
- bhunp
- uunp
- 7base
- sam
- vanilla

## Quick start

```bash
npm install
npm run build
node dist/index.js --input /path/to/mod --target 3ba --output /path/to/output
```

## Build runnable EXE

To build the Electron desktop app locally:

```bash
npm install
npm run build:main
npm run build:renderer
```

To package a Windows portable executable:

```bash
npm install
npm run package:win
```

Output:

- `release/SlideSmith.exe`

The command generates:

- `conversion-report.json` with detection scores and conversion metadata
- `conversion-summary.txt` with converted files, ranked body-type candidates, warnings, and a structured conversion audit
- converted mod assets written into the selected output folder

## Python core engine (desktop conversion backend)

The Electron app orchestrates conversion jobs, while geometry/math stages are delegated to `python_engine/runner.py`.

### Architecture boundary

- Renderer: UI only (contextBridge API; no filesystem or geometry operations)
- Electron main: IPC/job lifecycle + report writing + process orchestration
- Python core: staged mesh pipeline and quality gates

### Reference database

`python_engine/slidesmith_engine/references/body_reference_db.json` is now the canonical source for per-body transfer metadata used by the Python core stage checks.  
Each body entry must define:

- `topology`, `topologyReference`, and `canonicalVertexMap`
- `sliderMappings` (canonical slider key -> body slider name)
- `boneMap` (canonical bone chain -> body bone name)
- `morphEquivalents` (canonical morph key -> body-specific morph/zap name)

The Python engine actively consumes these mappings for reference-body validation, weight-transfer readiness, morph/zap transfer readiness, TRI gating, and physics-bone coverage checks.
High-quality stages now require both `topologyReference` and `canonicalVertexMap` in addition to the mapping dictionaries; if either body is missing them, the Python runner downgrades surface reprojection, weight transfer, morph transfer, and TRI generation to fallback mode.

### Install Python dependencies (recommended)

```bash
python -m pip install -r python_engine/requirements.txt
```

`PyNifly`, `numpy`, `scipy`, `trimesh`, and `pyvista` are treated as runtime capability gates by the Python core. Missing packages leave the app usable, but force degraded fallback reporting for NIF IO, surface reprojection, smoothing, cleanup, and TRI/morph generation stages.

If Python is not on `PATH`, set:

```bash
SLIDESMITH_PYTHON=/absolute/path/to/python
```

## Notes

- Detection is heuristic-based and inspects filenames plus file previews.
- Native conversion currently supports same-body output, same-gender cross-family adaptation, vanilla compatibility adaptation, and cross-gender outfit adaptation. Named compatibility paths include CBBE ↔ 3BA ↔ TBD, UNP ↔ UUNP ↔ BHUNP ↔ 7Base, and HIMBO ↔ SAM ↔ BodyTalk ↔ SOS.
- Generated output file names are normalized to canonical target body aliases (for example `3BA`, `BHUNP`, `UUNP`, `HIMBO`, and `SAM`) to make BodySlide outputs easier to identify.
- Cross-gender adaptation also rewrites common gendered asset markers such as `femalebody`/`malebody` and first-person hand paths so generated outputs line up with the selected target gender.
- The CLI summary, JSON report, and desktop app all include the generated conversion path metadata plus structured conversion-plan operations for manual follow-up.
- Generated outputs now apply automatic naming, gender-marker, and physics-reference harmonization; use BodySlide preview plus in-game checks for high-risk topology/cross-gender cases.
- Native conversion now auto-synthesizes missing `_0`/`_1` `.nif` weight-pair meshes when only one side exists, improving in-game weight-slider completeness.
- Native conversion now auto-synthesizes a BodySlide SliderSet `.osp` file when mesh outputs exist but no project file was provided, so converted outfits still appear directly in BodySlide without manual project setup.
- Reports now include a structured conversion audit that checks extracted mesh/slider assets, BodySlide slider-set generation, topology risk, and target physics-config coverage (including 3BA belly-chain validation).
- Physics config auditing now requires full target-bone marker coverage before passing the check, helping catch partial/incomplete config remaps.
- Physics-bone remapping now includes semantic cross-body matching (breast/butt/belly/genitals chains with side/level handling) before fallback collapse, improving compatibility across physics-capable body-type pairs.
- Detection and conversion metadata now includes UBE alias coverage under UUNP-family support and softbody physics-profile aliases for 3BA/BHUNP-style projects.
- Physics remapping now recognizes additional compact bone-token variants seen in some CBPC configs (for example `NPC LBreast01`, `NPC RButt01`) to improve cross-body conversion reliability.
- Body knowledge metadata now includes per-target skeleton guidance (including XPMSSE/XP32 expectations for physics-capable Skyrim SE bodies) and surfaces that guidance in conversion warnings and target info.
- The desktop sidebar now includes a **Support on Patreon** button that opens https://www.patreon.com/cw/DeadOnTheInside in your browser.
- CI workflow (`.github/workflows/build.yml`) runs lint/test/build and also publishes a Windows EXE artifact bundle (`slidesmith-release`) for workflow-run approval and testing.
- Packaging remains standard `electron-builder` output (no obfuscation/self-extractors/UPX). For production release trust, add Windows code signing in your release pipeline.
