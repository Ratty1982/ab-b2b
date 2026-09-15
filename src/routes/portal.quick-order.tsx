import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ClipboardPaste, Plus, Repeat, ScanLine, Trash2, Upload } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge } from "@/components/ab/Badges";
import { gbp, orderLists, products, recentOrders } from "@/lib/data";
import { usualProducts } from "@/lib/crm-data";

export const Route = createFileRoute("/portal/quick-order")({
  head: () => ({
    meta: [
      { title: "Quick Order — Automotive Brands Trade Portal" },
      {
        name: "description",
        content:
          "Enter SKUs, scan a barcode, paste a list or upload a CSV to build a trade order in seconds. Your pricing and live availability on every line.",
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

const resolve = (sku: string) =>
  products.find((p) => p.sku.toLowerCase() === sku.trim().toLowerCase());

const search = (term: string) => {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  return products
    .filter(
      (p) =>
        p.sku.toLowerCase().includes(t) ||
        p.name.toLowerCase().includes(t) ||
        p.brand.toLowerCase().includes(t),
    )
    .slice(0, 6);
};

function QuickOrder() {
  const [lines, setLines] = useState<Line[]>([
    { id: 1, sku: "PM-4410", qty: 8 },
    { id: 2, sku: "SS-1104", qty: 24 },
    { id: 3, sku: "", qty: 0 },
  ]);
  const [paste, setPaste] = useState("");
  const [barcode, setBarcode] = useState("");
  const [focused, setFocused] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastRowRef = useRef<HTMLInputElement | null>(null);

  const priceFor = (sku: string, qty: number) => {
    const p = resolve(sku);
    if (!p) return 0;
    return [...p.breaks].reverse().find((b) => qty >= b.qty)?.price ?? p.trade;
  };

  const update = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addRow = () => {
    setLines((ls) => [...ls, { id: nextId++, sku: "", qty: 0 }]);
    requestAnimationFrame(() => lastRowRef.current?.focus());
  };

  const addSku = (sku: string, qty = 1) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.sku.toLowerCase() === sku.toLowerCase());
      if (existing) {
        return ls.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + qty } : l));
      }
      const blank = ls.find((l) => !l.sku);
      if (blank) return ls.map((l) => (l.id === blank.id ? { ...l, sku, qty } : l));
      return [...ls, { id: nextId++, sku, qty }];
    });
  };

  const loadLines = (entries: { sku: string; qty: number }[], message: string) => {
    setLines(entries.map((e) => ({ id: nextId++, ...e })).concat({ id: nextId++, sku: "", qty: 0 }));
    setNotice(message);
  };

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

  const submitBarcode = (e: React.FormEvent) => {
    e.preventDefault();
    const match = products.find((p) => p.sku.toLowerCase() === barcode.trim().toLowerCase());
    if (match) {
      addSku(match.sku, match.packQty);
      setNotice(`${match.sku} scanned — pack of ${match.packQty} added`);
    } else if (barcode.trim()) {
      setNotice(`Barcode ${barcode.trim()} not recognised`);
    }
    setBarcode("");
  };

  const valid = lines.filter((l) => resolve(l.sku) && l.qty > 0);
  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + priceFor(l.sku, l.qty) * l.qty, 0),
    [lines],
  );
  const vat = subtotal * 0.2;
  const delivery = subtotal > 250 ? 0 : 9.5;

  return (
    <div>
      <PanelHeader
        title="Quick Order"
        sub="Type a SKU or product name, scan, paste or upload — your pricing and stock resolve instantly"
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                loadLines(
                  [
                    { sku: "PM-4410", qty: 12 },
                    { sku: "SS-2287", qty: 24 },
                    { sku: "BP-5540", qty: 6 },
                  ],
                  "Loaded order AB-9821 (10 Sep 2026)",
                )
              }
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              <Repeat className="size-4" aria-hidden /> Reorder previous order
            </button>
            <button
              type="button"
              onClick={() =>
                loadLines(
                  usualProducts.map((u) => ({ sku: u.sku, qty: u.qty })),
                  "Loaded your usual products",
                )
              }
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Order my usual products
            </button>
          </>
        }
      />

      {/* Frequently ordered quick-add */}
      <div className="border-b border-border bg-surface/40 p-4 sm:px-6">
        <div className="text-[10px] uppercase tracking-[0.16em] text-steel">
          Frequently ordered — tap to add
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {usualProducts.map((u) => {
            const p = resolve(u.sku);
            return (
              <button
                key={u.sku}
                type="button"
                onClick={() => addSku(u.sku, u.qty)}
                className="group inline-flex items-center gap-2 rounded-md border border-border bg-ink px-3 py-2 text-left text-[12px] transition-colors hover:border-primary"
              >
                <Plus className="size-3.5 text-primary" aria-hidden />
                <span className="num font-semibold">{u.sku}</span>
                <span className="hidden max-w-40 truncate text-steel sm:inline">{u.name}</span>
                <span className="num text-steel">+{u.qty}</span>
                {p ? <span className="num text-steel">{gbp(p.trade)}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="border-b border-border bg-primary/10 px-4 py-2 text-[12px] font-semibold text-primary sm:px-6"
        >
          {notice}
        </div>
      ) : null}

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU / Product</th>
                  <th className="px-3 py-2 font-semibold">Pack / Case</th>
                  <th className="px-3 py-2 font-semibold">Availability</th>
                  <th className="px-3 py-2 text-right font-semibold">Your price</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Line total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const p = resolve(l.sku);
                  const unit = priceFor(l.sku, l.qty);
                  const suggestions = focused === l.id && !p ? search(l.sku) : [];
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}
                    >
                      <td className="relative px-3 py-2">
                        <label className="sr-only" htmlFor={`sku-${l.id}`}>
                          SKU or product for line {i + 1}
                        </label>
                        <input
                          id={`sku-${l.id}`}
                          ref={i === lines.length - 1 ? lastRowRef : undefined}
                          value={l.sku}
                          onChange={(e) => update(l.id, { sku: e.target.value })}
                          onFocus={() => setFocused(l.id)}
                          onBlur={() => window.setTimeout(() => setFocused(null), 150)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const first = search(l.sku)[0];
                              if (!p && first) update(l.id, { sku: first.sku, qty: l.qty || first.packQty });
                              else if (i === lines.length - 1) addRow();
                            }
                          }}
                          placeholder="Enter SKU or product name"
                          className="num h-9 w-full min-w-48 rounded-md border border-border bg-surface px-2.5 uppercase"
                        />
                        {suggestions.length > 0 ? (
                          <ul className="absolute z-20 mt-1 w-80 overflow-hidden rounded-md border border-border bg-ink shadow-2xl">
                            {suggestions.map((s) => (
                              <li key={s.sku}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => update(l.id, { sku: s.sku, qty: l.qty || s.packQty })}
                                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-left hover:bg-surface"
                                >
                                  <span className="min-w-0">
                                    <span className="num block text-[12px] font-semibold text-primary">
                                      {s.sku}
                                    </span>
                                    <span className="block truncate text-[12px] text-steel">
                                      {s.brand} · {s.name}
                                    </span>
                                  </span>
                                  <span className="num self-center text-[12px] font-semibold">
                                    {gbp(s.trade)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {p ? (
                          <div className="mt-1 truncate text-[11px] text-steel">
                            {p.brand} · {p.name}
                          </div>
                        ) : l.sku && suggestions.length === 0 ? (
                          <div className="mt-1 text-[11px] text-destructive">SKU not recognised</div>
                        ) : null}
                      </td>
                      <td className="num px-3 py-2 text-steel">
                        {p ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => update(l.id, { qty: l.qty + p.packQty })}
                              className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                            >
                              +Pack {p.packQty}
                            </button>
                            <button
                              type="button"
                              onClick={() => update(l.id, { qty: l.qty + p.caseQty })}
                              className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                            >
                              +Case {p.caseQty}
                            </button>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p ? (
                          <StockBadge stock={p.stock} qty={p.stockQty} />
                        ) : (
                          <span className="text-steel">—</span>
                        )}
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
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addRow();
                            }
                          }}
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

          {/* Mobile line cards */}
          <ul className="space-y-3 md:hidden">
            {lines.map((l, i) => {
              const p = resolve(l.sku);
              const unit = priceFor(l.sku, l.qty);
              return (
                <li key={l.id} className="rounded-lg border border-border bg-surface/40 p-3">
                  <label className="sr-only" htmlFor={`m-sku-${l.id}`}>
                    SKU for line {i + 1}
                  </label>
                  <input
                    id={`m-sku-${l.id}`}
                    value={l.sku}
                    onChange={(e) => update(l.id, { sku: e.target.value })}
                    placeholder="SKU or product name"
                    className="num h-11 w-full rounded-md border border-border bg-surface px-3 uppercase"
                  />
                  {p ? (
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                        <span className="num block text-[11px] text-steel">
                          {gbp(unit)} · pack {p.packQty} · case {p.caseQty}
                        </span>
                      </span>
                      <StockBadge stock={p.stock} qty={p.stockQty} />
                    </div>
                  ) : null}
                  <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => update(l.id, { qty: Math.max(0, l.qty - (p?.packQty ?? 1)) })}
                      className="h-11 w-11 rounded-md border border-border text-lg"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      aria-label={`Quantity for line ${i + 1}`}
                      value={l.qty || ""}
                      onChange={(e) => update(l.id, { qty: Number(e.target.value) })}
                      className="num h-11 w-full rounded-md border border-border bg-surface text-center"
                    />
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => update(l.id, { qty: l.qty + (p?.packQty ?? 1) })}
                      className="h-11 w-11 rounded-md border border-border text-lg"
                    >
                      +
                    </button>
                  </div>
                  <div className="num mt-2 flex items-center justify-between text-[13px]">
                    <span className="text-steel">Line total</span>
                    <span className="font-semibold">{p ? gbp(unit * l.qty) : "—"}</span>
                  </div>
                </li>
              );
            })}
          </ul>

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
            <form onSubmit={submitBarcode} className="flex h-10 items-center gap-2">
              <label className="sr-only" htmlFor="barcode">
                Scan or enter a barcode
              </label>
              <div className="flex h-10 items-center gap-2 rounded-md border border-border px-3">
                <ScanLine className="size-4 text-primary" aria-hidden />
                <input
                  id="barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Scan barcode"
                  className="num h-8 w-36 bg-transparent text-[13px] outline-none"
                />
              </div>
              <button
                type="submit"
                className="h-10 rounded-md border border-border px-3 text-[13px] font-semibold transition-colors hover:border-steel"
              >
                Add
              </button>
            </form>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface/40 p-4">
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

            <div className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="text-[13px] font-semibold">Saved order lists</div>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border text-[13px]">
                {orderLists.map((list) => (
                  <li key={list.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{list.name}</span>
                      <span className="num block text-[11px] text-steel">
                        {list.lines} lines · updated {list.updated}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        loadLines(
                          usualProducts.slice(0, 4).map((u) => ({ sku: u.sku, qty: u.qty })),
                          `Loaded list “${list.name}”`,
                        )
                      }
                      className="self-center text-[12px] font-semibold text-primary hover:underline"
                    >
                      Load
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-[13px] font-semibold">Reorder a previous order</div>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border text-[13px]">
                {recentOrders.slice(0, 3).map((o) => (
                  <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="num block font-medium text-primary">{o.id}</span>
                      <span className="num block text-[11px] text-steel">
                        {o.date} · {o.lines} lines · {gbp(o.value)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        loadLines(
                          [
                            { sku: "PM-4410", qty: 12 },
                            { sku: "SS-2287", qty: 24 },
                            { sku: "BP-5540", qty: 6 },
                          ],
                          `Loaded order ${o.id}`,
                        )
                      }
                      className="self-center text-[12px] font-semibold text-primary hover:underline"
                    >
                      Reorder
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-lg border border-border bg-surface/60 p-5">
            <h2 className="font-display text-lg font-semibold uppercase">Order summary</h2>
            <dl className="num mt-4 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-steel">Lines</dt>
                <dd>{valid.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">Units</dt>
                <dd>{valid.reduce((s, l) => s + l.qty, 0)}</dd>
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
                <dd>{delivery === 0 ? "Free" : gbp(delivery)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base">
                <dt className="font-semibold">Order total</dt>
                <dd className="font-display font-semibold">{gbp(subtotal + vat + delivery)}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="mt-5 h-11 w-full rounded-md bg-primary text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Add all to basket
            </button>
            <button
              type="button"
              className="mt-2 h-11 w-full rounded-md border border-border text-sm font-semibold transition-colors hover:border-steel"
            >
              Save as order list
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-steel">
              Orders placed against account ABC001 · 30 Days Net · Purchase order number required at
              checkout.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
