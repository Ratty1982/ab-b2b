import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Truck, Warehouse, Headphones, ClipboardList, Download } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { StockBadge } from "@/components/ab/Badges";
import { TradePrice } from "@/components/ab/Price";
import { CmsPageView } from "@/components/cms/CmsSectionRenderer";
import { brands, products } from "@/lib/data";
import { categories, news, tradeCustomerTypes } from "@/lib/crm-data";
import { getPublishedHomepage } from "@/server/cms/service";
import type { CmsSectionTypeKey } from "@/domain/cms";
import heroImage from "@/assets/hero-parts.jpg";
import warehouse from "@/assets/warehouse.jpg";
import tradeCounter from "@/assets/trade-counter.jpg";
import catChemicals from "@/assets/cat-chemicals.jpg";
import cat4x4 from "@/assets/cat-4x4.jpg";
import brakeDisc from "@/assets/prod-brake-disc.jpg";
import battery from "@/assets/prod-battery.jpg";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const published = await getPublishedHomepage();
      return { cms: published };
    } catch {
      return { cms: null };
    }
  },
  head: ({ loaderData }) => {
    const seoTitle =
      loaderData?.cms?.seoTitle ??
      "Automotive Brands — The brands behind the automotive aftermarket";
    const seoDesc =
      loaderData?.cms?.metaDescription ??
      "Trade supply of Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion to UK motor factors, retailers, workshops and distributors. One trade account, every brand.";
    return {
      meta: [
        { title: seoTitle },
        { name: "description", content: seoDesc },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDesc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: Home,
});

function Home() {
  const { cms } = Route.useLoaderData();
  if (cms?.sections?.length) {
    return (
      <PublicLayout kinetic>
        <CmsPageView
          sections={cms.sections.map((s) => ({
            id: s.id,
            type: s.type as CmsSectionTypeKey,
            config: s.config as Record<string, unknown>,
          }))}
        />
      </PublicLayout>
    );
  }
  return <LegacyHome />;
}

const brandArt: Record<string, { image: string; strap: string; ranges: string[] }> = {
  "power-maxed": {
    image: brakeDisc,
    strap: "Braking, servicing and drivetrain",
    ranges: ["Discs & pads", "Calipers", "Brake fluid", "Service consumables"],
  },
  "steel-seal": {
    image: catChemicals,
    strap: "Engine chemicals and sealing",
    ranges: ["Head gasket sealer", "RTV silicone", "Additives", "Cleaners"],
  },
  "street-rhino": {
    image: cat4x4,
    strap: "4x4, light commercial and styling",
    ranges: ["Alloy wheels", "LED lighting", "Body protection", "Steps & bars"],
  },
  "bramley-power": {
    image: battery,
    strap: "Batteries, starting and charging",
    ranges: ["AGM & EFB", "Leisure", "Chargers", "Alternators"],
  },
  kidzmotion: {
    image: tradeCounter,
    strap: "In-car child safety",
    ranges: ["Group 1/2/3 seats", "Boosters", "ISOFIX bases", "Accessories"],
  },
};

const propositions = [
  {
    icon: Warehouse,
    title: "UK stockholding",
    body: "Five brands picked from one warehouse and consolidated onto one delivery.",
  },
  {
    icon: Truck,
    title: "Same-day despatch",
    body: "Orders placed before 3pm leave the same working day on next-day or pallet service.",
  },
  {
    icon: ClipboardList,
    title: "Account ordering",
    body: "Purchase order references, agreed terms and full order history on every account.",
  },
  {
    icon: Headphones,
    title: "Named representative",
    body: "A dedicated account manager, not a general enquiry queue.",
  },
];

function Eyebrow({ children, tone = "primary" }: { children: string; tone?: "primary" | "cyan" }) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${tone === "cyan" ? "text-cyan" : "text-primary"}`}
    >
      {children}
    </div>
  );
}

function LegacyHome() {
  const featured = products.slice(0, 4);
  const newProducts = products.slice(4, 7);
  const bestSellers = products.slice(0, 5);

  return (
    <PublicLayout kinetic>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-24">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-steel">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              UK Automotive Aftermarket Supply
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
                className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
              >
                Open a Trade Account
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                to="/brands"
                className="inline-flex h-12 items-center rounded-md border border-border bg-surface/50 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
              >
                Explore Our Brands
              </Link>
              <Link
                to="/login"
                className="inline-flex h-12 items-center rounded-md px-5 text-sm font-semibold uppercase tracking-wide text-steel transition-colors hover:text-foreground"
              >
                Trade Login
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-steel">
              {brands.map((b) => (
                <li
                  key={b.slug}
                  className="font-display text-sm uppercase tracking-wide text-foreground"
                >
                  {b.name}
                </li>
              ))}
            </ul>
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
              <div className="absolute -bottom-6 -left-2 w-64 rounded-xl border border-border bg-ink/95 p-4 shadow-2xl sm:-left-6">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="uppercase tracking-wider text-steel">Live availability</span>
                  <span className="font-semibold text-good">● In stock</span>
                </div>
                <div className="mt-2 font-display text-lg font-semibold leading-tight">
                  Power Maxed PM-4410 Kit
                </div>
                <div className="num text-[12px] text-steel">SKU PM-4410 · 412 in stock</div>
                <Link
                  to="/login"
                  className="mt-3 block text-[11px] font-semibold text-primary hover:underline"
                >
                  Sign in to view your price →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BRAND SHOWCASE */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <div className="min-w-0">
              <Eyebrow>Our brands</Eyebrow>
              <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
                Five brands. One supply partner.
              </h2>
            </div>
            <Link
              to="/brands"
              className="shrink-0 text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
            >
              All brands →
            </Link>
          </div>

          <div className="mt-8 grid gap-px border border-border bg-border lg:grid-cols-2">
            {brands.map((brand, i) => {
              const art = brandArt[brand.slug];
              return (
                <Link
                  key={brand.slug}
                  to="/brands/$slug"
                  params={{ slug: brand.slug }}
                  className={`group relative grid grid-cols-[minmax(0,1fr)_120px] gap-4 bg-surface/70 p-6 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_200px] ${
                    i === 0 ? "lg:col-span-2 lg:grid-cols-[minmax(0,1fr)_360px]" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <span className="grid size-11 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
                      {brand.name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")}
                    </span>
                    <h3
                      className={`mt-4 font-display font-semibold uppercase leading-none ${i === 0 ? "text-3xl sm:text-5xl" : "text-2xl"}`}
                    >
                      {brand.name}
                    </h3>
                    <div className="mt-1 text-[12px] uppercase tracking-[0.16em] text-cyan">
                      {art?.strap ?? brand.category}
                    </div>
                    <p className="mt-3 max-w-md text-[13px] leading-relaxed text-steel">
                      {brand.blurb}
                    </p>
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {art?.ranges.map((r) => (
                        <li
                          key={r}
                          className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-steel"
                        >
                          {r}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-primary">
                      View brand
                      <ArrowRight
                        className="size-3.5 transition-transform group-hover:translate-x-1"
                        aria-hidden
                      />
                    </span>
                  </div>
                  <img
                    src={art?.image ?? heroImage}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    width={400}
                    height={400}
                    className="h-full w-full self-stretch object-cover opacity-80 transition-opacity group-hover:opacity-100"
                  />
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="border-b border-border/60 bg-surface/30">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
          <Eyebrow tone="cyan">Product categories</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            Everything a trade counter turns over
          </h2>
          <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => (
              <Link
                key={c.name}
                to="/products"
                className="group bg-ink p-5 transition-colors hover:bg-surface"
              >
                <div className="font-display text-lg font-semibold uppercase">{c.name}</div>
                <div className="mt-1 text-[12px] text-steel">{c.lines}</div>
                <div className="mt-4 text-[11px] uppercase tracking-[0.14em] text-primary">
                  {c.brand}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED RANGES */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <div className="min-w-0">
              <Eyebrow>Featured ranges</Eyebrow>
              <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
                Ranges moving this quarter
              </h2>
            </div>
            <Link
              to="/products"
              className="shrink-0 text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
            >
              Browse catalogue →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                <div className="flex flex-1 flex-col p-4">
                  <div className="text-[11px] text-cyan">{p.brand}</div>
                  <div className="text-sm font-semibold leading-snug">{p.name}</div>
                  <div className="num text-[12px] text-steel">
                    SKU {p.sku} · Case ×{p.caseQty}
                  </div>
                  <div className="mt-auto pt-3">
                    <TradePrice trade={p.trade} rrp={p.rrp} size="sm" ctaMode="text" />
                    <div className="mt-2">
                      <StockBadge stock={p.stock} />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* NEW + BEST SELLERS */}
      <section className="border-b border-border/60 bg-surface/30">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-10">
          <div>
            <Eyebrow tone="cyan">New products</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              Recently added lines
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {newProducts.map((p) => (
                <li key={p.sku}>
                  <Link
                    to="/products/$sku"
                    params={{ sku: p.sku }}
                    className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 bg-ink p-3 transition-colors hover:bg-surface"
                  >
                    <img
                      src={p.image}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      width={128}
                      height={128}
                      className="size-16 rounded-sm object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                      <span className="num block text-[11px] text-steel">
                        {p.brand} · {p.sku}
                      </span>
                    </span>
                    <StockBadge stock={p.stock} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Eyebrow>Best sellers</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              Highest volume trade lines
            </h2>
            <div className="mt-6 overflow-x-auto border border-border">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold">Brand</th>
                    <th className="px-3 py-2 text-right font-semibold">RRP</th>
                  </tr>
                </thead>
                <tbody>
                  {bestSellers.map((p, i) => (
                    <tr key={p.sku} className="border-b border-border/60 bg-ink last:border-0">
                      <td className="num px-3 py-2.5 text-steel">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          to="/products/$sku"
                          params={{ sku: p.sku }}
                          className="font-medium hover:text-primary"
                        >
                          {p.name}
                        </Link>
                        <div className="num text-[11px] text-steel">{p.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-steel">{p.brand}</td>
                      <td className="num px-3 py-2.5 text-right">£{p.rrp.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12px] text-steel">
              Trade pricing is account-specific.{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Sign in to view your price
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* WHY / DISTRIBUTION */}
      <section className="border-b border-border/60">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-5">
            <Eyebrow>Why Automotive Brands</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-4xl">
              One trade account.
              <br />
              Every brand.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-steel">
              Buying the group rather than five separate suppliers means one order, one delivery,
              one invoice and one representative who knows your business.
            </p>
            <img
              src={warehouse}
              alt="Automotive Brands distribution warehouse with racked parts and palletised despatch"
              loading="lazy"
              width={1600}
              height={912}
              className="mt-6 aspect-[16/9] w-full rounded-lg object-cover outline outline-1 -outline-offset-1 outline-border/60"
            />
            <Link
              to="/why-automotive-brands"
              className="mt-6 inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
            >
              See how it works
            </Link>
          </div>
          <div className="grid gap-px self-start border border-border bg-border sm:grid-cols-2 lg:col-span-7">
            {propositions.map((p) => (
              <div key={p.title} className="bg-surface/60 p-5">
                <p.icon className="size-5 text-primary" aria-hidden />
                <div className="mt-3 font-display text-lg font-semibold uppercase">{p.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-steel">{p.body}</div>
              </div>
            ))}
            <div className="bg-surface/60 p-5 sm:col-span-2">
              <Eyebrow tone="cyan">Trade customer types</Eyebrow>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {tradeCustomerTypes.map((t) => (
                  <li key={t.name} className="border-l-2 border-primary/60 pl-3">
                    <div className="text-[13px] font-semibold">{t.name}</div>
                    <div className="text-[12px] text-steel">{t.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* RESOURCES + NEWS */}
      <section className="border-b border-border/60 bg-surface/30">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10">
          <div className="lg:col-span-5">
            <Eyebrow>Trade resources</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              Documentation your counter needs
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {[
                ["Trade catalogue 2026", "PDF · 18.4 MB"],
                ["Safety data sheets", "Per product"],
                ["Fitment & technical guides", "PDF"],
                ["Approved marketing imagery", "ZIP"],
              ].map(([name, meta]) => (
                <li key={name}>
                  <Link
                    to="/resources"
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-ink p-3 transition-colors hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{name}</span>
                      <span className="num block text-[11px] text-steel">{meta}</span>
                    </span>
                    <Download className="size-4 shrink-0 text-primary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <Eyebrow tone="cyan">Latest from Automotive Brands</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              Range updates and trade notices
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {news.map((n) => (
                <li key={n.title} className="bg-ink p-5">
                  <div className="num flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-steel">
                    <span className="text-primary">{n.kind}</span>
                    <span aria-hidden>·</span>
                    {n.date}
                  </div>
                  <h3 className="mt-2 font-display text-lg font-semibold leading-snug">
                    {n.title}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-steel">{n.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden">
        <img
          src={tradeCounter}
          alt=""
          aria-hidden
          loading="lazy"
          width={1200}
          height={912}
          className="absolute inset-0 size-full object-cover opacity-20"
        />
        <div className="relative mx-auto grid max-w-[1400px] gap-6 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-10">
          <div className="min-w-0">
            <Eyebrow>Open a trade account</Eyebrow>
            <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-5xl">
              Trade pricing, live stock and one account across every brand.
            </h2>
            <p className="mt-4 max-w-xl text-[14px] text-steel">
              Applications are reviewed by our trade team. Once approved, your account is activated
              with your pricing, catalogues and payment terms already in place.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/register"
              className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Open a Trade Account
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              to="/login"
              className="inline-flex h-12 items-center rounded-md border border-border bg-ink/70 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
            >
              Trade Login
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
