import { ROUTES } from "@/lib/app-nav";
import type { AdminDashboardData } from "./types";

/** Compact callbacks + quotes overview for the side column. */
export function SecondaryOpsPanel({
  callbacks,
  quotes,
}: {
  callbacks: AdminDashboardData["callbacks"];
  quotes: AdminDashboardData["quotes"];
}) {
  if (!callbacks && !quotes) return null;

  return (
    <section
      aria-labelledby="secondary-ops-heading"
      className="rounded-lg bg-surface px-3 py-3 ring-1 ring-inset ring-border/50"
    >
      <h2
        id="secondary-ops-heading"
        className="mb-2 font-display text-base font-semibold uppercase"
      >
        Quick overview
      </h2>
      <dl className="space-y-2 text-[13px]">
        {callbacks ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-steel">
              <a href={ROUTES.adminCustomers} className="hover:text-primary hover:underline">
                Open callbacks
              </a>
            </dt>
            <dd className="num font-semibold">
              {callbacks.openCount === 0 ? (
                <span className="font-normal text-steel">None</span>
              ) : (
                <span className="text-warn">{callbacks.openCount}</span>
              )}
            </dd>
          </div>
        ) : null}
        {quotes ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-steel">
                <a href={ROUTES.salesQuotes} className="hover:text-primary hover:underline">
                  Open quotes
                </a>
              </dt>
              <dd className="num font-semibold">{quotes.draft + quotes.sentOrViewed}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-steel">Expiring soon</dt>
              <dd className="num font-semibold">
                {quotes.expiringSoon === 0 ? (
                  <span className="font-normal text-steel">None</span>
                ) : (
                  <span className="text-warn">{quotes.expiringSoon}</span>
                )}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </section>
  );
}
