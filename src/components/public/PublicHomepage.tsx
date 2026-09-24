import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, Download, Headphones, Truck, Warehouse } from "lucide-react";
import { AvailabilityBadge, availabilityClass } from "@/components/ab/AvailabilityBadge";
import { TradePrice } from "@/components/ab/Price";
import { ProductImage } from "@/components/public/ProductImage";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";
import type { CmsSectionTypeKey } from "@/domain/cms";
import { featuredBrandsIntro } from "@/domain/featured-brands";
import type { HomepageProduct, HomepageSection, PublicHomepageData } from "@/domain/homepage";
import {
  lookupProduct,
  productHref,
  productsForSkus,
  resolveHomepageBrands,
  resolveHomepageCategories,
} from "@/domain/homepage-resolve";
import { cmsFocalStyle, cmsImageFitClass, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { gbp } from "@/lib/data";
import { mediaContainClass } from "@/lib/media-presentation";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import heroFallback from "@/assets/hero-parts.jpg";
import warehouseFallback from "@/assets/warehouse.jpg";
import tradeCounterFallback from "@/assets/trade-counter.jpg";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";

const ICONS = {
  warehouse: Warehouse,
  truck: Truck,
  clipboard: ClipboardList,
  headphones: Headphones,
} as const;

function str(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function num(config: Record<string, unknown>, key: string, fallback = 0): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mediaObj(config: Record<string, unknown>): Record<string, unknown> | null {
  const media = config["media"];
  return media && typeof media === "object" ? (media as Record<string, unknown>) : null;
}

function Eyebrow({ children, tone = "primary" }: { children: string; tone?: "primary" | "cyan" }) {
  if (!children) return null;
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${tone === "cyan" ? "text-cyan" : "text-primary"}`}
    >
      {children}
    </div>
  );
}

function ProductPrice({ product, size = "sm" }: { product: HomepageProduct; size?: "sm" | "md" }) {
  return (
    <TradePrice
      trade={product.price.trade}
      rrp={product.price.rrp ?? product.rrp}
      size={size}
      ctaMode="text"
    />
  );
}

function RangeCard({ product }: { product: HomepageProduct }) {
  return (
    <Link
      to="/products/$sku"
      params={{ sku: product.slug || product.sku }}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40 transition-colors hover:border-primary/60"
    >
      <ProductImage src={product.imageSrc} alt={product.name} layout="card" />
      <div className="flex flex-1 flex-col p-4">
        <div className="text-[11px] text-cyan">{product.brand}</div>
        <div className="text-sm font-semibold leading-snug">{product.name}</div>
        <div className="num text-[12px] text-steel">SKU {product.sku}</div>
        <div className="mt-auto pt-3">
          <ProductPrice product={product} />
          <div className="mt-2">
            <AvailabilityBadge availability={product.availability} />
          </div>
        </div>
      </div>
    </Link>
  );
}

function HeroSection({
  config,
  brands,
  productsBySku,
}: {
  config: Record<string, unknown>;
  brands: PublicHomepageData["brands"];
  productsBySku: PublicHomepageData["productsBySku"];
}) {
  const session = useSession();
  const media = mediaObj(config);
  const heroSrc = cmsMediaDisplaySrc(media) || heroFallback;
  const callout = lookupProduct(productsBySku, config["calloutSku"]);
  const names = brands.length ? brands.map((b) => b.name) : [];
  const signedIn = session.signedIn;
  const accountLinks = publicHeaderAccountLinks(session);
  const portalHref = accountLinks.find((l) => l.key === "trade-portal" || l.key === "my-account")?.to ?? "/portal";

  const primaryHref = signedIn ? "/products" : str(config, "ctaHref", "/products");
  const primaryLabel = signedIn ? "Shop Products" : str(config, "ctaLabel", "Shop Products");
  const secondaryHref = signedIn ? portalHref : str(config, "secondaryCtaHref", "/register");
  const secondaryLabel = signedIn
    ? accountLinks.find((l) => l.key === "trade-portal" || l.key === "my-account")?.label ?? "Trade Portal"
    : str(config, "secondaryCtaLabel", "Open a Trade Account");

  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-20">
        <div className="lg:col-span-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
            {str(config, "eyebrow", "POWER MAXED + STEEL SEAL")}
          </div>
          <h1 className="mt-5 whitespace-pre-line font-display text-[40px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-[64px] xl:text-[76px]">
            {str(config, "headline", "AUTOMOTIVE PRODUCTS\nBUILT FOR THE TRADE")}
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-steel">
            {str(
              config,
              "supporting",
              "Professional automotive products supplied to trade customers across the UK.",
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={primaryHref}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              {primaryLabel}
              <ArrowRight className="size-4" aria-hidden />
            </a>
            {secondaryLabel ? (
              <a
                href={secondaryHref}
                className="inline-flex h-12 items-center rounded-md border border-border bg-surface/50 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
              >
                {secondaryLabel}
              </a>
            ) : null}
            {!signedIn ? (
              <a
                href={str(config, "loginCtaHref", "/login")}
                className="inline-flex h-12 items-center rounded-md px-5 text-sm font-semibold uppercase tracking-wide text-steel transition-colors hover:text-foreground"
              >
                {str(config, "loginCtaLabel", "Trade Login")}
              </a>
            ) : null}
          </div>
          {names.length ? (
            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-steel">
              {names.map((name) => (
                <li key={name} className="font-display text-sm uppercase tracking-wide text-foreground">
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="lg:col-span-6">
          <div className="relative overflow-hidden rounded-xl bg-surface/40 outline outline-1 -outline-offset-1 outline-border/60">
            <img
              src={heroSrc}
              alt={str(media ?? {}, "alt", "Automotive Brands trade product photography")}
              width={1200}
              height={1008}
              className={cn(
                "aspect-[6/5] w-full",
                cmsImageFitClass(media?.["fit"] ?? "contain"),
              )}
              style={cmsFocalStyle(media)}
            />
            {callout ? (
              <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-border bg-ink/95 p-4 sm:right-auto sm:w-64">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="uppercase tracking-wider text-steel">Availability</span>
                  {callout.availability ? (
                    <span className={cn("font-semibold", availabilityClass(callout.availability))}>
                      ● {PUBLIC_AVAILABILITY_LABEL[callout.availability]}
                    </span>
                  ) : (
                    <span className="text-steel">Account pricing</span>
                  )}
                </div>
                <div className="mt-2 font-display text-lg font-semibold leading-tight">{callout.name}</div>
                <div className="text-[12px] text-cyan">{callout.brand}</div>
                <div className="num text-[12px] text-steel">SKU {callout.sku}</div>
                <div className="mt-2">
                  <ProductPrice product={callout} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function BrandsSection({
  config,
  brands,
}: {
  config: Record<string, unknown>;
  brands: PublicHomepageData["brands"];
}) {
  const cards = resolveHomepageBrands(config, brands);
  if (!cards.length) return null;
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="max-w-3xl">
          <Eyebrow>{str(config, "eyebrow", "Our brands")}</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            {str(config, "heading", "TWO BRANDS. ONE TRADE SUPPLIER.")}
          </h2>
          {featuredBrandsIntro(config) ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-steel">{featuredBrandsIntro(config)}</p>
          ) : null}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {cards.map((brand) => (
            <a
              key={brand.slug}
              href={brand.href}
              className="group grid gap-5 rounded-lg border border-border/80 bg-surface/40 p-6 transition-colors hover:border-primary/50 hover:bg-surface/70 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center"
            >
              <div className="min-w-0">
                <h3 className="font-display text-2xl font-semibold uppercase leading-none sm:text-3xl">
                  {brand.heading}
                </h3>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-steel">{brand.description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-primary">
                  Shop {brand.heading}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </div>
              <div className="grid h-28 place-items-center self-stretch rounded-md bg-white p-4 sm:h-36">
                {brand.logoSrc ? (
                  <img
                    src={brand.logoSrc}
                    alt={`${brand.heading} logo`}
                    className={cn("max-h-full max-w-full", mediaContainClass)}
                  />
                ) : (
                  <span className="font-display text-2xl font-bold text-ink">
                    {brand.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoriesSection({
  config,
  categories,
}: {
  config: Record<string, unknown>;
  categories: PublicHomepageData["categories"];
}) {
  const items = resolveHomepageCategories(config, categories);
  if (!items.length) return null;
  return (
    <section className="border-b border-border/60 bg-surface/30">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <Eyebrow tone="cyan">{str(config, "eyebrow", "Shop by category")}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(config, "heading", "Browse the trade catalogue")}
            </h2>
            {str(config, "supporting") ? (
              <p className="mt-3 text-[14px] leading-relaxed text-steel">{str(config, "supporting")}</p>
            ) : null}
          </div>
          <Link
            to="/products"
            className="inline-flex h-11 items-center rounded-md border border-border bg-ink px-5 text-[12px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            {str(config, "ctaLabel", "View all products")}
          </Link>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((category) => (
            <Link
              key={category.slug}
              to="/products/category/$slug"
              params={{ slug: category.slug }}
              className="group rounded-lg border border-border/70 bg-ink p-5 transition-colors hover:border-primary/50"
            >
              <div className="font-display text-lg font-semibold uppercase">{category.name}</div>
              {category.description ? (
                <div className="mt-1 text-[12px] text-steel">{category.description}</div>
              ) : null}
              <div className="mt-4 text-[11px] uppercase tracking-[0.14em] text-primary">View category</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedProductsSection({
  config,
  productsBySku,
  featuredProducts,
}: {
  config: Record<string, unknown>;
  productsBySku: PublicHomepageData["productsBySku"];
  featuredProducts: HomepageProduct[];
}) {
  const configured = productsForSkus(config["productSkus"], productsBySku);
  const products = configured.length ? configured : featuredProducts.slice(0, 8);
  if (!products.length) return null;
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0">
            <Eyebrow>{str(config, "eyebrow", "Catalogue")}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(config, "heading", "Featured products")}
            </h2>
            {str(config, "supporting") ? (
              <p className="mt-2 max-w-2xl text-[14px] text-steel">{str(config, "supporting")}</p>
            ) : null}
          </div>
          <Link
            to="/products"
            className="shrink-0 text-[13px] font-semibold text-steel transition-colors hover:text-foreground"
          >
            Browse catalogue →
          </Link>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <RangeCard key={product.sku} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}

function NewAndPopular({
  recentConfig,
  popularConfig,
  recentProducts,
  productsBySku,
}: {
  recentConfig: Record<string, unknown> | null;
  popularConfig: Record<string, unknown> | null;
  recentProducts: HomepageProduct[];
  productsBySku: PublicHomepageData["productsBySku"];
}) {
  const limit = recentConfig ? Math.min(6, Math.max(1, num(recentConfig, "limit", 3))) : 0;
  const recent = recentConfig ? recentProducts.slice(0, limit) : [];
  const popular = popularConfig ? productsForSkus(popularConfig["productSkus"], productsBySku) : [];
  if (!recent.length && !popular.length) return null;
  return (
    <section className="border-b border-border/60 bg-surface/30">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-10">
        {recent.length ? (
          <div>
            <Eyebrow tone="cyan">{str(recentConfig ?? {}, "eyebrow", "New products")}</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              {str(recentConfig ?? {}, "heading", "Recently added lines")}
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {recent.map((product) => (
                <li key={product.sku}>
                  <Link
                    to="/products/$sku"
                    params={{ sku: product.slug || product.sku }}
                    className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 bg-ink p-3 transition-colors hover:bg-surface"
                  >
                    <ProductImage src={product.imageSrc} alt="" layout="thumb" className="size-16" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{product.name}</span>
                      <span className="num block text-[11px] text-steel">
                        {product.brand} · {product.sku}
                      </span>
                    </span>
                    <AvailabilityBadge availability={product.availability} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div />
        )}
        {popular.length ? (
          <div>
            <Eyebrow>{str(popularConfig ?? {}, "eyebrow", "Popular trade lines")}</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              {str(popularConfig ?? {}, "heading", "Popular trade lines")}
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
                  {popular.map((product, i) => (
                    <tr key={product.sku} className="border-b border-border/60 bg-ink last:border-0">
                      <td className="num px-3 py-2.5 text-steel">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          to="/products/$sku"
                          params={{ sku: product.slug || product.sku }}
                          className="font-medium hover:text-primary"
                        >
                          {product.name}
                        </Link>
                        <div className="num text-[11px] text-steel">{product.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-steel">{product.brand}</td>
                      <td className="num px-3 py-2.5 text-right">
                        {product.rrp != null ? gbp(product.rrp) : "—"}
                      </td>
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
        ) : null}
      </div>
    </section>
  );
}

function BenefitsSection({ config }: { config: Record<string, unknown> }) {
  const items = Array.isArray(config["items"])
    ? (config["items"] as Array<{ title?: string; body?: string; icon?: string }>)
    : [];
  const types = Array.isArray(config["customerTypes"])
    ? (config["customerTypes"] as Array<{ name?: string; detail?: string }>)
    : [];
  const media = mediaObj(config);
  const imageSrc = cmsMediaDisplaySrc(media) || warehouseFallback;
  return (
    <section className="overflow-hidden border-b border-border/60">
      <div className="mx-auto grid max-w-[1400px] items-start gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-10">
        <div className="min-w-0 lg:col-span-5">
          <Eyebrow>{str(config, "eyebrow", "Why Automotive Brands")}</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-4xl">
            {str(config, "heading", "One trade account. Every brand.")}
          </h2>
          {str(config, "supporting") ? (
            <p className="mt-4 text-[14px] leading-relaxed text-steel">{str(config, "supporting")}</p>
          ) : null}
          {/* Frame owns the aspect ratio — do not put h-full on the bare <img> or intrinsic
              photo height can inflate the column and paint over the next homepage section. */}
          <div className="mt-6 aspect-[16/9] w-full overflow-hidden rounded-lg bg-surface/40 outline outline-1 -outline-offset-1 outline-border/60">
            <img
              src={imageSrc}
              alt={str(media ?? {}, "alt", "Automotive Brands distribution warehouse")}
              loading="lazy"
              className={cn("size-full", cmsImageFitClass(media?.["fit"] ?? "fill"))}
              style={cmsFocalStyle(media)}
            />
          </div>
          {str(config, "ctaLabel") ? (
            <a
              href={str(config, "ctaHref", "/why-automotive-brands")}
              className="mt-6 inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
            >
              {str(config, "ctaLabel")}
            </a>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-px self-start border border-border bg-border sm:grid-cols-2 lg:col-span-7">
          {items.map((item) => {
            const Icon = ICONS[(item.icon as keyof typeof ICONS) ?? "warehouse"] ?? Warehouse;
            return (
              <div key={item.title} className="bg-surface/60 p-5">
                <Icon className="size-5 text-primary" aria-hidden />
                <div className="mt-3 font-display text-lg font-semibold uppercase">{item.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-steel">{item.body}</div>
              </div>
            );
          })}
          {types.length ? (
            <div className="bg-surface/60 p-5 sm:col-span-2">
              <Eyebrow tone="cyan">Trade customer types</Eyebrow>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {types.map((type) => (
                  <li key={type.name} className="border-l-2 border-primary/60 pl-3">
                    <div className="text-[13px] font-semibold">{type.name}</div>
                    <div className="text-[12px] text-steel">{type.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ResourcesAndNews({
  resources,
  news,
}: {
  resources: Record<string, unknown> | null;
  news: Record<string, unknown> | null;
}) {
  const resourceItems = Array.isArray(resources?.["items"])
    ? (resources!["items"] as Array<{ label?: string; meta?: string; href?: string }>)
    : [];
  const newsItems = Array.isArray(news?.["items"])
    ? (news!["items"] as Array<{ kind?: string; date?: string; title?: string; summary?: string }>)
    : [];
  if (!resourceItems.length && !newsItems.length) return null;
  return (
    <section className="border-b border-border/60 bg-surface/30">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10">
        {resourceItems.length ? (
          <div className="lg:col-span-5">
            <Eyebrow>{str(resources ?? {}, "eyebrow", "Trade resources")}</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              {str(resources ?? {}, "heading", "Documentation your counter needs")}
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {resourceItems.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href || "/resources"}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-ink p-3 transition-colors hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{item.label}</span>
                      {item.meta ? <span className="num block text-[11px] text-steel">{item.meta}</span> : null}
                    </span>
                    <Download className="size-4 shrink-0 text-primary" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="lg:col-span-5" />
        )}
        {newsItems.length ? (
          <div className="lg:col-span-7">
            <Eyebrow tone="cyan">{str(news ?? {}, "eyebrow", "Latest from Automotive Brands")}</Eyebrow>
            <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-tight">
              {str(news ?? {}, "heading", "Range updates and trade notices")}
            </h2>
            <ul className="mt-6 divide-y divide-border border border-border">
              {newsItems.map((item) => (
                <li key={item.title} className="bg-ink p-5">
                  <div className="num flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-steel">
                    {item.kind ? <span className="text-primary">{item.kind}</span> : null}
                    {item.kind && item.date ? <span aria-hidden>·</span> : null}
                    {item.date}
                  </div>
                  <h3 className="mt-2 font-display text-lg font-semibold leading-snug">{item.title}</h3>
                  {item.summary ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-steel">{item.summary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TradeCta({ config }: { config: Record<string, unknown> }) {
  const session = useSession();
  const media = mediaObj(config);
  const src = cmsMediaDisplaySrc(media) || tradeCounterFallback;
  const signedIn = session.signedIn;
  const accountLinks = publicHeaderAccountLinks(session);
  const portal = accountLinks.find((l) => l.key === "trade-portal" || l.key === "my-account");

  const primaryHref = signedIn
    ? str(config, "signedInCtaHref", portal?.to ?? "/portal")
    : str(config, "ctaHref", "/register");
  const primaryLabel = signedIn
    ? str(config, "signedInCtaLabel", portal?.label ?? "Trade Portal")
    : str(config, "ctaLabel", "Open a Trade Account");
  const secondaryHref = signedIn
    ? str(config, "signedInSecondaryCtaHref", "/products")
    : str(config, "secondaryCtaHref", "/login");
  const secondaryLabel = signedIn
    ? str(config, "signedInSecondaryCtaLabel", "Shop Products")
    : str(config, "secondaryCtaLabel", "Trade Login");

  return (
    <section className="relative overflow-hidden border-t border-border/60 bg-ink">
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        className={cn(
          "pointer-events-none absolute inset-0 size-full opacity-20",
          // Absolute fill frame — cover only; avoid contain+padding which can escape the box.
          "object-cover object-center",
        )}
        style={cmsFocalStyle(media)}
      />
      <div className="relative z-10 mx-auto grid max-w-[1400px] gap-6 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-10 lg:py-20">
        <div className="min-w-0">
          <Eyebrow>{str(config, "eyebrow", "Built for trade")}</Eyebrow>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-5xl">
            {str(config, "headline")}
          </h2>
          {str(config, "supporting") ? (
            <p className="mt-4 max-w-xl text-[14px] text-steel">{str(config, "supporting")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={primaryHref}
            className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            {primaryLabel}
            <ArrowRight className="size-4" aria-hidden />
          </a>
          {secondaryLabel ? (
            <a
              href={secondaryHref}
              className="inline-flex h-12 items-center rounded-md border border-border bg-ink/70 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
            >
              {secondaryLabel}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GenericFallback({ section }: { section: HomepageSection }) {
  if (section.type === "BANNER") {
    return (
      <div className="border-b border-border/60 bg-primary/10 px-4 py-3 text-center text-sm">
        {str(section.config, "text")}
      </div>
    );
  }
  if (section.type === "RICH_TEXT") {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-steel">{str(section.config, "content")}</p>
      </div>
    );
  }
  if (section.type === "SPACER") {
    const size = str(section.config, "size", "md");
    return <div className={size === "lg" ? "h-16" : size === "sm" ? "h-6" : "h-10"} />;
  }
  return null;
}

export function PublicHomepage({ data }: { data: PublicHomepageData }) {
  const sections = data.sections.filter((section) => section.enabled);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]!;
    const type = section.type as CmsSectionTypeKey;
    const config = section.config as Record<string, unknown>;
    const next = sections[i + 1];
    if (type === "HERO") {
      nodes.push(
        <HeroSection
          key={section.id}
          config={config}
          brands={data.brands}
          productsBySku={data.productsBySku}
        />,
      );
      continue;
    }
    if (type === "FEATURED_BRANDS" || type === "BRAND_LOGO_STRIP") {
      nodes.push(<BrandsSection key={section.id} config={config} brands={data.brands} />);
      continue;
    }
    if (type === "CATEGORY_GRID") {
      nodes.push(<CategoriesSection key={section.id} config={config} categories={data.categories} />);
      continue;
    }
    if (type === "FEATURED_PRODUCTS") {
      nodes.push(
        <FeaturedProductsSection
          key={section.id}
          config={config}
          productsBySku={data.productsBySku}
          featuredProducts={data.featuredProducts ?? []}
        />,
      );
      continue;
    }
    if (type === "NEW_PRODUCTS") {
      const popular = next?.type === "POPULAR_PRODUCTS" ? next : null;
      if (popular) i += 1;
      nodes.push(
        <NewAndPopular
          key={section.id}
          recentConfig={config}
          popularConfig={popular ? (popular.config as Record<string, unknown>) : null}
          recentProducts={data.recentProducts}
          productsBySku={data.productsBySku}
        />,
      );
      continue;
    }
    if (type === "POPULAR_PRODUCTS") {
      nodes.push(
        <NewAndPopular
          key={section.id}
          recentConfig={null}
          popularConfig={config}
          recentProducts={[]}
          productsBySku={data.productsBySku}
        />,
      );
      continue;
    }
    if (type === "BENEFITS_GRID") {
      nodes.push(<BenefitsSection key={section.id} config={config} />);
      continue;
    }
    if (type === "RESOURCES") {
      const news = next?.type === "NEWS" ? next : null;
      if (news) i += 1;
      nodes.push(
        <ResourcesAndNews
          key={section.id}
          resources={config}
          news={news ? (news.config as Record<string, unknown>) : null}
        />,
      );
      continue;
    }
    if (type === "NEWS") {
      nodes.push(<ResourcesAndNews key={section.id} resources={null} news={config} />);
      continue;
    }
    if (type === "TRADE_CTA") {
      nodes.push(<TradeCta key={section.id} config={config} />);
      continue;
    }
    nodes.push(<GenericFallback key={section.id} section={section} />);
  }

  return <>{nodes}</>;
}

void productHref;
