export function Banner({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="banner" role="alert">
      <span>
        No LangSmith API key set. Moves against a deployed server will fail until you add one.
      </span>
      <button type="button" onClick={onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}
