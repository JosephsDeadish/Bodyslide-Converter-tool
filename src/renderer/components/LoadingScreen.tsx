export function LoadingScreen() {
  return (
    <div className="screen active">
      <div className="loading-wrap">
        <div className="spinner" />
        <p>Converting mod assets…</p>
      </div>
    </div>
  );
}
