import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { customers, gbp, products, promos } from "@/lib/data";
import { priceGroups } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/pricing")({
  head: () => ({
    meta: [
      { title: "Price Lists & Promotions — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Maintain RRP, trade list and trade group pricing, customer-specific contract pricing, quantity breaks and promotional pricing.",
      },
      { property: "og:title", content: "Price Lists & Promotions — Automotive Brands Admin" },
      { property: "og:description", content: "Price groups, contract pricing and promotions." },
    ],
  }),
  component: AdminPricing,
});

const multipliers: Record<string, number> = {
  "Trade List": 1,
  "Trade A": 0.94,
  "Trade B": 0.97,
  "Trade C": 0.99,
  Distributor: 0.88,
  "Buying Group": 0.9,
};

function AdminPricing() {
  const [tab, setTab] = useState<"Price lists" | "Customer pricing" | "Promotions">("Price lists");

  return (
    <div>
      <PanelHeader
        title="Pricing"
        sub="Price groups, contract pricing, quantity breaks and promotions"
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            New price list
          </button>
        }
      />

      <div className="flex gap-1 border-b border-border/70 px-4 sm:px-6">
        {(["Price lists", "Customer pricing", "Promotions"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Price lists" ? (
        <div className="p-4 sm:p-6">
          <p className="mb-3 text-[13px] text-steel">
            Trade customers never see price group names — every signed-in account simply sees its
            own price.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 text-right font-semibold">RRP</th>
                  {priceGroups.map((g) => (
                    <th key={g} className="px-3 py-2 text-right font-semibold">
                      {g}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.sku} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="num px-3 py-2 text-primary">{p.sku}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="num px-3 py-2 text-right text-steel">{gbp(p.rrp)}</td>
                    {priceGroups.map((g) => (
                      <td key={g} className="num px-3 py-2 text-right">
                        {gbp(p.trade * (multipliers[g] ?? 1))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "Customer pricing" ? (
        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Company</th>
                  <th className="px-3 py-2 font-semibold">Account</th>
                  <th className="px-3 py-2 font-semibold">Price group</th>
                  <th className="px-3 py-2 text-right font-semibold">Contract lines</th>
                  <th className="px-3 py-2 font-semibold">Quantity breaks</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c, i) => (
                  <tr key={c.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-medium">{c.company}</td>
                    <td className="num px-3 py-2 text-steel">{c.number}</td>
                    <td className="px-3 py-2">
                      <select
                        defaultValue={priceGroups[(i % (priceGroups.length - 1)) + 1]}
                        aria-label={`Price group for ${c.company}`}
                        className="h-8 rounded-md border border-border bg-ink px-2 text-[12px]"
                      >
                        {priceGroups.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num px-3 py-2 text-right">{(i * 3) % 11}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={i % 2 ? "good" : "neutral"}>
                        {i % 2 ? "Enabled" : "Standard"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                        Edit pricing
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {promos.map((p) => (
              <li key={p.code} className="rounded-lg border border-border bg-surface/40 p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <span className="num min-w-0 truncate font-semibold text-primary">{p.code}</span>
                  <StatusBadge tone="good">Live</StatusBadge>
                </div>
                <p className="mt-1 text-[13px] font-semibold">{p.title}</p>
                <p className="text-[12px] text-steel">{p.detail}</p>
                <p className="num mt-2 text-[11px] text-steel">Ends {p.ends}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="h-9 flex-1 rounded-md border border-border text-[12px] font-semibold">
                    Edit
                  </button>
                  <button type="button" className="h-9 flex-1 rounded-md border border-border text-[12px] font-semibold">
                    End promotion
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
