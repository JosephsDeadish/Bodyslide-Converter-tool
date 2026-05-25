import type {
  BodyTypeInfo,
  BodyTypeOption,
  DetectionResult,
} from "../api-types";
import { Tooltip } from "./Tooltip";

type Status = "idle" | "scanning" | "success" | "error";

interface SidebarProps {
  inputPath: string;
  outputPath: string;
  outputPathAuto: boolean;
  bodyTypes: BodyTypeOption[];
  targetBodyType: string;
  bodyTypeInfo: BodyTypeInfo | null;
  detecting: boolean;
  detectResult: DetectionResult | null;
  sourceOverride: string;
  status: Status;
  canConvert: boolean;
  onBrowseInput(): void;
  onBrowseOutput(): void;
  onClearInput(): void;
  onClearOutput(): void;
  onTargetChange(value: string): void;
  onSourceOverrideChange(value: string): void;
  onConvert(): void;
  onPatreon(): void;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "Idle",
  scanning: "Scanning…",
  success: "Done",
  error: "Error",
};

/** Body types split by gender family for optgroup rendering */
const FEMALE_BODY_TYPES = [
  "cbbe",
  "3ba",
  "tbd",
  "unp",
  "bhunp",
  "uunp",
  "ube",
  "7base",
];
const MALE_BODY_TYPES = ["himbo", "bodytalk", "sos", "sam"];
const OTHER_BODY_TYPES = ["vanilla"];

function pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

