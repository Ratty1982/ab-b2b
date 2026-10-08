import { ArrowRight, Car, Cog, Droplets, Factory, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import {
  brandsPageCtas,
  presentPublicBrandShowcase,
  type PublicBrandShowcase,
  type PublicCatalogueBrandCard,
} from "@/domain/public-brands-showcase";
import {
  defaultBrandsShowcaseContent,
  type BrandsShowcaseContent,
  type BrandsShowcaseMedia,
} from "@/domain/brands-showcase-content";
import { cmsFocalStyle, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/server/auth/session";

const primaryCtaClass =
  "inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const secondaryCtaClass =
  "inline-flex h-11 items-center rounded-md border border-border bg-transparent px-5 text-[13px] font-semibold uppercase tracking-wide transition-colors hover:border-steel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const POINT_ICONS: Record<PublicBrandShowcase["slug"], readonly LucideIcon[]> = {
  "steel-seal": [Wrench, Droplets, Factory],
  "power-maxed": [Sparkles, Cog, Car],
};

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

function Headline({
  id,
  text,
  className,
  as: Tag,
}: {
  id?: string;
  text: string;
  className?: string;
  as: "h1" | "h2";
}) {
  const lines = text
    .replace(/\s+(one trade account\.?)/i, "\n$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <Tag id={id} className={className}>
      {lines.map((line, index) => (
        <span key={`${index}-${line}`} className={cn("block", index > 0 && "text-brand-yellow")}>
          {line}
        </span>
      ))}
    </Tag>
  );
}

function CoverPhoto({ media, alt }: { media: BrandsShowcaseMedia; alt: string }) {
  const src = cmsMediaDisplaySrc(media);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
      style={cmsFocalStyle(media)}
    />
  );
}

function BrandShowcase({ brand }: { brand: PublicBrandShowcase }) {
  const icons = POINT_ICONS[brand.slug];
  return (
    <section
      aria-labelledby={`brand-${brand.slug}-title`}
      data-brand-showcase={brand.slug}
      data-brand-emphasis={brand.emphasis}
      data-brand-visual={brand.coverSrc ? "photo" : "fallback"}
      className="border-b border-border/60"
    >
      <div className="grid lg:grid-cols-2">
        <div className="flex flex-col justify-center px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan">{brand.kicker}</p>
          <h2
            id={`brand-${brand.slug}-title`}
            className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl"
          >
            {brand.name}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-steel">{brand.description}</p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {brand.points.map((point, index) => {
              const Icon = icons[index] ?? Wrench;
              return (
                <li key={point} className="flex items-start gap-2 text-[13px] leading-snug text-foreground">
                  <Icon className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
                  <span>{point}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <a href={brand.shopHref} className={primaryCtaClass}>
              {brand.shopLabel}
              <ArrowRight className="size-4" aria-hidden />
            </a>
            <p className="num text-[13px] text-steel">{brand.tradeProductCountLabel}</p>
          </div>
        </div>
        <div className="relative min-h-[260px] overflow-hidden bg-ink sm:min-h-[320px] lg:min-h-[420px]">
          {brand.coverSrc ? (
            <>
              <img
                src={brand.coverSrc}
                alt={brand.coverAlt}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-l from-ink/80 via-ink/35 to-ink/15" />
            </>
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 90% at 78% 48%, var(--color-surface-2), var(--color-ink) 64%)",
              }}
            />
          )}
          <div className="relative z-10 flex h-full min-h-[260px] items-center justify-center p-8 sm:min-h-[320px] sm:justify-end sm:p-10 lg:min-h-[420px]">
            <img
              src={brand.logoSrc}
              alt={brand.logoAlt}
              width={420}
              height={180}
              className={cn("h-28 w-auto max-w-[18rem] sm:h-36 lg:h-40", mediaContainClass)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicBrandsShowcase({
  brands,
  session,
  content = defaultBrandsShowcaseContent(),
}: {
  brands: readonly PublicCatalogueBrandCard[];
  session: ClientSession;
  content?: BrandsShowcaseContent;
}) {
  const presented = presentPublicBrandShowcase(brands, content);
  const ctas = brandsPageCtas(session, content);
  const heroCover = cmsMediaDisplaySrc(content.hero.media);

  return (
    <div
      data-brands-page="showcase"
      data-brands-template="brands-showcase"
      data-brand-order={presented.map((brand) => brand.slug).join(" ")}
    >
      <section aria-labelledby="brands-hero-title" className="relative overflow-hidden border-b border-border/60">
        {heroCover ? (
          <>
            <CoverPhoto media={content.hero.media} alt={content.hero.media.alt} />
            <div className="absolute inset-0 bg-ink/80" />
          </>
        ) : null}
        <div className="relative mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
          <div className="max-w-3xl">
            {content.hero.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                {content.hero.eyebrow}
              </p>
            ) : null}
            <Headline
              as="h1"
              id="brands-hero-title"
              text={content.hero.headline}
              className="mt-4 font-display text-[40px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-6xl"
            />
            {content.hero.description ? (
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-steel">{content.hero.description}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3" data-brands-cta="hero">
              <CtaLink cta={ctas.heroPrimary} tone="primary" />
              {ctas.heroSecondary ? <CtaLink cta={ctas.heroSecondary} tone="secondary" /> : null}
            </div>
          </div>
        </div>
      </section>

      {presented.length ? (
        presented.map((brand) => <BrandShowcase key={brand.slug} brand={brand} />)
      ) : (
        <section className="border-b border-border/60">
          <p className="mx-auto max-w-[1400px] px-4 py-12 text-sm text-steel sm:px-6 lg:px-10">
            Steel Seal and Power Maxed are not available to browse right now.
          </p>
        </section>
      )}

      <section
        aria-labelledby="brands-close-title"
        data-brands-cta="close"
        data-offer-trade-account={ctas.offerTradeAccount ? "yes" : "no"}
        className="border-b border-border/60"
      >
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
          <Headline
            as="h2"
            id="brands-close-title"
            text={content.close.headline}
            className="max-w-3xl font-display text-3xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-5xl"
          />
          {content.close.description ? (
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-steel">{content.close.description}</p>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CtaLink cta={ctas.closePrimary} tone="primary" />
            {ctas.closeSecondary ? <CtaLink cta={ctas.closeSecondary} tone="secondary" /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
