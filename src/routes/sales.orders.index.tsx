import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import { abandonSalesOrderDraftFn, listSalesOrderDraftsFn } from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/sales/orders/")({
  head: () => ({
    meta: [
      { title: "Order entry — Sales — Automotive Brands" },
      {
        name: "description",
        content: "Unfinished sales orders entered on behalf of customers.",
      },
    ],
  }),
  component: SalesOrderDrafts,
});

type DraftRow = {
  id: string;
  companyId: string;
  companyName: string;
  poNumber: string | null;
  source: string | null;
  editingOrderNumber: string | null;
  updatedAt: string;
  lines: Array<{ id: string }>;
};

function SalesOrderDrafts() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listSalesOrderDraftsFn();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data as DraftRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function abandon(id: string) {
    const result = await abandonSalesOrderDraftFn({ data: { draftId: id } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Draft abandoned");
    await load();
  }

  return (
    <div>
      <PanelHeader
        title="Order entry"
        sub="Telephone, email, and customer-visit orders. Drafts stay separate from the customer basket."
        actions={
          <Link
            to="/sales/orders/new"
            search={{}}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
          >
            New order
          </Link>
        }
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        {loading ? <p className="text-[13px] text-steel">Loading…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="text-[13px] text-steel">No open drafts. Start an order for a customer.</p>
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2 text-right">Lines</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium">{row.companyName}</td>
                    <td className="px-3 py-2 text-steel">
                      {row.editingOrderNumber ? `Editing ${row.editingOrderNumber}` : row.poNumber || "—"}
                    </td>
                    <td className="px-3 py-2 text-steel">{row.source || "—"}</td>
                    <td className="num px-3 py-2 text-right">{row.lines.length}</td>
                    <td className="px-3 py-2 text-steel">
                      {new Date(row.updatedAt).toLocaleString("en-GB")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to="/sales/orders/new"
                        search={{ draftId: row.id }}
                        className="mr-3 font-semibold text-primary"
                      >
                        Continue
                      </Link>
                      <button
                        type="button"
                        onClick={() => void abandon(row.id)}
                        className="text-[12px] font-semibold text-steel hover:text-bad"
                      >
                        Abandon
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-4 text-[12px] text-steel">
          Placed orders appear in <Link to={ROUTES.adminOrders} className="font-semibold text-primary">Orders</Link>.
        </p>
      </div>
    </div>
  );
}
