import type { AdminDashboardData } from "./types";

export function RecentActivityPanel({
  rows,
}: {
  rows: AdminDashboardData["recentActivity"];
}) {
  return (
    <section aria-labelledby="recent-activity-heading">
      <h2
        id="recent-activity-heading"
        className="mb-3 font-display text-base font-semibold uppercase"
      >
        Recent activity
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-steel">No recent activity.</p>
      ) : (
        <ol className="relative space-y-0 rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          {rows.map((a) => (
            <li
              key={a.id}
              className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 border-b border-border/40 px-3 py-2.5 last:border-0"
            >
              <time
                dateTime={a.when}
                className="num pt-0.5 text-[11px] font-semibold text-steel"
                title={a.whenLabel}
              >
                {a.whenTimeLabel}
              </time>
              <div className="min-w-0">
                <p className="text-[13px] leading-snug">
                  <span className="font-medium">{a.who}</span>{" "}
                  <span className="text-steel">{a.what.toLowerCase()}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
