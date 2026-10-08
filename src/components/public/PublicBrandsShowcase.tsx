import { ArrowRight } from "lucide-react";
import {
  brandsShowcaseCtas,
  PUBLIC_BRANDS_CLOSE,
  PUBLIC_BRANDS_HERO,
  PUBLIC_BRANDS_PROPOSITION,
  publicBrandPropositionCards,
  type PublicBrandShowcase,
} from "@/domain/public-brands-showcase";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/server/auth/session";

const primaryCtaClass =
  "inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const secondaryCtaClass =
  "inline-flex h-12 items-center rounded-md border border-border bg-surface/50 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function CtaLink({
  cta,
  tone,
}: {
  cta: { label: string; href: string };
  tone: "primary" | "secondary";
}) {
  return (
    <a href={cta.href} className={tone === "primary" ? primaryCtaClass : secondaryCtaClass}>
      {cta.label}
      {tone === "primary" ? <ArrowRight className="size-4" aria-hidden /> : null}
    </a>
  );
}

function BrandShowcase({ brand }: { brand: PublicBrandShowcase }) {
  const primary = brand.emphasis === "primary";
  return (
    <section
      aria-labelledby={`brand-${brand.slug}-title`}
      data-brand-showcase={brand.slug}
      data-brand-emphasis={brand.emphasis}
      className={cn("border-b border-border/60", primary ? "bg-primary/[0.045]" : "bg-transparent")}
    >
      <div
        className={cn(
          "mx-auto grid max-w-[1400px] items-center gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:gap-14 lg:px-10",
          primary ? "py-12 lg:py-16" : "py-10 lg:py-14",
        )}
      >
        <div className={cn(primary ? "lg:col-span-5" : "lg:col-span-4")}>
          <div
            className={cn(
              "grid place-items-center rounded-xl bg-white px-8 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.65)]",
              primary ? "min-h-[220px] py-10 sm:min-h-[300px]" : "min-h-[180px] py-8 sm:min-h-[240px]",
            )}
          >
            <img
              src={brand.logoSrc}
              alt={brand.logoAlt}
              width={primary ? 420 : 340}
              height={primary ? 160 : 120}
              className={cn(
                "w-auto max-w-full",
                mediaContainClass,
                primary ? "h-24 sm:h-32" : "h-16 sm:h-24",
              )}
            />
          </div>
        </div>
        <div className={cn("min-w-0", primary ? "lg:col-span-7" : "lg:col-span-8")}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan">{brand.kicker}</p>
          <h2
            id={`brand-${brand.slug}-title`}
            className={cn(
              "mt-3 font-display font-semibold uppercase leading-[0.95] tracking-tight",
              primary ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
            )}
          >
            {brand.name}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-steel">{brand.description}</p>
          <ul className="mt-6 grid gap-2 sm:grid-cols-3">
            {brand.points.map((point) => (
              <li
                key={point}
                className="rounded-md border border-border/70 bg-surface/40 px-3 py-3 text-[13px] font-medium leading-snug text-foreground"
              >
                {point}
              </li>
            ))}
          </ul>
          <p className="num mt-5 text-[12px] text-steel">{brand.tradeProductCountLabel}</p>
          <div className="mt-6">
            <a href={brand.shopHref} className={primaryCtaClass}>
              {brand.shopLabel}
              <ArrowRight className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicBrandsShowcase({
  brands,
  session,
}: {
  brands: PublicBrandShowcase[];
  session: ClientSession;
}) {
  const ctas = brandsShowcaseCtas(session);
  const proposition = publicBrandPropositionCards(brands);

  return (
    <div data-brands-page="showcase" data-brand-order={brands.map((brand) => brand.slug).join(" ")}>
      <section aria-labelledby="brands-hero-title" className="border-b border-border/60">
        <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-16">
          <div className="lg:col-span-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              {PUBLIC_BRANDS_HERO.eyebrow}
            </p>
            <h1
              id="brands-hero-title"
              className="mt-4 whitespace-pre-line font-display text-[40px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-6xl"
            >
              {PUBLIC_BRANDS_HERO.headline}
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-steel">{PUBLIC_BRANDS_HERO.supporting}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-brands-cta="hero">
              <CtaLink cta={ctas.heroPrimary} tone="primary" />
              {ctas.heroSecondary ? <CtaLink cta={ctas.heroSecondary} tone="secondary" /> : null}
            </div>
          </div>
          <div className="grid gap-3 lg:col-span-5" aria-hidden>
            {brands.map((brand) => (
              <div
                key={brand.slug}
                className={cn(
                  "grid place-items-center rounded-xl bg-white px-6",
                  brand.emphasis === "primary" ? "min-h-[148px]" : "min-h-[112px]",
                )}
              >
                <img
                  src={brand.logoSrc}
                  alt=""
                  className={cn(
                    "w-auto max-w-full",
                    mediaContainClass,
                    brand.emphasis === "primary" ? "h-16 sm:h-20" : "h-12 sm:h-14",
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {brands.length ? (
        brands.map((brand) => <BrandShowcase key={brand.slug} brand={brand} />)
      ) : (
        <section className="border-b border-border/60">
          <p className="mx-auto max-w-[1400px] px-4 py-12 text-sm text-steel sm:px-6 lg:px-10">
            Steel Seal and Power Maxed are not available to browse right now.
          </p>
        </section>
      )}

      {proposition.length ? (
        <section aria-labelledby="brands-proposition-title" className="border-b border-border/60">
          <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              {PUBLIC_BRANDS_PROPOSITION.eyebrow}
            </p>
            <h2
              id="brands-proposition-title"
              className="mt-3 max-w-3xl font-display text-3xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-4xl"
            >
              {PUBLIC_BRANDS_PROPOSITION.headline}
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-steel">
              {PUBLIC_BRANDS_PROPOSITION.supporting}
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {proposition.map((card) => (
                <article key={card.slug} className="rounded-lg border border-border/80 bg-surface/40 p-6" data-brand-proposition={card.slug}>
                  <h3 className="font-display text-2xl font-semibold uppercase tracking-tight">{card.name}</h3>
                  <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-cyan">{card.kicker}</p>
                  <p className="mt-3 text-sm leading-relaxed text-steel">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="brands-close-title" data-brands-cta="close" data-offer-trade-account={ctas.offerTradeAccount ? "yes" : "no"}>
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
          <div className="rounded-xl border border-border/80 bg-surface/50 px-6 py-10 sm:px-10">
            <h2
              id="brands-close-title"
              className="whitespace-pre-line font-display text-3xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-5xl"
            >
              {PUBLIC_BRANDS_CLOSE.headline}
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-steel">{PUBLIC_BRANDS_CLOSE.supporting}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <CtaLink cta={ctas.closePrimary} tone="primary" />
              {ctas.closeSecondary ? <CtaLink cta={ctas.closeSecondary} tone="secondary" /> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
