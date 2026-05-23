# Bodyslide-Converter-tool

Modern TypeScript CLI for scanning armor/clothing mod folders, auto-detecting likely source body type, and generating a conversion plan for a target body type.

## Supported target body types

- cbbe
- 3ba
- himbo
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

To build a Windows executable locally:

```bash
npm install
npm run build:exe
```

Output:

- `release/bodyslide-converter.exe`

To validate packaging in Linux/macOS environments:

```bash
npm run build:exe:linux
```

The command generates:

- `conversion-report.json` with detection scores and conversion metadata
- `conversion-plan.txt` with ordered conversion steps, ranked body-type candidates, and warnings

## Notes

- Detection is heuristic-based and inspects filenames plus file previews.
- Generated plans are intended to speed up conversion workflows and should still be reviewed in Outfit Studio/NifSkope.
- CI workflow (`.github/workflows/build.yml`) runs lint/test/build and also publishes a Windows EXE artifact (`bodyslide-converter-windows-exe`) for workflow-run approval and testing.
