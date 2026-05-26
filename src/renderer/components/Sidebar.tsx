import type {
  BodyTypeInfo,
  BodyTypeOption,
  ConversionPhysicsProfile,
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
  physicsProfile: ConversionPhysicsProfile;
  maleBodyTypeInfo: BodyTypeInfo | null;
  malePhysicsProfile: ConversionPhysicsProfile;
  mixedGender: boolean;
  maleSource: string;
  maleTarget: string;
  status: Status;
  canConvert: boolean;
  onBrowseInput(): void;
  onBrowseOutput(): void;
  onClearInput(): void;
  onClearOutput(): void;
  onTargetChange(value: string): void;
  onSourceOverrideChange(value: string): void;
  onPhysicsProfileChange(value: ConversionPhysicsProfile): void;
  onMalePhysicsProfileChange(value: ConversionPhysicsProfile): void;
  onMixedGenderChange(value: boolean): void;
  onMaleSourceChange(value: string): void;
  onMaleTargetChange(value: string): void;
  onConvert(): void;
  onPatreon(): void;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "Idle",
  scanning: "Scanning…",
  success: "Done",
  error: "Error",
};

/** Tooltip text keyed by packaging tag name */
const PACKAGING_TOOLTIP: Record<string, string> = {
  FOMOD:
    "FOMOD installer detected! SlideSmith preserves the entire FOMOD tree so your mod manager still shows the step-by-step install wizard. No wizards were harmed in this conversion.",
  MO2: "Mod Organizer 2 metadata found. The converted output keeps a tidy MO2-friendly folder structure. Basically SlideSmith is fluent in MO2 and won't mess up your carefully curated profile.",
  Vortex:
    "Vortex packaging signals detected. SlideSmith respects your Vortex lifestyle — the output stays installable via drag-and-drop or the Vortex UI. (MO2 is still better. 🤫 Don't tell anyone.)",
};
const FEMALE_BODY_TYPES = [
  "cbbe",
  "3ba",
  "coco",
  "tbd",
  "unp",
  "bhunp",
  "uunp",
  "ube",
  "7base",
];
const MALE_BODY_TYPES = ["himbo", "bodytalk", "sos", "sam"];
const OTHER_BODY_TYPES = ["vanilla"];
const PHYSICS_OPTIONS: Array<{
  value: ConversionPhysicsProfile;
  label: string;
}> = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "dual", label: "Dual (CBPC + HDT-SMP)" },
  { value: "cbpc", label: "CBPC (INI physics)" },
  { value: "hdt-smp", label: "HDT-SMP / Softbody (XML physics)" },
  { value: "softbody", label: "Softbody (HDT-SMP softbody XML)" },
  { value: "none", label: "No physics" },
];

function isPhysicsOptionSupported(
  option: ConversionPhysicsProfile,
  info: BodyTypeInfo | null,
): boolean {
  if (!info) return true;
  if (option === "none" || option === "auto") return true;
  if (!info.physicsSupport) return false;
  if (option === "dual") return info.cbpcCompatible && info.hdtSmpCompatible;
  if (option === "cbpc") return info.cbpcCompatible;
  if (option === "hdt-smp" || option === "softbody")
    return info.hdtSmpCompatible;
  return true;
}

function pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

function getPhysicsSupportHint(info: BodyTypeInfo | null): string {
  if (!info) return "Select a target body to see available physics engines.";
  if (!info.physicsSupport)
    return "Target body has no runtime physics support.";
  if (info.cbpcCompatible && info.hdtSmpCompatible) {
    return "Supports CBPC and HDT-SMP/Softbody configs.";
  }
  if (info.hdtSmpCompatible) return "Supports HDT-SMP/Softbody configs only.";
  if (info.cbpcCompatible) return "Supports CBPC configs only.";
  return "Physics support metadata is limited for this target.";
}

