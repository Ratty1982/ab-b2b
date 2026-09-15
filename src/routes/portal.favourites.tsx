import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge } from "@/components/ab/Badges";
import { gbp, orderLists, products } from "@/lib/data";

export const Route = createFileRoute("/portal/favourites")({
  head: () => ({
    meta: [
      { title: "Favourites & Order Lists — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Saved order lists and favourite products for rapid repeat ordering.",
      },
      { property: "og:title", content: "Favourites & Order Lists — Automotive Brands" },
      { property: "og:description", content: "Saved lists for rapid repeat ordering." },
    ],
  }),
  component: Favourites,
});

function Favourites() {
  return (
    <div>
      <PanelHeader
        title="Favourites & order lists"
        sub="Saved lists load straight into Quick Order"
        actions={
          <Link
            to="/portal/quick-order"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Open Quick Order
          </Link>
        }
      />
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-3">
        <section className="xl:col-span-1">
          <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">
            Saved order lists
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {orderLists.map((l) => (
              <li key={l.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.name}</span>
                  <span className="num block text-[11px] text-steel">
                    {l.lines} lines · updated {l.updated}
                  </span>
                </span>
                <Link
                  to="/portal/quick-order"
                  className="self-center text-[12px] font-semibold text-primary hover:underline"
                >
                  Load
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="xl:col-span-2">
          <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-tight">
            Favourite products
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Brand</th>
                  <th className="px-3 py-2 text-right font-semibold">Your price</th>
                  <th className="px-3 py-2 font-semibold">Stock</th>
                  <th className="px-3 py-2 text-right font-semibold">Add</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 6).map((p, i) => (
                  <tr
                    key={p.sku}
                    className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                  >
                    <td className="num px-3 py-2 font-medium text-primary">
                      <Link to="/products/$sku" params={{ sku: p.sku }}>
                        {p.sku}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-steel">{p.brand}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{gbp(p.trade)}</td>
                    <td className="px-3 py-2">
                      <StockBadge stock={p.stock} qty={p.stockQty} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="h-8 rounded-md bg-primary px-3 text-[12px] font-bold text-primary-foreground transition hover:brightness-110"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
