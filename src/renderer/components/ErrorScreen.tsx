interface ErrorScreenProps {
  message: string;
  onBack(): void;
}

export function ErrorScreen({ message, onBack }: ErrorScreenProps) {
  return (
    <div className="screen active">
      <div className="error-card">
        <div className="error-icon">✕</div>
        <h2>Conversion Failed</h2>
        <p>{message}</p>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}
