import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardPaste, Plus, Repeat, Trash2, Upload } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge } from "@/components/ab/Badges";
import { gbp, products } from "@/lib/data";

export const Route = createFileRoute("/portal/quick-order")({
  head: () => ({
    meta: [
      { title: "Quick Order — Automotive Brands Trade Portal" },
      {
        name: "description",
        content:
          "Enter SKUs, paste a list or upload a CSV to build a trade order in seconds. Live trade pricing and availability on every line.",
      },
      { property: "og:title", content: "Quick Order — Automotive Brands" },
      { property: "og:description", content: "Fast SKU-based order entry for trade customers." },
    ],
  }),
  component: QuickOrder,
});

interface Line {
  id: number;
  sku: string;
  qty: number;
}

let nextId = 4;

function QuickOrder() {
  const [lines, setLines] = useState<Line[]>([
    { id: 1, sku: "PM-4410", qty: 8 },
    { id: 2, sku: "SS-1104", qty: 24 },
    { id: 3, sku: "", qty: 0 },
  ]);
  const [paste, setPaste] = useState("");

  const resolve = (sku: string) =>
    products.find((p) => p.sku.toLowerCase() === sku.trim().toLowerCase());

  const priceFor = (sku: string, qty: number) => {
    const p = resolve(sku);
    if (!p) return 0;
    return [...p.breaks].reverse().find((b) => qty >= b.qty)?.price ?? p.trade;
  };

  const update = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addRow = () => setLines((ls) => [...ls, { id: nextId++, sku: "", qty: 0 }]);

  const applyPaste = () => {
    const parsed = paste
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sku, qty] = entry.split(/[\s\t|x]+/);
        return { id: nextId++, sku: sku ?? "", qty: Number(qty) || 1 };
      });
    if (parsed.length) setLines((ls) => [...ls.filter((l) => l.sku), ...parsed]);
    setPaste("");
  };

  const subtotal = lines.reduce((sum, l) => sum + priceFor(l.sku, l.qty) * l.qty, 0);
  const vat = subtotal * 0.2;

  return (
    <div>
      <PanelHeader
        title="Quick Order"
        sub="Enter SKUs, paste a list or upload a CSV — pricing and stock resolve instantly"
        actions={
          <>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              <Repeat className="size-4" aria-hidden /> Reorder previous order
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Order my usual products
            </button>
          </>
        }
      />

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU / Product</th>
                  <th className="px-3 py-2 font-semibold">Availability</th>
                  <th className="px-3 py-2 text-right font-semibold">Trade Price</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = resolve(l.sku);
                  const unit = priceFor(l.sku, l.qty);
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`sku-${l.id}`}>
                          SKU for line {i + 1}
                        </label>
                        <input
                          id={`sku-${l.id}`}
                          value={l.sku}
                          onChange={(e) => update(l.id, { sku: e.target.value })}
                          placeholder="Enter SKU or product name"
                          className="num h-9 w-full min-w-40 rounded-md border border-border bg-surface px-2.5 uppercase"
                        />
                        {p ? (
                          <div className="mt-1 truncate text-[11px] text-steel">
                            {p.brand} · {p.name}
                          </div>
                        ) : l.sku ? (
                          <div className="mt-1 text-[11px] text-destructive">SKU not recognised</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {p ? <StockBadge stock={p.stock} qty={p.stockQty} /> : <span className="text-steel">—</span>}
                      </td>
                      <td className="num px-3 py-2 text-right">{p ? gbp(unit) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <label className="sr-only" htmlFor={`qty-${l.id}`}>
                          Quantity for line {i + 1}
                        </label>
                        <input
                          id={`qty-${l.id}`}
                          type="number"
                          min={0}
                          value={l.qty || ""}
                          onChange={(e) => update(l.id, { qty: Number(e.target.value) })}
                          className="num h-9 w-20 rounded-md border border-border bg-surface px-2 text-right"
                        />
                      </td>
                      <td className="num px-3 py-2 text-right font-semibold">
                        {p ? gbp(unit * l.qty) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                          aria-label={`Remove line ${i + 1}`}
                          className="grid size-8 place-items-center rounded-md border border-border text-steel hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              <Plus className="size-4" aria-hidden /> Add row
            </button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel">
              <Upload className="size-4" aria-hidden /> Upload CSV
              <input type="file" accept=".csv" className="sr-only" />
            </label>
          </div>

          <div className="mt-6 rounded-lg border border-border bg-surface/40 p-4">
            <label htmlFor="paste" className="flex items-center gap-2 text-[13px] font-semibold">
              <ClipboardPaste className="size-4" aria-hidden /> Paste multiple SKUs
            </label>
            <p className="mt-1 text-[12px] text-steel">
              One per line, as <span className="num">SKU QTY</span> — for example{" "}
              <span className="num">PM-2201 10</span>
            </p>
            <textarea
              id="paste"
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"PM-2201 10\nBP-5540 6\nSR-8812 4"}
              className="num mt-2 w-full rounded-md border border-border bg-surface p-3 text-[13px]"
            />
            <button
              type="button"
              onClick={applyPaste}
              className="mt-2 h-10 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Add pasted lines
            </button>
          </div>
        </section>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-lg border border-border bg-surface/60 p-5">
            <h2 className="font-display text-lg font-semibold uppercase">Order summary</h2>
            <dl className="num mt-4 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-steel">Lines</dt>
                <dd>{lines.filter((l) => resolve(l.sku) && l.qty > 0).length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">Subtotal (ex VAT)</dt>
                <dd className="font-semibold">{gbp(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">VAT at 20%</dt>
                <dd>{gbp(vat)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">Delivery</dt>
                <dd>{subtotal > 250 ? "Free" : gbp(9.5)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base">
                <dt className="font-semibold">Order total</dt>
                <dd className="font-display font-semibold">
                  {gbp(subtotal + vat + (subtotal > 250 ? 0 : 9.5))}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="mt-5 h-11 w-full rounded-md bg-primary text-sm font-bold text-primary-foreground transition hover:brightness-110"
            >
              Add all to basket
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-steel">
              Orders placed against account {"ABC001"} · 30 Days Net · Purchase order number
              required at checkout.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
