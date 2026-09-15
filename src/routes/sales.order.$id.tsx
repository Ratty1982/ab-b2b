import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, StockBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { customers, gbp, gbp0, products } from "@/lib/data";
import { deliveryAddresses, usualProducts } from "@/lib/crm-data";

export const Route = createFileRoute("/sales/order/$id")({
  loader: ({ params }) => {
    const customer = customers.find((c) => c.id === params.id);
    if (!customer) throw notFound();
    return { customer };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Customer not found — Automotive Brands" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    return {
      meta: [
        { title: `Ordering for ${loaderData.customer.company} — Automotive Brands` },
        {
          name: "description",
          content: `Place an order on behalf of ${loaderData.customer.company} using their trade pricing, credit, payment terms and delivery addresses.`,
        },
        { property: "og:title", content: `Ordering for ${loaderData.customer.company}` },
        {
          property: "og:description",
          content: "Sales order entry on behalf of a trade customer.",
        },
      ],
    };
  },
  component: CustomerOrderMode,
});

type Line = { sku: string; qty: number };

function CustomerOrderMode() {
  const { customer } = Route.useLoaderData();
  const [lines, setLines] = useState<Line[]>([{ sku: "PM-4410", qty: 6 }]);
  const [term, setTerm] = useState("");
  const [placed, setPlaced] = useState(false);

  const suggestions = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return products
      .filter((p) => p.sku.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
      .slice(0, 6);
  }, [term]);

  const resolved = lines.map((l) => {
    const p = products.find((x) => x.sku === l.sku);
    return { ...l, product: p, total: (p?.trade ?? 0) * l.qty };
  });
  const subtotal = resolved.reduce((s, l) => s + l.total, 0);
  const delivery = subtotal >= 250 ? 0 : 8.95;
  const vat = (subtotal + delivery) * 0.2;
  const total = subtotal + delivery + vat;
  const availableCredit = 8940;

  function add(sku: string, qty = 1) {
    setLines((ls) =>
      ls.some((l) => l.sku === sku)
        ? ls.map((l) => (l.sku === sku ? { ...l, qty: l.qty + qty } : l))
        : [...ls, { sku, qty }],
    );
    setTerm("");
  }

  return (
    <div>
      {/* Persistent acting-on-behalf banner with a safe exit */}
      <div className="sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-primary/40 bg-primary/15 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge tone="brand">Customer ordering mode</StatusBadge>
          <span className="min-w-0 truncate text-[13px] font-semibold">
            Ordering for {customer.company}
          </span>
          <span className="num hidden text-[12px] text-steel sm:inline">
            {customer.number} · Trade A pricing · 30 Days Net · Available credit {gbp0(availableCredit)}
          </span>
        </div>
        <Link
          to="/sales/customers/$id"
          params={{ id: customer.id }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-ink px-3 text-[12px] font-semibold hover:border-steel"
        >
          <X className="size-3.5" aria-hidden />
          Exit customer mode
        </Link>
      </div>

      <PanelHeader
        title="Place order for customer"
        sub={`${customer.company} · ${customer.location} · Account manager ${customer.manager}`}
      />

      {placed ? (
        <div className="p-6">
          <div className="mx-auto max-w-xl rounded-lg border border-good/40 bg-good/5 p-8 text-center">
            <h2 className="font-display text-2xl font-semibold uppercase">Order AB-9884 placed</h2>
            <p className="mt-2 text-[14px] text-steel">
              Placed on behalf of {customer.company} for {gbp(total)} including VAT against their 30
              day account. A confirmation has been emailed to Karen Doyle.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link
                to="/sales/customers/$id"
                params={{ id: customer.id }}
                className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold leading-10 text-primary-foreground"
              >
                Back to customer record
              </Link>
              <button
                type="button"
                onClick={() => {
                  setPlaced(false);
                  setLines([]);
                }}
                className="h-10 rounded-md border border-border px-5 text-[13px] font-semibold"
              >
                Start another order
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) {
                    e.preventDefault();
                    add(suggestions[0].sku);
                  }
                }}
                placeholder="Search the customer's permitted catalogue by SKU or product"
                className={`${inputClass} pl-9`}
              />
              {suggestions.length ? (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-xl">
                  {suggestions.map((p) => (
                    <li key={p.sku}>
                      <button
                        type="button"
                        onClick={() => add(p.sku)}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                      >
                        <span className="num text-primary">{p.sku}</span>
                        <span className="min-w-0 truncate">{p.name}</span>
                        <span className="num shrink-0 font-semibold">{gbp(p.trade)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="self-center text-[12px] font-semibold uppercase tracking-wide text-steel">
                Usually orders
              </span>
              {usualProducts.map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  onClick={() => add(p.sku, p.qty)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-[12px] font-semibold hover:border-primary hover:text-primary"
                >
                  <span className="num">{p.sku}</span>
                  <span className="text-steel">×{p.qty}</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold">Availability</th>
                    <th className="px-3 py-2 text-right font-semibold">Customer price</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Line total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((l, idx) => (
                    <tr key={l.sku} className="border-b border-border/60 last:border-0">
                      <td className="num px-3 py-2 text-primary">{l.sku}</td>
                      <td className="px-3 py-2">{l.product?.name}</td>
                      <td className="px-3 py-2">
                        {l.product ? <StockBadge stock={l.product.stock} /> : null}
                      </td>
                      <td className="num px-3 py-2 text-right">{gbp(l.product?.trade ?? 0)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((x, i) =>
                                i === idx ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x,
                              ),
                            )
                          }
                          aria-label={`Quantity for ${l.sku}`}
                          className="num h-9 w-20 rounded-md border border-border bg-ink px-2 text-right"
                        />
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold">{gbp(l.total)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                          aria-label={`Remove ${l.sku}`}
                          className="text-steel hover:text-destructive"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {resolved.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-steel">
                        No lines yet — search or use the customer&rsquo;s usual products.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer purchase order number">
                <input className={inputClass} placeholder="PO-44165" />
              </Field>
              <Field label="Requested delivery date">
                <input type="date" className={inputClass} defaultValue="2026-09-18" />
              </Field>
              <Field label="Delivery address">
                <select className={inputClass}>
                  {deliveryAddresses.map((d) => (
                    <option key={d.id}>
                      {d.label} — {d.line}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Delivery method">
                <select className={inputClass}>
                  {["Next day — carrier", "Two day — carrier", "AB van route (Tue/Thu)", "Collection from Tyseley"].map(
                    (d) => (
                      <option key={d}>{d}</option>
                    ),
                  )}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Delivery instructions">
                  <textarea
                    rows={3}
                    className={inputClass}
                    defaultValue="Deliver to trade counter before 11am. Ask for Karen."
                  />
                </Field>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-lg border border-border bg-surface/50 p-4">
              <h2 className="font-display text-lg font-semibold uppercase">Order summary</h2>
              <dl className="mt-3 space-y-2 text-[13px]">
                {[
                  ["Subtotal (ex VAT)", gbp(subtotal)],
                  ["Delivery", delivery ? gbp(delivery) : "Free over £250"],
                  ["VAT at 20%", gbp(vat)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-steel">{k}</dt>
                    <dd className="num font-semibold">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-2">
                  <dt className="font-semibold">Order total</dt>
                  <dd className="num font-display text-xl font-semibold text-primary">
                    {gbp(total)}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 rounded-md border border-border bg-ink p-3 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-steel">Available credit after order</span>
                  <span
                    className={`num font-semibold ${availableCredit - total < 0 ? "text-destructive" : "text-good"}`}
                  >
                    {gbp0(availableCredit - total)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={resolved.length === 0}
                onClick={() => setPlaced(true)}
                className="mt-4 h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
              >
                Place order on account
              </button>
              <p className="mt-2 text-center text-[11px] text-steel">
                Placed by James Whitfield on behalf of {customer.company}
              </p>
            </div>

            <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
              {[
                ["Account", customer.number],
                ["Payment terms", "30 Days Net"],
                ["Credit limit", gbp0(15000)],
                ["Available credit", gbp0(availableCredit)],
                ["Permitted catalogues", "All five brands"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2.5">
                  <dt className="text-steel">{k}</dt>
                  <dd className="num font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}
