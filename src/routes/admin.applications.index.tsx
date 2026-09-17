import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import {
  approveTradeApplicationFn,
  getTradeApplicationFn,
  listTradeApplicationsFn,
  rejectTradeApplicationFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/applications/")({
  head: () => ({
    meta: [{ title: "Trade Applications — Automotive Brands Admin" }],
  }),
  component: ApplicationsPage,
});

const filters = [
  "ALL",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
] as const;

function ApplicationsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("ALL");
  const [rows, setRows] = useState<
    Array<{
      id: string;
      reference: string;
      status: string;
      companyName: string;
      contactEmail: string;
      submittedAt: string;
      companyId: string | null;
    }>
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    id: string;
    reference: string;
    status: string;
    companyName: string;
    tradingName?: string | null;
    vatNumber?: string | null;
    businessType?: string | null;
    primaryContact?: unknown;
    tradingAddress?: unknown;
    brandsInterest?: unknown;
    notes?: string | null;
    companyId?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await listTradeApplicationsFn({ data: { status: filter } });
    if (r.ok) setRows(r.data as typeof rows);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void getTradeApplicationFn({ data: { id: selected } }).then((r) => {
      if (r.ok) setDetail(r.data as NonNullable<typeof detail>);
    });
  }, [selected]);

  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const review = rows.filter((r) => r.status === "UNDER_REVIEW").length;

  return (
    <div>
      <PanelHeader
        title="Trade applications"
        sub="Review and approve new trade accounts"
        crumbs={[{ label: "Sales" }, { label: "Trade Applications", to: ROUTES.adminApplications }]}
      />
      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Metric label="In queue" value={String(rows.length)} />
        <Metric label="New / submitted" value={String(submitted)} tone="brand" />
        <Metric label="Under review" value={String(review)} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-4 py-3 sm:px-6">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "h-9 rounded-md border px-3 text-[12px] font-semibold",
              filter === f ? "border-primary bg-primary/10" : "border-border text-steel",
            )}
          >
            {f.replaceAll("_", " ")}
          </button>
        ))}
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-[1fr_420px] sm:p-6">
        <div className="overflow-x-auto rounded-md border border-border">
          {loading ? (
            <div className="p-4 text-sm text-steel">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-steel">No applications in this filter</div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface/60 text-[11px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "cursor-pointer border-b border-border/50 hover:bg-surface/40",
                      selected === r.id && "bg-primary/5",
                    )}
                    onClick={() => setSelected(r.id)}
                  >
                    <td className="num px-3 py-2">{r.reference}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.companyName}</div>
                      <div className="text-[12px] text-steel">{r.contactEmail}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          r.status === "APPROVED"
                            ? "good"
                            : r.status === "REJECTED"
                              ? "bad"
                              : "brand"
                        }
                      >
                        {r.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-steel">
                      {new Date(r.submittedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="border border-border bg-surface/40 p-4">
          {!detail ? (
            <p className="text-sm text-steel">Select an application to review</p>
          ) : (
            <div className="grid gap-3 text-[13px]">
              <div className="font-display text-xl uppercase">{detail.companyName}</div>
              <div className="num text-steel">{detail.reference}</div>
              <StatusBadge>{detail.status.replaceAll("_", " ")}</StatusBadge>
              <pre className="overflow-auto rounded-md border border-border bg-ink/40 p-3 text-[11px] text-steel">
                {JSON.stringify(
                  {
                    tradingName: detail.tradingName,
                    vatNumber: detail.vatNumber,
                    businessType: detail.businessType,
                    primaryContact: detail.primaryContact,
                    tradingAddress: detail.tradingAddress,
                    brandsInterest: detail.brandsInterest,
                    notes: detail.notes,
                  },
                  null,
                  2,
                )}
              </pre>
              {detail.companyId ? (
                <Link
                  to="/admin/customers/$id"
                  params={{ id: detail.companyId! }}
                  className="text-primary hover:underline"
                >
                  Open company workspace →
                </Link>
              ) : null}
              {detail.status !== "APPROVED" && detail.status !== "REJECTED" ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    className="h-10 rounded-md bg-good px-4 text-[12px] font-bold uppercase text-ink"
                    onClick={() => {
                      void (async () => {
                        const r = await approveTradeApplicationFn({
                          data: { id: detail.id },
                        });
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success(
                            r.data.created
                              ? "Approved — company created (invite email deferred)"
                              : "Already approved (idempotent)",
                          );
                          setSelected(detail.id);
                          await load();
                          const d = await getTradeApplicationFn({ data: { id: detail.id } });
                          if (d.ok) setDetail(d.data as NonNullable<typeof detail>);
                        }
                      })();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-md border border-bad/50 px-4 text-[12px] font-bold uppercase text-bad"
                    onClick={() => {
                      void (async () => {
                        const r = await rejectTradeApplicationFn({
                          data: { id: detail.id, reviewNotes: "Rejected by reviewer" },
                        });
                        if (!r.ok) toast.error(r.error);
                        else {
                          toast.success("Application rejected");
                          await load();
                        }
                      })();
                    }}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
              <Link to={ROUTES.adminCustomers} className="text-[12px] text-steel hover:text-foreground">
                ← Back to customers
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
