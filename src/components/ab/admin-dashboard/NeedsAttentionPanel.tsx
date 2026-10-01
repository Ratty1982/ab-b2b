import { resolveAttentionTone } from "@/domain/admin-dashboard";
import { cn } from "@/lib/utils";
import type { AdminDashboardData } from "./types";

export function NeedsAttentionPanel({
  items,
}: {
  items: AdminDashboardData["needsAttention"];
}) {
  return (
    <section aria-labelledby="needs-attention-heading">
      <h2
        id="needs-attention-heading"
        className="mb-3 font-display text-lg font-semibold uppercase"
      >
        Needs attention
      </h2>
      {items.length === 0 ? (
        <div className="rounded-lg bg-good/10 px-4 py-4 ring-1 ring-inset ring-good/25">
          <p className="text-[13px] font-semibold text-good">You&apos;re up to date</p>
          <p className="mt-0.5 text-[12px] text-steel">
            No operational issues currently require attention.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          {items.map((item) => {
            const tone = resolveAttentionTone(item.severity, item.id);
            return (
              <li key={item.id}>
                <a
                  href={item.href}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 transition-colors",
                    "hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2 active:bg-ink/30",
                    "motion-reduce:transition-none",
                  )}
                >
                  <span
                    className={cn(
                      "num inline-grid min-w-8 place-items-center rounded-md px-1.5 py-1 text-[13px] font-semibold",
                      tone === "critical" && "bg-primary/15 text-primary",
                      tone === "attention" && "bg-warn/15 text-warn",
                      tone === "info" && "bg-surface-2 text-steel",
                    )}
                  >
                    {item.count == null ? "·" : item.count}
                  </span>
                  <span className="min-w-0 truncate text-[13px]">{item.label}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                    {item.actionLabel}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
