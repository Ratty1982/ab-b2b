import { cn } from "@/lib/utils";
import type { AdminDashboardData } from "./types";

export function AdminDashboardHeader({
  greeting,
  quickActions,
}: {
  greeting: AdminDashboardData["greeting"];
  quickActions: AdminDashboardData["quickActions"];
}) {
  const title = greeting.displayName
    ? `${greeting.greeting}, ${greeting.displayName}`
    : greeting.greeting;

  return (
    <div className="flex flex-col gap-4 border-b border-border/60 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-steel">
          {greeting.dateLabel}
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold uppercase tracking-tight sm:text-2xl">
          {title}
        </h1>
        <p className="mt-1 max-w-xl text-[13px] text-steel">
          Here&apos;s what&apos;s happening across Automotive Brands today.
        </p>
      </div>
      {quickActions.length > 0 ? (
        <nav
          aria-label="Quick actions"
          className="flex flex-wrap gap-2 sm:justify-end"
        >
          {quickActions.map((action) => (
            <a
              key={action.id}
              href={action.href}
              className={cn(
                "rounded-md bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground",
                "ring-1 ring-inset ring-border/60 transition-colors",
                "hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:bg-ink/40",
                "motion-reduce:transition-none",
              )}
            >
              {action.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
