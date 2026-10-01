export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mx-4 my-6 max-w-lg rounded-lg bg-surface px-4 py-5 ring-1 ring-inset ring-border/60 sm:mx-6"
    >
      <h2 className="font-display text-base font-semibold uppercase">Dashboard unavailable</h2>
      <p className="mt-1 text-[13px] text-steel">
        Could not load the operational overview.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        Retry
      </button>
    </div>
  );
}
