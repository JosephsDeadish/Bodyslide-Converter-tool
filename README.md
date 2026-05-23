# Bodyslide-Converter-tool

Modern TypeScript CLI for scanning armor/clothing mod folders, auto-detecting likely source body type, and running a native conversion pass for supported target body types.

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
- `conversion-summary.txt` with converted files, ranked body-type candidates, and warnings
- converted mod assets written into the selected output folder

## Notes

- Detection is heuristic-based and inspects filenames plus file previews.
- Native conversion currently supports same-body output plus asset-safe paths for CBBE ↔ 3BA and UNP ↔ UUNP.
- Generated outputs should still be reviewed in Outfit Studio/NifSkope.
- CI workflow (`.github/workflows/build.yml`) runs lint/test/build and also publishes a Windows EXE artifact (`bodyslide-converter-windows-exe`) for workflow-run approval and testing.
