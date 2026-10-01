import { cn } from "@/lib/utils";
import type { SystemHealthTone } from "@/domain/admin-dashboard";
import type { AdminDashboardData } from "./types";

function toneClass(tone: SystemHealthTone): string {
  switch (tone) {
    case "healthy":
    case "running":
    case "operational":
    case "connected":
      return "text-good";
    case "attention":
      return "text-warn";
    case "not_configured":
    case "disabled":
    case "no_data":
    default:
      return "text-steel";
  }
}

export function SystemHealthPanel({
  rows,
}: {
  rows: AdminDashboardData["systemHealth"];
}) {
  return (
    <section aria-labelledby="system-health-heading">
      <h2
        id="system-health-heading"
        className="mb-3 font-display text-base font-semibold uppercase"
      >
        System health
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-steel">No system health signals available for your role.</p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={row.href}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] transition-colors",
                  "hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2 active:bg-ink/30",
                  "motion-reduce:transition-none",
                )}
              >
                <span className="min-w-0 truncate font-medium">{row.label}</span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold",
                    toneClass(row.tone),
                  )}
                >
                  <span aria-hidden className="text-[8px]">
                    ●
                  </span>
                  {row.statusLabel}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
