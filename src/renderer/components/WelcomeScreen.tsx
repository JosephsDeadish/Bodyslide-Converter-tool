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
          <li>
            ✓ Detects CBBE, 3BA, HIMBO, TBD, SOS, UNP, BHUNP, UUNP, 7base, SAM,
            Vanilla
          </li>
          <li>
            ✓ Writes converted assets into the selected output folder with
            MO2-ready folder structure
          </li>
          <li>
            ✓ Rewrites BodySlide text assets for supported native conversions
          </li>
          <li>
            ✓ Recognizes FOMOD, MO2, and Vortex packaging signals and keeps
            installer-friendly output structure
          </li>
          <li>
            ✓ Writes <code>conversion-summary.txt</code> and{" "}
            <code>conversion-report.json</code> to <code>_SlideSmith/</code>{" "}
            inside the output (kept separate from game assets)
          </li>
        </ul>
        <p className="hint">
          Select a mod folder and target body type to start converting.
        </p>
      </div>
    </div>
  );
}
