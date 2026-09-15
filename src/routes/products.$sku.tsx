import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Heart, Minus, Plus } from "lucide-react";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { StockBadge, StatusBadge } from "@/components/ab/Badges";
import { products, gbp } from "@/lib/data";
import { TradeOnly, TradePrice } from "@/components/ab/Price";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/products/$sku")({
  loader: ({ params }) => {
    const product = products.find((p) => p.sku.toLowerCase() === params.sku.toLowerCase());
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Product unavailable — Automotive Brands" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { product } = loaderData;
    const desc = `${product.name} (${product.sku}) by ${product.brand}. RRP ${gbp(product.rrp)}. Trade customers sign in to view account pricing.`;
    return {
      meta: [
        { title: `${product.name} — ${product.sku} — Automotive Brands` },
        { name: "description", content: desc },
        { property: "og:title", content: `${product.name} — Automotive Brands` },
        { property: "og:description", content: desc },
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { product: p } = Route.useLoaderData();
  const { signedIn } = useSession();
  const [qty, setQty] = useState(p.packQty);
  const unit = [...p.breaks].reverse().find((b) => qty >= b.qty)?.price ?? p.trade;
  const related = products.filter((r) => r.sku !== p.sku).slice(0, 4);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Products", to: "/products" },
            { label: p.sku },
          ]}
        />

        <div className="mt-6 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <img
              src={p.image}
              alt={p.name}
              width={912}
              height={736}
              className="aspect-[4/3] w-full rounded-lg border border-border object-cover"
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <img
                  key={i}
                  src={p.image}
                  alt=""
                  loading="lazy"
                  width={228}
                  height={184}
                  className="aspect-[4/3] w-full rounded-md border border-border object-cover opacity-60 transition-opacity hover:opacity-100"
                />
              ))}
            </div>
          </div>

          <div className="lg:col-span-4">
            <Link
              to="/brands/$slug"
              params={{
                slug: p.brand.toLowerCase().replace(/\s+/g, "-"),
              }}
              className="text-[12px] uppercase tracking-[0.18em] text-cyan hover:text-foreground"
            >
              {p.brand}
            </Link>
            <h1 className="mt-2 font-display text-3xl font-semibold uppercase leading-tight tracking-tight">
              {p.name}
            </h1>
            <div className="num mt-2 flex flex-wrap items-center gap-3 text-[13px] text-steel">
              <span>SKU {p.sku}</span>
              <span aria-hidden>·</span>
              <span>{p.category}</span>
              <StockBadge stock={p.stock} qty={signedIn ? p.stockQty : undefined} />
            </div>

            <p className="mt-5 text-sm leading-relaxed text-steel">{p.description}</p>

            <h2 className="mt-8 font-display text-lg font-semibold uppercase">Features</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-steel">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-primary" aria-hidden>
                    —
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <h2 className="mt-8 font-display text-lg font-semibold uppercase">Specifications</h2>
            <dl className="mt-2 divide-y divide-border border border-border text-sm">
              {p.specs.map((s) => (
                <div key={s.label} className="grid grid-cols-2 gap-3 px-3 py-2">
                  <dt className="text-steel">{s.label}</dt>
                  <dd className="num text-right">{s.value}</dd>
                </div>
              ))}
            </dl>

            {p.applications ? (
              <>
                <h2 className="mt-8 font-display text-lg font-semibold uppercase">
                  Application / compatibility
                </h2>
                <ul className="mt-2 space-y-1.5 text-sm text-steel">
                  {p.applications.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2 className="mt-8 font-display text-lg font-semibold uppercase">Downloads</h2>
            <ul className="mt-2 divide-y divide-border border border-border text-sm">
              {p.downloads.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Download className="size-3.5 shrink-0 text-steel" aria-hidden />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="num shrink-0 text-[11px] text-steel">
                    {d.type} · {d.size}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <aside className="lg:col-span-3">
            <div className="sticky top-20 rounded-lg border border-border bg-surface/60 p-5">
              {signedIn ? (
                <>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-steel">
                    Your price
                  </div>
                  <div className="num mt-1 font-display text-4xl font-semibold">{gbp(unit)}</div>
                  <div className="num mt-1 text-[12px] text-steel">
                    RRP {gbp(p.rrp)} · {p.vat === "zero" ? "Zero rated VAT" : "Excludes VAT at 20%"}
                  </div>
                  <div className="mt-2">
                    <StatusBadge tone="brand">Account ABC001 pricing applied</StatusBadge>
                  </div>

                  <div className="mt-5 border-t border-border pt-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-steel">
                      Quantity breaks
                    </div>
                    <table className="num mt-2 w-full text-[12px]">
                      <tbody>
                        {p.breaks.map((b) => (
                          <tr
                            key={b.qty}
                            className={qty >= b.qty ? "text-foreground" : "text-steel"}
                          >
                            <td className="py-1">{b.qty}+</td>
                            <td className="py-1 text-right font-semibold">{gbp(b.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="num mt-3 text-[12px] text-steel">
                      Pack of {p.packQty} · Case of {p.caseQty}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-steel">
                    Recommended retail
                  </div>
                  <div className="num mt-1 font-display text-4xl font-semibold text-steel">
                    {gbp(p.rrp)}
                  </div>
                  <div className="num mt-1 text-[12px] text-steel">
                    Pack of {p.packQty} · Case of {p.caseQty}
                  </div>
                  <div className="mt-4">
                    <TradeOnly note="Trade pricing and quantity breaks are account-specific.">
                      <span />
                    </TradeOnly>
                  </div>
                </>
              )}

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((q) => Math.max(p.packQty, q - p.packQty))}
                  className="grid size-10 place-items-center rounded-md border border-border"
                >
                  <Minus className="size-4" aria-hidden />
                </button>
                <label className="sr-only" htmlFor="qty">
                  Quantity
                </label>
                <input
                  id="qty"
                  type="number"
                  min={p.packQty}
                  step={p.packQty}
                  value={qty}
                  onChange={(e) => setQty(Math.max(p.packQty, Number(e.target.value)))}
                  className="num h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-center"
                />
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQty((q) => q + p.packQty)}
                  className="grid size-10 place-items-center rounded-md border border-border"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>

              {signedIn && (
                <div className="num mt-3 flex items-center justify-between text-sm">
                  <span className="text-steel">Line total (ex VAT)</span>
                  <span className="font-display text-lg font-semibold">{gbp(unit * qty)}</span>
                </div>
              )}

              {signedIn ? (
                <>
                  <button
                    type="button"
                    disabled={p.stock === "backorder" || p.stock === "out"}
                    className="mt-4 h-11 w-full rounded-md bg-primary text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-steel"
                  >
                    {p.stock === "backorder" ? "Backorder — 5 working days" : "Add to basket"}
                  </button>
                  <button
                    type="button"
                    className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border text-sm font-semibold transition-colors hover:border-steel"
                  >
                    <Heart className="size-4" aria-hidden /> Add to order list
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="mt-4 grid h-11 w-full place-items-center rounded-md bg-primary text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
                  >
                    Sign in to view your price
                  </Link>
                  <Link
                    to="/register"
                    className="mt-2 grid h-11 w-full place-items-center rounded-md border border-border text-sm font-semibold transition-colors hover:border-steel"
                  >
                    Open a trade account
                  </Link>
                </>
              )}
            </div>
          </aside>
        </div>

        <section className="mt-16 border-t border-border/60 pt-10">
          <h2 className="font-display text-2xl font-semibold uppercase tracking-tight">
            Frequently bought together
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <Link
                key={r.sku}
                to="/products/$sku"
                params={{ sku: r.sku }}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40 transition-colors hover:border-primary/60"
              >
                <img
                  src={r.image}
                  alt={r.name}
                  loading="lazy"
                  width={912}
                  height={736}
                  className="aspect-[4/3] w-full object-cover"
                />
                <div className="p-4">
                  <div className="text-[11px] text-cyan">{r.brand}</div>
                  <div className="text-sm font-semibold leading-snug">{r.name}</div>
                  <div className="mt-2">
                    <TradePrice trade={r.trade} rrp={r.rrp} size="sm" ctaMode="text" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}
