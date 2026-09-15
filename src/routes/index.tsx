import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { StatusBadge } from "@/components/ab/Badges";
import { brands, products, gbp } from "@/lib/data";
import heroImage from "@/assets/hero-parts.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Automotive Brands — The brands behind the automotive aftermarket" },
      {
        name: "description",
        content:
          "Trade supply of Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion to UK motor factors, retailers, workshops and distributors. One trade account, every brand.",
      },
      {
        property: "og:title",
        content: "Automotive Brands — The brands behind the automotive aftermarket",
      },
      {
        property: "og:description",
        content:
          "One trade account for the entire Automotive Brands portfolio. Trade pricing, live availability and fast ordering for UK trade customers.",
      },
    ],
  }),
  component: Home,
});

const benefits = [
  { n: "01", title: "One account", body: "Every brand, one login" },
  { n: "02", title: "Trade pricing", body: "Tiered & contract rates" },
  { n: "03", title: "Live availability", body: "Real-time stock levels" },
  { n: "04", title: "Fast ordering", body: "Quick Order & CSV upload" },
  { n: "05", title: "Order history", body: "Full purchase record" },
  { n: "06", title: "Dedicated support", body: "Named account manager" },
];

function Home() {
  const featured = products.slice(0, 4);

  return (
    <PublicLayout kinetic>
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-24">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-steel">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              UK Automotive Aftermarket · Est. 2004
            </div>
            <h1 className="mt-6 font-display text-[44px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-[72px] xl:text-[84px]">
              The brands behind the <span className="text-primary">automotive</span> aftermarket.
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-steel">
              Automotive Brands supplies trusted automotive products to motor factors, retailers,
              workshops and distributors throughout the UK — one trade account, every brand.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold text-primary-foreground transition hover:brightness-110"
              >
                Open a Trade Account
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                to="/brands"
                className="inline-flex h-12 items-center rounded-md border border-border bg-surface/50 px-6 text-sm font-semibold transition-colors hover:border-steel"
              >
                Explore Our Brands
              </Link>
              <Link
                to="/login"
                className="inline-flex h-12 items-center rounded-md px-5 text-sm font-semibold text-steel transition-colors hover:text-foreground"
              >
                Trade Login
              </Link>
            </div>
            <div className="mt-10 flex items-center gap-6 text-[12px] text-steel">
              <div>
                <span className="num block font-display text-xl font-semibold text-foreground">
                  240k+
                </span>
                SKUs
              </div>
              <div className="h-8 w-px bg-border" aria-hidden />
              <div>
                <span className="num block font-display text-xl font-semibold text-foreground">
                  1,400+
                </span>
                Trade accounts
              </div>
              <div className="h-8 w-px bg-border" aria-hidden />
              <div>
                <span className="num block font-display text-xl font-semibold text-foreground">
                  9
                </span>
                Brands
              </div>
            </div>
          </div>
          <div className="lg:col-span-6">
            <div className="relative">
              <img
                src={heroImage}
                alt="Brake discs and alloy wheels under studio lighting"
                width={1200}
                height={1008}
                className="aspect-[6/5] w-full rounded-xl object-cover outline outline-1 -outline-offset-1 outline-border/60"
              />
              <div className="absolute -bottom-6 -left-2 w-60 rounded-xl border border-border bg-ink/95 p-4 shadow-2xl sm:-left-6 sm:w-64">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="uppercase tracking-wider text-steel">Live availability</span>
                  <span className="font-semibold text-good">● In stock</span>
                </div>
                <div className="mt-2 font-display text-lg font-semibold leading-tight">
                  Power Maxed PM-4410 Kit
                </div>
                <div className="num text-[12px] text-steel">SKU PM-4410 · Trade A £46.80</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div className="h-full w-4/5 bg-primary" />
                </div>
                <div className="mt-1 text-[11px] text-steel">82% range in stock</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                Our Brands
              </div>
              <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight">
                One portfolio. Nine identities.
              </h2>
            </div>
            <Link
              to="/brands"
              className="text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
            >
              View all brands →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {brands.map((brand) => (
              <Link
                key={brand.slug}
                to="/brands/$slug"
                params={{ slug: brand.slug }}
                className="group flex min-h-44 flex-col justify-between overflow-hidden rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/60"
              >
                <span className="mb-4 grid size-12 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
                  {brand.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                </span>
                <span>
                  <span className="block font-display text-lg font-semibold uppercase">
                    {brand.name}
                  </span>
                  <span className="block text-[12px] text-steel">{brand.category}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/60">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
              The B2B Proposition
            </div>
            <h2 className="mt-2 font-display text-4xl font-semibold uppercase leading-tight tracking-tight">
              One trade account.
              <br />
              Every brand.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-steel">
              Purchase across the entire Automotive Brands portfolio from a single trade account —
              with the pricing, availability and speed a busy trade customer expects.
            </p>
            <Link
              to="/trade-solutions"
              className="mt-6 inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-sm font-semibold transition-colors hover:border-steel"
            >
              See how it works
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:col-span-7">
            {benefits.map((b) => (
              <div key={b.n} className="flex gap-3 rounded-lg border border-border bg-surface/50 p-4">
                <span className="font-display text-lg text-primary">{b.n}</span>
                <div>
                  <div className="text-sm font-semibold">{b.title}</div>
                  <div className="text-[12px] text-steel">{b.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              Trade Catalogue
            </div>
            <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight">
              Built for fast ordering
            </h2>
          </div>
          <Link
            to="/products"
            className="text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
          >
            Browse the catalogue →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((p) => (
            <Link
              key={p.sku}
              to="/products/$sku"
              params={{ sku: p.sku }}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40 transition-colors hover:border-primary/60"
            >
              <img
                src={p.image}
                alt={p.name}
                loading="lazy"
                width={912}
                height={736}
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="flex-1 p-4">
                <div className="text-[11px] text-cyan">{p.brand}</div>
                <div className="text-sm font-semibold leading-snug">{p.name}</div>
                <div className="num text-[12px] text-steel">
                  SKU {p.sku} · Case ×{p.caseQty}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="num font-display text-lg font-semibold">{gbp(p.trade)}</span>{" "}
                    <span className="num text-[11px] text-steel line-through">{gbp(p.rrp)}</span>
                  </div>
                  <StatusBadge tone={p.stock === "in" ? "good" : "warn"}>
                    {p.stock === "in" ? "In stock" : "Backorder"}
                  </StatusBadge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
