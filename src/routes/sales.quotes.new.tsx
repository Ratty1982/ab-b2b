import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { customers, gbp, products } from "@/lib/data";

export const Route = createFileRoute("/sales/quotes/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    customer: typeof s.customer === "string" ? s.customer : "abc-motor-factors",
  }),
  head: () => ({
    meta: [
      { title: "Create quote — Sales Portal — Automotive Brands" },
      {
        name: "description",
        content:
          "Build a trade quote: choose the customer, add products at their pricing, apply authorised discount, set expiry and send.",
      },
      { property: "og:title", content: "Create quote — Sales Portal" },
      { property: "og:description", content: "Build and send a trade quote at customer pricing." },
    ],
  }),
  component: NewQuote,
});

type Line = { sku: string; qty: number; discount: number };

function NewQuote() {
  const search = Route.useSearch();
  const [customerId, setCustomerId] = useState(search.customer);
  const [term, setTerm] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { sku: "PM-4410", qty: 12, discount: 0 },
    { sku: "SS-2287", qty: 24, discount: 5 },
  ]);
  const [sent, setSent] = useState(false);

  const customer = customers.find((c) => c.id === customerId) ?? customers[0]!;
  const suggestions = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return products
      .filter((p) => p.sku.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
      .slice(0, 6);
  }, [term]);

  const resolved = lines.map((l) => {
    const p = products.find((x) => x.sku === l.sku);
    const unit = p ? p.trade * (1 - l.discount / 100) : 0;
    return { ...l, product: p, unit, total: unit * l.qty };
  });
  const subtotal = resolved.reduce((s, l) => s + l.total, 0);
  const vat = subtotal * 0.2;

  function addSku(sku: string) {
    setLines((ls) =>
      ls.some((l) => l.sku === sku)
        ? ls.map((l) => (l.sku === sku ? { ...l, qty: l.qty + 1 } : l))
        : [...ls, { sku, qty: 1, discount: 0 }],
    );
    setTerm("");
  }

  if (sent) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-good/40 bg-good/5 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold uppercase">Quote AB-10439 sent</h1>
          <p className="mt-2 text-[14px] text-steel">
            Sent to {customer.company} for {gbp(subtotal + vat)} including VAT. It will appear on
            their trade portal and on the customer record.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              to="/quote/$id"
              params={{ id: "AB-10428" }}
              className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold leading-10 text-primary-foreground"
            >
              Preview customer view
            </Link>
            <Link
              to="/sales/quotes"
              className="h-10 rounded-md border border-border px-5 text-[13px] font-semibold leading-10"
            >
              Back to quotes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title="Create quote"
        sub={`Pricing, catalogue and terms follow ${customer.company}`}
        actions={
          <>
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => setSent(true)}
              className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Send quote
            </button>
          </>
        }
      />

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Customer">
              <select
                className={inputClass}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company} — {c.number}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contact">
              <select className={inputClass} defaultValue="Karen Doyle">
                {["Karen Doyle", "Sue Marchant", "Tom Ashby"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Quote expires">
              <input type="date" className={inputClass} defaultValue="2026-10-10" />
            </Field>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              Add products
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) {
                    e.preventDefault();
                    addSku(suggestions[0].sku);
                  }
                }}
                placeholder="Search SKU, product name or brand"
                className={`${inputClass} pl-9`}
              />
              {suggestions.length ? (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-xl">
                  {suggestions.map((p) => (
                    <li key={p.sku}>
                      <button
                        type="button"
                        onClick={() => addSku(p.sku)}
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
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Availability</th>
                  <th className="px-3 py-2 text-right font-semibold">Customer price</th>
                  <th className="px-3 py-2 text-right font-semibold">Discount %</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Line total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {resolved.map((l, idx) => (
                  <tr key={l.sku} className="border-b border-border/60 last:border-0">
                    <td className="num px-3 py-2 text-primary">{l.sku}</td>
                    <td className="px-3 py-2">{l.product?.name ?? "Unknown SKU"}</td>
                    <td className="px-3 py-2">
                      {l.product ? <StockBadge stock={l.product.stock} /> : null}
                    </td>
                    <td className="num px-3 py-2 text-right">{gbp(l.unit)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={15}
                        value={l.discount}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, i) =>
                              i === idx ? { ...x, discount: Number(e.target.value) } : x,
                            ),
                          )
                        }
                        aria-label={`Discount for ${l.sku}`}
                        className="num h-9 w-16 rounded-md border border-border bg-ink px-2 text-right"
                      />
                    </td>
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
                    <td colSpan={8} className="px-3 py-10 text-center text-steel">
                      Search above to add the first product.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            {products.slice(0, 4).map((p) => (
              <button
                key={p.sku}
                type="button"
                onClick={() => addSku(p.sku)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-[12px] font-semibold hover:border-primary hover:text-primary"
              >
                <Plus className="size-3.5" aria-hidden />
                {p.sku}
              </button>
            ))}
            <span className="self-center text-[12px] text-steel">Frequently quoted lines</span>
          </div>

          <Field label="Notes to customer">
            <textarea
              rows={4}
              className={inputClass}
              defaultValue="Prices held for 21 days. Case quantities available on Steel Seal 300ml — please confirm if you would like case pricing applied."
            />
          </Field>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <h2 className="font-display text-lg font-semibold uppercase">Quote summary</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              {[
                ["Lines", String(resolved.length)],
                ["Subtotal (ex VAT)", gbp(subtotal)],
                ["VAT at 20%", gbp(vat)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-steel">{k}</dt>
                  <dd className="num font-semibold">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="font-semibold">Quote total</dt>
                <dd className="num font-display text-xl font-semibold text-primary">
                  {gbp(subtotal + vat)}
                </dd>
              </div>
            </dl>
          </div>

          <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {[
              ["Account", customer.number],
              ["Price group (internal)", "Trade A"],
              ["Payment terms", "30 Days Net"],
              ["Authorised discount", "Up to 15%"],
              ["Prepared by", "James Whitfield"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-3 py-2.5">
                <dt className="text-steel">{k}</dt>
                <dd className="num font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="text-[12px] text-steel">
            Accepted quotes convert straight into a sales order using the customer&rsquo;s delivery
            addresses and payment terms.
          </p>
        </aside>
      </div>
    </div>
  );
}
