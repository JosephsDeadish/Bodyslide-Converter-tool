import { Tooltip } from "./Tooltip";

export function WelcomeScreen() {
  return (
    <div className="screen active">
      <div className="welcome-card">
        <div className="welcome-icon">⚙</div>
        <h1>SlideSmith</h1>
        <p>
          Auto-detect your mod's body type and run a native BodySlide asset
          conversion for supported body paths.
        </p>
        <ul className="feature-list">
          <Tooltip
            dir="bottom"
            text="Detects 15 body types including all major female bodies (CBBE, 3BA, COCO, TBD, UNP, BHUNP, UUNP, UBE, 7base), male bodies (HIMBO, BodyTalk, SOS, SAM), and Vanilla."
          >
            <li>
              ✓ Detects CBBE, 3BA, COCO, HIMBO, TBD, SOS, UNP, BHUNP, UUNP, UBE,
              7base, SAM, BodyTalk, and Vanilla
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="Converted files are organized in a clean, MO2-ready folder structure. Your actual source files are untouched — we're polite like that."
          >
            <li>
              ✓ Writes converted assets into the selected output folder with
              MO2-ready folder structure
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="SlideSmith rewrites .osp, .xml, and config files to use the target body's naming. Manually editing XML is for people who enjoy pain."
          >
            <li>
              ✓ Rewrites BodySlide text assets for supported native conversions
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="FOMOD installers, MO2 metadata, and Vortex packaging are all detected and preserved so your converted mod installs cleanly."
          >
            <li>
              ✓ Recognizes FOMOD, MO2, and Vortex packaging signals and keeps
              installer-friendly output structure
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="Every conversion produces a detailed JSON report and a human-readable summary, stored in _SlideSmith/ inside the output. Kept separate from game assets so MO2 doesn't accidentally install them into Skyrim."
          >
            <li>
              ✓ Writes <code>conversion-summary.txt</code> and{" "}
              <code>conversion-report.json</code> to <code>_SlideSmith/</code>{" "}
              inside the output (kept separate from game assets)
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="Physics bone configs (CBPC/HDT-SMP) are analyzed and remapped to the correct bones for your target body. Breast chains, butt bones, belly nodes — all handled with care."
          >
            <li>
              ✓ Remaps physics bones (CBPC/HDT-SMP) for 3BA, BHUNP, UUNP, UBE,
              TBD, HIMBO, and more
            </li>
          </Tooltip>
          <Tooltip
            dir="bottom"
            text="Conversion audit checks source asset completeness, topology risk, target physics coverage, and more. A detailed report you'll either love or skim through — no judgment."
          >
            <li>
              ✓ Generates structured conversion audit with source, topology, and
              physics coverage checks
            </li>
          </Tooltip>
        </ul>
        <p className="hint">
          Select a mod folder and target body type to start converting.
        </p>
      </div>
    </div>
  );
}
