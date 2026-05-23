interface LoadingScreenProps {
  message: string;
  progress: number;
}

export function LoadingScreen({ message, progress }: LoadingScreenProps) {
  return (
    <div className="screen active">
      <div className="loading-wrap">
        <div className="spinner" />
        <p>{message}</p>
        <p className="hint">{progress}% complete</p>
      </div>
    </div>
  );
}