function BodySelect({
  value,
  placeholder,
  femaleOptions,
  maleOptions,
  otherOptions,
  onChange,
}: {
  value: string;
  placeholder: string;
  femaleOptions: BodyTypeOption[];
  maleOptions: BodyTypeOption[];
  otherOptions: BodyTypeOption[];
  onChange(v: string): void;
}) {
  return (
    <select
      className="select-control"
      style={{ marginTop: "4px" }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
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
  );
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
  physicsProfile,
  maleBodyTypeInfo,
  malePhysicsProfile,
  mixedGender,
  maleSource,
  maleTarget,
  status,
  canConvert,
  onBrowseInput,
  onBrowseOutput,
  onClearInput,
  onClearOutput,
  onTargetChange,
  onSourceOverrideChange,
  onPhysicsProfileChange,
  onMalePhysicsProfileChange,
  onMixedGenderChange,
  onMaleSourceChange,
  onMaleTargetChange,
  onConvert,
  onPatreon,
}: SidebarProps) {
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
              : "Fill in the source folder, pick the body types, and set an output folder first."
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
            <Tooltip
              dir="right"
              text="Nuke it. Pretend this folder never existed. A fresh start — like deleting your browser history, but with fewer regrets."
            >
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
            <Tooltip
              dir="right"
              text="Wipe the output path. It auto-fills again the moment you pick a new source, so you can't really mess this up. Probably."
            >
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

        {/* ── Source Body Type (required) ── */}
        <div style={{ marginTop: "1rem" }}>
          <Tooltip
            dir="right"
            text="Tell SlideSmith which body this mod was originally built for — the one you're converting FROM. Always required. Auto-detection above is a hint, not gospel. You know what you installed."
          >
            <div className="field-label">
              ♀ Source Body Type{" "}
              <span style={{ color: "var(--color-error, #e55)" }}>*</span>
            </div>
          </Tooltip>
          <div className="field-hint">
            Pick the body type you are converting FROM
          </div>
          {inputPath && (
            <div className="source-detect-status" style={{ marginTop: "4px" }}>
              {detecting ? (
                <Tooltip
                  dir="right"
                  text="Scanning your mod folder like a caffeinated archaeologist. Won't take long — probably."
                >
                  <span className="source-detect-value source-detect-scanning">
                    Detecting…
                  </span>
                </Tooltip>
              ) : detectedType && detectedType !== "unknown" ? (
                <Tooltip
                  dir="right"
                  text={`Hint: auto-detected as ${detectedType.toUpperCase()} with ${confPct}% confidence. Confirm by selecting it below — or override if you know better. (You probably do.)`}
                >
                  <span className="source-detect-value source-detect-found">
                    Hint: {detectedType.toUpperCase()} — {confPct}% confidence
                  </span>
                </Tooltip>
              ) : detectedType === "unknown" ? (
                <Tooltip
                  dir="right"
                  text="SlideSmith couldn't confidently identify a known body type in this folder. No file paths, slider names, or mesh signals matched any supported body. Select the source body manually — you know what you installed. Probably."
                >
                  <span className="source-detect-value source-detect-unknown">
                    Hint: no body signals detected — select manually
                  </span>
                </Tooltip>
              ) : null}
            </div>
          )}
          {packagingTags.length > 0 && (
            <div className="detected-packaging-row">
              <div className="detected-packaging-tags">
                {packagingTags.map((tag) => (
                  <Tooltip
                    key={tag}
                    text={
                      PACKAGING_TOOLTIP[tag] ??
                      `${tag} packaging detected and preserved in the converted output.`
                    }
                  >
                    <span className="packaging-tag">{tag}</span>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>
        <BodySelect
          value={sourceOverride}
          placeholder="— Select source body (required) —"
          femaleOptions={femaleOptions}
          maleOptions={maleOptions}
          otherOptions={otherOptions}
          onChange={onSourceOverrideChange}
        />

        {/* ── Female Convert To ── */}
        <div style={{ marginTop: "1rem" }}>
          <Tooltip
            dir="right"
            text="The female body type you want the output to target — the one you're converting TO. Pick wisely. Re-converting is totally fine, but why make more work for yourself? (No judgment if you do it anyway.)"
          >
            <div className="field-label">
              ♀ Convert To — Female Target Body{" "}
              <span style={{ color: "var(--color-error, #e55)" }}>*</span>
            </div>
          </Tooltip>
          <div className="field-hint">
            Select which female body type to convert to
          </div>
        </div>
        <BodySelect
          value={targetBodyType}
          placeholder="— Select female target body —"
          femaleOptions={femaleOptions}
          maleOptions={maleOptions}
          otherOptions={otherOptions}
          onChange={onTargetChange}
        />

        <div style={{ marginTop: "1rem" }}>
          <Tooltip
            dir="right"
            text="Choose the female target physics setup for this conversion pass. Unsupported options are disabled per target metadata. HDT-SMP includes softbody XML workflows."
          >
            <div className="field-label">♀ Female Physics Profile</div>
          </Tooltip>
          <div className="field-hint">
            {getPhysicsSupportHint(bodyTypeInfo)}
          </div>
          <select
            className="select-control"
            style={{ marginTop: "4px" }}
            value={physicsProfile}
            onChange={(event) =>
              onPhysicsProfileChange(
                event.target.value as ConversionPhysicsProfile,
              )
            }
          >
            {PHYSICS_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={!isPhysicsOptionSupported(option.value, bodyTypeInfo)}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {bodyTypeInfo !== null && <BodyInfoBox info={bodyTypeInfo} />}

        {/* ── Mixed-gender suggestion banner ── */}
        {detectResult?.genderSignals?.hasFemaleAssets &&
          detectResult.genderSignals.hasMaleAssets &&
          !mixedGender && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.55rem 0.75rem",
                borderRadius: "6px",
                background: "rgba(255, 200, 80, 0.13)",
                border: "1px solid rgba(255, 200, 80, 0.45)",
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                fontSize: "0.82rem",
                color: "var(--text, #e0e0e0)",
              }}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1.4 }}>♀♂</span>
              <span>
                <strong style={{ color: "#ffd966" }}>Mixed-gender assets detected.</strong>{" "}
                This mod appears to contain both female and male outfit files. Enable{" "}
                <em>Mixed-gender mod</em> below to also run the male conversion pass.
              </span>
            </div>
          )}

        {/* ── Mixed-gender mod toggle ── */}
        <div style={{ marginTop: "1rem" }}>
          <Tooltip
            dir="right"
            text="Enable this if the mod contains both male and female outfits (e.g. Toast's Guro, mixed-gender armor packs). SlideSmith will run a separate male conversion pass."
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={mixedGender}
                onChange={(e) => onMixedGenderChange(e.target.checked)}
              />
              <span className="field-label" style={{ marginTop: 0 }}>
                Mixed-gender mod (♀ female + ♂ male outfits)
              </span>
            </label>
          </Tooltip>
          <div className="field-hint">
            Enable to also convert male fits in the same mod
          </div>
        </div>

        {/* ── Male Source + Target (conditional) ── */}
        {mixedGender && (
          <>
            <div style={{ marginTop: "1rem" }}>
              <Tooltip
                dir="right"
                text="Which male body was this mod sculpted for? HIMBO? BodyTalk? SOS? This is the body you're converting FROM — get it wrong and those big himbo shoulders will end up on a SAM rig looking very confused."
              >
                <div className="field-label">
                  ♂ Male Source Body{" "}
                  <span style={{ color: "var(--color-error, #e55)" }}>*</span>
                </div>
              </Tooltip>
              <div className="field-hint">
                Pick the male body type you are converting FROM
              </div>
            </div>
            <BodySelect
              value={maleSource}
              placeholder="— Select male source body —"
              femaleOptions={[]}
              maleOptions={maleOptions}
              otherOptions={[]}
              onChange={onMaleSourceChange}
            />

            <div style={{ marginTop: "1rem" }}>
              <Tooltip
                dir="right"
                text="Where do you want those abs to end up? Pick the male body type you're converting TO. SAM for per-actor bodymorph glory, HIMBO for maximum shoulder wingspan, BodyTalk if you want gains — it's your call."
              >
                <div className="field-label">
                  ♂ Convert To — Male Target Body{" "}
                  <span style={{ color: "var(--color-error, #e55)" }}>*</span>
                </div>
              </Tooltip>
              <div className="field-hint">
                Select which male body type to convert to
              </div>
            </div>
            <BodySelect
              value={maleTarget}
              placeholder="— Select male target body —"
              femaleOptions={[]}
              maleOptions={maleOptions}
              otherOptions={[]}
              onChange={onMaleTargetChange}
            />
            <div style={{ marginTop: "1rem" }}>
              <Tooltip
                dir="right"
                text="Choose the male-target physics setup for the mixed-gender male pass. HDT-SMP includes softbody XML workflows."
              >
                <div className="field-label">♂ Male Physics Profile</div>
              </Tooltip>
              <div className="field-hint">
                {getPhysicsSupportHint(maleBodyTypeInfo)}
              </div>
              <select
                className="select-control"
                style={{ marginTop: "4px" }}
                value={malePhysicsProfile}
                onChange={(event) =>
                  onMalePhysicsProfileChange(
                    event.target.value as ConversionPhysicsProfile,
                  )
                }
              >
                {PHYSICS_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={
                      !isPhysicsOptionSupported(option.value, maleBodyTypeInfo)
                    }
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
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
  coco: "COCO Body: CBBE-family curves with 3BBB-style physics support. Great if you like your presets spicy and your bounce settings dangerously configurable.",
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