export function Sidebar({
  inputPath,
  outputPath,
  outputPathAuto,
  bodyTypes,
  targetBodyType,
  bodyTypeInfo,
  detecting,
  detectResult,
  sourceOverride,
  status,
  canConvert,
  onBrowseInput,
  onBrowseOutput,
  onClearInput,
  onClearOutput,
  onTargetChange,
  onSourceOverrideChange,
  onConvert,
  onPatreon,
}: SidebarProps) {
  const showDetect = Boolean(inputPath);
  const detectedType = detectResult?.bodyType;
  const confPct = detectResult ? Math.round(detectResult.confidence * 100) : 0;
  const packagingTags = detectResult
    ? [
        detectResult.packaging.fomod ? "FOMOD" : null,
        detectResult.packaging.mo2 ? "MO2" : null,
        detectResult.packaging.vortex ? "Vortex" : null,
      ].filter((tag): tag is string => tag !== null)
    : [];

  const femaleOptions = bodyTypes.filter((t) =>
    FEMALE_BODY_TYPES.includes(t.value),
  );
  const maleOptions = bodyTypes.filter((t) =>
    MALE_BODY_TYPES.includes(t.value),
  );
  const otherOptions = bodyTypes.filter((t) =>
    OTHER_BODY_TYPES.includes(t.value),
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <span className="logo">⚙</span>
        <span>SlideSmith</span>
      </div>

      <div className="form-section">
        {/* ── Convert Button ── */}
        <Tooltip
          dir="right"
          block
          text={
            canConvert
              ? "All systems go! This will analyze your mod, remap BodySlide assets, rewrite physics configs, and generally perform miracles. 🚀"
              : "Fill in the source folder, pick a target body, and set an output folder first. Three fields. You can do this. I believe in you."
          }
        >
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canConvert}
            onClick={onConvert}
          >
            ▶ Convert
          </button>
        </Tooltip>

        {/* ── Source Mod Folder ── */}
        <Tooltip
          dir="right"
          text="The mod folder to convert. SlideSmith will crawl it like a raccoon hunting for BodySlide project files — but faster and with less fur."
        >
          <div className="field-label" style={{ marginTop: "1rem" }}>
            Source Mod Folder
          </div>
        </Tooltip>
        <div className="path-row">
          <Tooltip
            dir="right"
            text={
              inputPath
                ? `Full path: ${inputPath}`
                : "No folder selected yet. Hit 📁 to browse!"
            }
          >
            <input
              className="path-input"
              type="text"
              placeholder="Select folder…"
              value={inputPath}
              readOnly
            />
          </Tooltip>
          <Tooltip
            dir="right"
            text="Opens a folder browser. It's like a treasure hunt, but the treasure is a mod that needs a body upgrade."
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onBrowseInput}
              aria-label="Browse for source folder"
            >
              📁
            </button>
          </Tooltip>
          {inputPath && (
            <Tooltip dir="right" text="Clear the selected source folder.">
              <button
                type="button"
                className="btn-clear"
                onClick={onClearInput}
                aria-label="Clear source folder"
              >
                ✕
              </button>
            </Tooltip>
          )}
        </div>
        {inputPath && (
          <div className="path-basename">{pathBasename(inputPath)}</div>
        )}

        {/* ── Detected Source Body ── */}
        {showDetect && (
          <div className="source-detect-section">
            <Tooltip
              dir="right"
              text="We dug through your mod files and made an educated guess about the source body type. Confidence % included because we're honest about our limitations."
            >
              <div className="field-label" style={{ marginTop: "0.3rem" }}>
                Detected Source Body
              </div>
            </Tooltip>
            <div className="source-detect-status">
              {detecting ? (
                <span className="source-detect-value source-detect-scanning">
                  Scanning…
                </span>
              ) : detectedType === "unknown" ? (
                <Tooltip
                  dir="right"
                  text="Couldn't identify a body type. The mod may have unusual file paths, no BodySlide projects, or be wearing a disguise. Use the override below."
                >
                  <span className="source-detect-value source-detect-unknown">
                    Unknown — no body signals found
                  </span>
                </Tooltip>
              ) : detectedType !== undefined ? (
                <Tooltip
                  dir="right"
                  text={`Detected as ${detectedType.toUpperCase()} with ${confPct}% confidence. Anything above 70% is basically a sure thing. Below 50% and it's more of a vibe.`}
                >
                  <span className="source-detect-value source-detect-found">
                    {detectedType.toUpperCase()} — {confPct}% confidence
                  </span>
                </Tooltip>
              ) : (
                <span className="source-detect-value source-detect-unknown">
                  Detection failed
                </span>
              )}
            </div>
            {packagingTags.length > 0 && (
              <div className="detected-packaging-row">
                <Tooltip
                  dir="right"
                  text="We found packaging metadata (FOMOD/MO2/Vortex). SlideSmith will preserve these installer structures in the output like a very careful archaeologist."
                >
                  <span className="field-label">Detected packaging</span>
                </Tooltip>
                <div className="detected-packaging-tags">
                  {packagingTags.map((tag) => (
                    <span key={tag} className="packaging-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <Tooltip
              dir="right"
              text="Auto-detect confidently wrong? Pick the actual source body here. No judgment — even the best AI has a bad day sometimes."
            >
              <div className="field-label" style={{ marginTop: "0.6rem" }}>
                Override Source Body
              </div>
            </Tooltip>
            <div className="field-hint">
              App recommendation is used by default — change only if detection
              is wrong
            </div>
            <Tooltip
              dir="right"
              text="If the detected body type above is wrong, manually select the correct one here. We promise not to bring it up later."
            >
              <select
                className="select-control"
                style={{ marginTop: "4px" }}
                value={sourceOverride}
                onChange={(e) => onSourceOverrideChange(e.target.value)}
              >
                <option value="">Use auto-detected</option>
                <optgroup label="♀ Female Bodies">
                  {femaleOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="♂ Male Bodies">
                  {maleOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
                {otherOptions.length > 0 && (
                  <optgroup label="Other">
                    {otherOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Tooltip>
          </div>
        )}

        {/* ── Convert To ── */}
        <div style={{ marginTop: "1rem" }}>
          <Tooltip
            dir="right"
            text="The body type you want the converted output to target. Pick wisely — re-converting is totally fine, but why do it twice?"
          >
            <div className="field-label">Convert To — Output Body Type</div>
          </Tooltip>
          <div className="field-hint">
            Select which body type you want the mod converted to
          </div>
        </div>
        <Tooltip
          dir="right"
          text="Physics-capable bodies (3BA, BHUNP, TBD, UUNP, etc.) get bonus physics bone remapping. The info box below tells you everything you need to know about your chosen body."
        >
          <select
            className="select-control"
            style={{ marginTop: "4px" }}
            value={targetBodyType}
            onChange={(e) => onTargetChange(e.target.value)}
          >
            <option value="">— Select output body —</option>
            <optgroup label="♀ Female Bodies">
              {femaleOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="♂ Male Bodies">
              {maleOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            {otherOptions.length > 0 && (
              <optgroup label="Other">
                {otherOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Tooltip>

        {bodyTypeInfo !== null && <BodyInfoBox info={bodyTypeInfo} />}

        {/* ── Output Folder ── */}
        <Tooltip
          dir="right"
          text="Where SlideSmith puts the converted files. Output is MO2-ready and kept clean from your source. Please, not your Desktop. Not C:\\. You're better than that."
        >
          <div className="field-label" style={{ marginTop: "1rem" }}>
            Output Folder{outputPathAuto && " (auto)"}
          </div>
        </Tooltip>
        <div className="path-row">
          <Tooltip
            dir="right"
            text={
              outputPath
                ? `Full path: ${outputPath}`
                : "No output folder set yet."
            }
          >
            <input
              className="path-input"
              type="text"
              placeholder="Select folder…"
              value={outputPath}
              readOnly
            />
          </Tooltip>
          <Tooltip
            dir="right"
            text="Choose a custom output folder. Default is automatically set to [source]-bodyslide-output. Overriding it? Bold. We like it."
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onBrowseOutput}
              aria-label="Browse for output folder"
            >
              📁
            </button>
          </Tooltip>
          {outputPath && (
            <Tooltip dir="right" text="Clear the output folder path.">
              <button
                type="button"
                className="btn-clear"
                onClick={onClearOutput}
                aria-label="Clear output folder"
              >
                ✕
              </button>
            </Tooltip>
          )}
        </div>
        {outputPath && (
          <div className="path-basename">{pathBasename(outputPath)}</div>
        )}

      </div>

      <div className="sidebar-footer">
        <Tooltip
          dir="right"
          text="Current job status. Idle = waiting for you. Scanning = crunching your mod. Done = celebrate! Error = check the main panel."
        >
          <span className={`badge badge-${status}`}>
            {STATUS_LABELS[status]}
          </span>
        </Tooltip>
        <Tooltip
          dir="right"
          text="Support the dev who made this! Coffee, motivation, and bug-fix energy are all fueled by Patreon. And yes, tooltips like this one take time too. 😅"
        >
          <button
            type="button"
            className="btn btn-secondary btn-support"
            onClick={onPatreon}
          >
            ❤ Support on Patreon
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

const BODY_HUMOR: Record<string, string> = {
  cbbe: "The McDonald's of Skyrim female bodies — everyone has it installed. It just works. The unofficial prerequisite of modding.",
  "3ba":
    "CBBE but now everything jiggles realistically. You have achieved maximum physics. Your GPU is slightly concerned.",
  himbo:
    "Big himbo energy for your male NPCs. Shoulders wider than your monitor. Built different.",
  bodytalk:
    "BodyTalk — like HIMBO's gym buddy. Great for when your male NPCs need to look like they actually work out.",
  tbd: "Touched by Dibella. Like CBBE but blessed with extra volume in all the places. Dibella approved™.",
  sos: "You know what this mod does. Stop pretending otherwise. It's fine. We're all adults here.",
  unp: "The slimmer classic. More naturalistic proportions. Less jiggle physics drama. Pure UNP elegance.",
  bhunp:
    "UNP but now with CBPC/HDT-SMP physics AND a name that sounds like a confused cow. Genuinely great body though.",
  uunp: "Unified UNP — they unified it. Everyone agreed it was better. Nobody could quite agree on what to call it.",
  ube: "UBE: UUNP on steroids with 47 extra sliders. Surgical-precision body customization. Hip protrusion slider? Yes, really.",
  "7base":
    "A relic of 2013 modding. Exaggerated proportions. Discovered physics for the first time. Bombshell indeed.",
  sam: "Shape Atlas for Men — per-actor bodymorph support. Every NPC can have different gains. True equality.",
  vanilla:
    "The default Bethesda body. Brave choice. Very '2011 of you'. Maximum compatibility, minimum drama.",
};

function BodyInfoBox({ info }: { info: BodyTypeInfo }) {
  const genderLabel =
    info.gender === "both"
      ? "Any gender"
      : info.gender === "male"
        ? "♂ Male"
        : "♀ Female";

  // Find the humor text by matching display name to known keys
  const humorKey = Object.keys(BODY_HUMOR).find((k) =>
    info.displayName.toLowerCase().startsWith(k),
  );
  const humor = humorKey ? BODY_HUMOR[humorKey] : null;

  return (
    <div className="body-info-box">
      <div className="info-name">{info.displayName}</div>
      <div className="info-tags">
        <Tooltip
          dir="right"
          text={`This body targets ${info.gender === "both" ? "both male and female" : info.gender} characters.`}
        >
          <span className="tag">{genderLabel}</span>
        </Tooltip>
        {info.physicsSupport ? (
          <Tooltip
            dir="right"
            text="Physics-capable! This body supports CBPC and/or HDT-SMP. Extra care is taken when remapping physics bone configs during conversion."
          >
            <span className="tag physics">⚡ Physics (CBPC/HDT-SMP)</span>
          </Tooltip>
        ) : (
          <Tooltip
            dir="right"
            text="Static body — no physics bone support. What you see is what you get. Calm. Serene. No jiggling."
          >
            <span className="tag">No physics</span>
          </Tooltip>
        )}
      </div>
      {humor && <div className="info-humor">{humor}</div>}
      <div>{info.description}</div>
      <div className="info-notes">
        <strong>Aliases:</strong> {info.aliases.join(", ")}
      </div>
      <div className="info-notes">
        <strong>Common variants:</strong> {info.commonVariants.join(", ")}
      </div>
      <div className="info-notes">
        <strong>Skeleton profile:</strong> {info.skeletonProfile} —{" "}
        {info.skeletonNotes}
      </div>
      <div className="info-notes">
        <strong>Conversion notes:</strong> {info.conversionNotes}
      </div>
    </div>
  );
}
