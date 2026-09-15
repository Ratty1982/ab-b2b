import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LayoutGrid, Rows3, Search, Heart, Plus } from "lucide-react";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { StockBadge } from "@/components/ab/Badges";
import { brands, products, gbp, type Product } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>): { brand?: string } =>
    typeof search["brand"] === "string" ? { brand: search["brand"] } : {},
  head: () => ({
    meta: [
      { title: "Trade Product Catalogue — Automotive Brands" },
      {
        name: "description",
        content:
          "Browse the Automotive Brands trade catalogue: SKUs, trade pricing, quantity breaks, pack quantities and live availability across every brand.",
      },
      { property: "og:title", content: "Trade Product Catalogue — Automotive Brands" },
      {
        property: "og:description",
        content: "Trade pricing, quantity breaks and live availability across every brand.",
      },
    ],
  }),
  component: Catalogue,
});

const categories = Array.from(new Set(products.map((p) => p.category)));
const availabilities = [
  { key: "all", label: "All" },
  { key: "in", label: "In stock only" },
] as const;

function Catalogue() {
  const { brand } = Route.useSearch();
  const [view, setView] = useState<"grid" | "compact">("grid");
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<string[]>(brand ? [brand] : []);
  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [avail, setAvail] = useState<"all" | "in">("all");
  const [maxPrice, setMaxPrice] = useState(250);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.name} ${p.sku} ${p.brand} ${p.category}`.toLowerCase().includes(q)) return false;
      if (brandFilter.length && !brandFilter.includes(p.brand)) return false;
      if (catFilter.length && !catFilter.includes(p.category)) return false;
      if (avail === "in" && p.stock !== "in") return false;
      if (p.trade > maxPrice) return false;
      return true;
    });
  }, [query, brandFilter, catFilter, avail, maxPrice]);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <PublicLayout>
      <div className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Products" }]} />
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-semibold uppercase tracking-tight">
                Trade Catalogue
              </h1>
              <p className="num mt-1 text-[12px] text-steel">
                {results.length} of {products.length} lines · prices exclude VAT
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-1">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-pressed={view === "grid"}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[12px] font-semibold",
                  view === "grid" ? "bg-primary text-primary-foreground" : "text-steel",
                )}
              >
                <LayoutGrid className="size-3.5" aria-hidden /> Grid
              </button>
              <button
                type="button"
                onClick={() => setView("compact")}
                aria-pressed={view === "compact"}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[12px] font-semibold",
                  view === "compact" ? "bg-primary text-primary-foreground" : "text-steel",
                )}
              >
                <Rows3 className="size-3.5" aria-hidden /> Compact
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-6">
          <div>
            <label htmlFor="cat-search" className="sr-only">
              Search products, SKUs and brands
            </label>
            <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3">
              <Search className="size-4 shrink-0 text-steel" aria-hidden />
              <input
                id="cat-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU or product"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-steel"
              />
            </div>
          </div>

          <FilterGroup title="Brand">
            {brands.map((b) => (
              <Check
                key={b.slug}
                checked={brandFilter.includes(b.name)}
                onChange={() => toggle(brandFilter, b.name, setBrandFilter)}
                label={b.name}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Category">
            {categories.map((c) => (
              <Check
                key={c}
                checked={catFilter.includes(c)}
                onChange={() => toggle(catFilter, c, setCatFilter)}
                label={c}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Availability">
            {availabilities.map((a) => (
              <label key={a.key} className="flex cursor-pointer items-center gap-2 text-[13px] text-steel">
                <input
                  type="radio"
                  name="availability"
                  checked={avail === a.key}
                  onChange={() => setAvail(a.key)}
                  className="accent-primary"
                />
                {a.label}
              </label>
            ))}
          </FilterGroup>

          <FilterGroup title={`Trade price up to ${gbp(maxPrice)}`}>
            <input
              type="range"
              min={5}
              max={250}
              step={5}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              aria-label="Maximum trade price"
              className="w-full accent-primary"
            />
          </FilterGroup>
        </aside>

        <section aria-label="Product results">
          {results.length === 0 ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-border p-16 text-center">
              <p className="font-display text-lg uppercase">No products match those filters</p>
              <p className="mt-1 text-sm text-steel">
                Try clearing a filter or searching a different SKU.
              </p>
            </div>
          ) : view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((p) => (
                <ProductCard key={p.sku} product={p} />
              ))}
            </div>
          ) : (
            <CompactTable rows={results} />
          )}
        </section>
      </div>
    </PublicLayout>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-steel hover:text-foreground">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />
      {label}
    </label>
  );
}

function ProductCard({ product: p }: { product: Product }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40">
      <Link to="/products/$sku" params={{ sku: p.sku }}>
        <img
          src={p.image}
          alt={p.name}
          loading="lazy"
          width={912}
          height={736}
          className="aspect-[4/3] w-full object-cover"
        />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="text-[11px] text-cyan">{p.brand}</div>
        <Link
          to="/products/$sku"
          params={{ sku: p.sku }}
          className="text-sm font-semibold leading-snug hover:text-primary"
        >
          {p.name}
        </Link>
        <div className="num mt-0.5 text-[12px] text-steel">
          SKU {p.sku} · Pack {p.packQty} · Case {p.caseQty}
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <TradePrice trade={p.trade} rrp={p.rrp} />
          <StockBadge stock={p.stock} qty={p.stockQty} />
        </div>
        {signedIn && (
          <div className="num mt-2 text-[11px] text-steel">
            {p.breaks[1]
              ? `${p.breaks[1].qty}+ @ ${gbp(p.breaks[1].price)}`
              : "No quantity breaks"}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          {signedIn ? (
            <>
              <button
                type="button"
                disabled={p.stock === "backorder" || p.stock === "out"}
                className="h-9 flex-1 rounded-md bg-primary text-[12px] font-bold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-steel"
              >
                {p.stock === "backorder" ? "Backorder" : "Add to basket"}
              </button>
              <button
                type="button"
                aria-label={`Add ${p.name} to an order list`}
                className="grid size-9 place-items-center rounded-md border border-border text-steel transition-colors hover:text-foreground"
              >
                <Heart className="size-4" aria-hidden />
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="grid h-9 flex-1 place-items-center rounded-md border border-border text-[12px] font-bold transition-colors hover:border-primary hover:text-primary"
            >
              Sign in to order
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function CompactTable({ rows }: { rows: Product[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[840px] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            <th className="px-3 py-2 font-semibold">SKU</th>
            <th className="px-3 py-2 font-semibold">Product</th>
            <th className="px-3 py-2 font-semibold">Brand</th>
            <th className="px-3 py-2 text-right font-semibold">Trade</th>
            <th className="px-3 py-2 text-right font-semibold">RRP</th>
            <th className="px-3 py-2 text-right font-semibold">Break</th>
            <th className="px-3 py-2 font-semibold">Stock</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr
              key={p.sku}
              className={cn(
                "border-b border-border/60 transition-colors hover:bg-secondary/60",
                i % 2 === 1 && "bg-surface/30",
              )}
            >
              <td className="num px-3 py-2 font-medium text-primary">
                <Link to="/products/$sku" params={{ sku: p.sku }}>
                  {p.sku}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Link to="/products/$sku" params={{ sku: p.sku }} className="hover:text-primary">
                  {p.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-steel">{p.brand}</td>
              <td className="num px-3 py-2 text-right font-semibold">
                <TradePriceCell trade={p.trade} rrp={p.rrp} />
              </td>
              <td className="num px-3 py-2 text-right text-steel">{gbp(p.rrp)}</td>
              <td className="num px-3 py-2 text-right text-steel">
                {p.breaks[1] ? `${p.breaks[1].qty}+ ${gbp(p.breaks[1].price)}` : "—"}
              </td>
              <td className="px-3 py-2">
                <StockBadge stock={p.stock} qty={p.stockQty} />
              </td>
              <td className="px-3 py-2 text-right">
                <label className="sr-only" htmlFor={`qty-${p.sku}`}>
                  Quantity for {p.sku}
                </label>
                <input
                  id={`qty-${p.sku}`}
                  type="number"
                  min={0}
                  step={p.packQty}
                  defaultValue={0}
                  className="num h-8 w-16 rounded-md border border-border bg-surface px-2 text-right"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  aria-label={`Add ${p.sku} to basket`}
                  className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground transition hover:brightness-110"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
