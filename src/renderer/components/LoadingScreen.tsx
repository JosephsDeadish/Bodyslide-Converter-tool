type Stage =
  | "queued"
  | "scan"
  | "python-engine"
  | "conversion"
  | "reports"
  | "done"
  | "";

interface LoadingScreenProps {
  message: string;
  progress: number;
  stage: Stage;
}

const STAGE_LABELS: Record<Exclude<Stage, "">, string> = {
  queued: "Queued",
  scan: "Scanning files",
  "python-engine": "Python engine",
  conversion: "Converting assets",
  reports: "Writing reports",
  done: "Done",
};

const FUN_FACTS = [
  "Did you know? The average Skyrim modder has approximately 500+ mods installed. Statistically, at least three of them crash together.",
  "Remapping physics bones… gently. We don't want them to know we're moving them.",
  "Checking skeleton compatibility so this conversion actually works in-game.",
  "Fun fact: CBPC stands for CBPC Physics Component. Nobody remembers what the first C is for. Don't worry about it.",
  "Writing BodySlide project files with the energy of someone who REALLY wants this outfit to work in-game.",
  "HDT-SMP: because sometimes you need your physics to be computed by a GPU and not just vibes.",
  "This conversion is being performed by highly trained electrons. Please do not disturb them.",
  "Verifying seam edge loops at neck, wrist, and ankle. The unglamorous work that makes the glamorous results possible.",
  "If something goes wrong, it's absolutely the mod's fault. Definitely not ours. Probably.",
  "3BA BreastRoot bones located and handled with care. They know what they do.",
];

export function LoadingScreen({
  message,
  progress,
  stage,
}: LoadingScreenProps) {
  const stageLabel =
    stage && stage in STAGE_LABELS
      ? STAGE_LABELS[stage as Exclude<Stage, "">]
      : "";
  const factIndex = Math.floor((progress / 10) % FUN_FACTS.length);
  const funFact = FUN_FACTS[factIndex];

  return (
    <div className="screen active">
      <div className="loading-wrap">
        <div className="spinner" />
        {stageLabel && <div className="loading-stage">{stageLabel}</div>}
        <p>{message}</p>
        <div className="progress-bar-outer">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <p className="hint">{progress}% complete</p>
        {progress > 0 && progress < 100 && (
          <p className="loading-funfact">{funFact}</p>
        )}
      </div>
    </div>
  );
}
