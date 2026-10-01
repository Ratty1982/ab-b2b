import { cn } from "@/lib/utils";

export function DashboardKpiCard({
  label,
  value,
  hint,
  href,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  href?: string;
  /** Restrained accent — do not paint every card red. */
  accent?: "none" | "brand" | "warn" | "good";
}) {
  const accentTone = accent ?? "none";
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
      <div
        className={cn(
          "num mt-2 font-display text-2xl font-semibold tracking-tight sm:text-[1.65rem]",
          accentTone === "brand" && "text-primary",
          accentTone === "warn" && "text-warn",
          accentTone === "good" && "text-good",
          accentTone === "none" && "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-steel">{hint}</div>
    </>
  );

  const className = cn(
    "relative block rounded-lg bg-surface px-4 py-3.5 transition-colors",
    "ring-1 ring-inset ring-border/50",
    href &&
      "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:bg-ink/40",
    "motion-reduce:transition-none",
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }

  return <div className={className}>{body}</div>;
}
