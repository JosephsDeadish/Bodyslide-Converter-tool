# SlideSmith

Modern TypeScript CLI and desktop app for scanning armor/clothing mod folders, auto-detecting likely source body type, and running a native conversion pass for supported target body types.

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
- CI workflow (`.github/workflows/build.yml`) runs lint/test/build and also publishes a Windows EXE artifact bundle (`slidesmith-release`) for workflow-run approval and testing.
