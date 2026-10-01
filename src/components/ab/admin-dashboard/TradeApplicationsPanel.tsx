import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import type { AdminDashboardData } from "./types";

export function TradeApplicationsPanel({ data }: { data: AdminDashboardData }) {
  const total =
    data.applications.submitted +
    data.applications.underReview +
    data.applications.moreInfoRequired;

  return (
    <section aria-labelledby="trade-apps-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="trade-apps-heading" className="font-display text-lg font-semibold uppercase">
            Trade applications
          </h2>
          <p className="mt-0.5 text-[12px] text-steel">
            <span className="num font-semibold text-foreground">{data.applications.submitted}</span>{" "}
            submitted ·{" "}
            <span className="num font-semibold text-foreground">{data.applications.underReview}</span>{" "}
            under review ·{" "}
            <span className="num font-semibold text-foreground">
              {data.applications.moreInfoRequired}
            </span>{" "}
            more info required
            {total > 0 ? (
              <span className="text-steel">
                {" "}
                · <span className="num">{total}</span> requiring attention
              </span>
            ) : null}
          </p>
        </div>
        <Link
          to={ROUTES.adminApplications}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
        >
          View all
        </Link>
      </div>

      {data.applications.attentionItems.length === 0 ? (
        <p className="text-[13px] text-steel">No applications awaiting review.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface ring-1 ring-inset ring-border/50">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Submitted</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.applications.attentionItems.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-border/40 last:border-0 hover:bg-surface-2/80"
                >
                  <td className="num px-3 py-2">
                    <Link
                      to={ROUTES.adminApplications}
                      className="font-semibold text-primary hover:underline"
                    >
                      {a.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-medium">{a.companyName}</td>
                  <td className="num px-3 py-2 text-steel">{a.submittedAtLabel}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone="brand">{a.statusLabel}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
