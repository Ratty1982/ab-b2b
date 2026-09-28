import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import { listPortalHistoricPurchasesFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/purchases")({
  head: () => ({
    meta: [
      { title: "Previously purchased — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Historic Autopart purchase history for your trade account.",
      },
    ],
  }),
  component: PortalPurchasesPage,
});

type Item = Extract<
  Awaited<ReturnType<typeof listPortalHistoricPurchasesFn>>,
  { ok: true }
>["data"]["items"][number];

function gbp(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return `£${v}`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function PortalPurchasesPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"ALL" | "AVAILABLE" | "UNAVAILABLE">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const r = await listPortalHistoricPurchasesFn({ data: { q, filter } });
      if (!r.ok) {
        setError(r.error);
        setItems([]);
      } else {
        setError(null);
        setItems(r.data.items);
      }
      setLoading(false);
    })();
  }, [q, filter]);

  return (
    <div>
      <PanelHeader
        title="Previously purchased"
        sub="Historic Autopart account purchases — not AB order history"
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4 sm:p-6">
        <label className="text-[12px]">
          Search
          <input
            className="mt-1 block h-10 w-56 rounded-md border border-border px-3 text-[13px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Product or SKU"
          />
        </label>
        <label className="text-[12px]">
          Filter
          <select
            className="mt-1 block h-10 rounded-md border border-border px-3 text-[13px]"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="ALL">All</option>
            <option value="AVAILABLE">Currently available</option>
            <option value="UNAVAILABLE">No longer available</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="p-6 text-[13px] text-steel">Loading purchase history…</p>
      ) : error ? (
        <p className="p-6 text-[13px] text-bad">{error}</p>
      ) : items.length === 0 ? (
        <div className="p-6">
          <p className="text-[14px] text-steel">
            No historic purchase data is available for your account yet.
          </p>
          <Link to={ROUTES.products} className="mt-4 inline-block text-[13px] font-semibold text-primary">
            Shop products
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto p-4 sm:p-6">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                <th className="py-2 pr-2">Product</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2 text-right">Net units</th>
                <th className="py-2 pr-2 text-right">Historic net spend</th>
                <th className="py-2 pr-2">Last purchased</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.sku} className="border-b border-border/60">
                  <td className="py-3 pr-2 font-medium">{item.name}</td>
                  <td className="py-3 pr-2 font-mono text-[12px] text-steel">{item.sku}</td>
                  <td className="py-3 pr-2 text-right">{item.netUnits}</td>
                  <td className="py-3 pr-2 text-right">{gbp(item.netSpend)}</td>
                  <td className="py-3 pr-2 text-steel">
                    {item.lastPurchasedDate
                      ? formatQuoteDateOnlyUk(item.lastPurchasedDate)
                      : "—"}
                  </td>
                  <td className="py-3 text-right">
                    {item.canBuyAgain ? (
                      <Link
                        to="/products/$sku"
                        params={{ sku: item.sku }}
                        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
                      >
                        Buy again
                      </Link>
                    ) : (
                      <span className="text-[11px] text-steel">Historic only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[12px] text-steel">
            Buy again uses current catalogue pricing, case quantities, stock and delivery rules —
            not historic prices.
          </p>
        </div>
      )}
    </div>
  );
}
