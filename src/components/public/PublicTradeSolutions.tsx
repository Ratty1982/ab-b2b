import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ChevronDown,
  Clock3,
  Headphones,
  Package,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { homepageBrandLogoSrc } from "@/domain/homepage-brand-logos";
import {
  tradeSolutionsCtas,
  type TradeSolutionsContent,
  type TradeSolutionsLink,
  type TradeSolutionsMedia,
} from "@/domain/trade-solutions-content";
import { cmsFocalStyle, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/server/auth/session";

const frameClass = "mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10";

const primaryCtaClass =
  "inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none";

const secondaryCtaClass =
  "inline-flex h-11 items-center rounded-md border border-border bg-transparent px-5 text-[13px] font-semibold uppercase tracking-wide transition-colors hover:border-steel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none";

const BENEFIT_ICONS: Record<string, LucideIcon> = {
  pricing: Tag,
  account: BadgeCheck,
  case: Package,
  stock: Warehouse,
  order: ShoppingCart,
  support: Headphones,
};

const HERO_ICONS = [Wrench, ShieldCheck, Clock3] as const;
const STEP_ICONS = [Boxes, BadgeCheck, ShoppingCart] as const;

function CtaLink({ link, tone }: { link: TradeSolutionsLink; tone: "primary" | "secondary" }) {
  return (
    <a
      href={link.href}
      className={tone === "primary" ? primaryCtaClass : secondaryCtaClass}
      onClick={(event) => {
        if (!link.href.startsWith("#") || typeof document === "undefined") return;
        const target = document.getElementById(link.href.slice(1));
        if (!target) return;
        event.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }}
    >
      {link.label}
      {tone === "primary" ? <ArrowRight className="size-4" aria-hidden /> : null}
    </a>
  );
}

function MarkedHeading({
  as: Tag,
  id,
  text,
  highlight,
  className,
}: {
  as: "h1" | "h2";
  id?: string;
  text: string;
  highlight?: string;
  className?: string;
}) {
  const needle = highlight?.trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <Tag id={id} className={className}>
      {lines.map((line) => {
        if (!needle || !line.toLowerCase().includes(needle.toLowerCase())) {
          return (
            <span key={line} className="block">
              {line}
            </span>
          );
        }
        const start = line.toLowerCase().indexOf(needle.toLowerCase());
        const before = line.slice(0, start);
        const match = line.slice(start, start + needle.length);
        const after = line.slice(start + needle.length);
        return (
          <span key={line} className="block">
            {before}
            <span className="text-brand-yellow">{match}</span>
            {after}
          </span>
        );
      })}
    </Tag>
  );
}

function Cover({ media, alt, className }: { media: TradeSolutionsMedia; alt: string; className?: string }) {
  const src = cmsMediaDisplaySrc(media);
  if (!src) return null;
  const positioned = typeof media.focalX === "number" || typeof media.focalY === "number";
  return (
    <img
      src={src}
      alt={alt || media.alt}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      style={positioned ? cmsFocalStyle(media) : undefined}
    />
  );
}

function BrandPanel({
  slug,
  name,
  media,
}: {
  slug: "steel-seal" | "power-maxed";
  name: string;
  media: TradeSolutionsMedia;
}) {
  const src = cmsMediaDisplaySrc(media);
  const logo = homepageBrandLogoSrc(slug, null);
  return (
    <div className="relative min-h-[14rem] overflow-hidden bg-ink sm:min-h-[18rem] lg:min-h-[22rem]" data-trade-brand={slug}>
      {src ? (
        <Cover media={media} alt={media.alt || name} />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(90% 80% at 50% 40%, var(--color-surface-2), var(--color-ink) 70%)",
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/15 to-ink/25" />
      {logo ? (
        <div className="relative z-10 flex h-full min-h-[14rem] items-end justify-end p-5 sm:min-h-[18rem] lg:min-h-[22rem] lg:p-6">
          <img src={logo} alt={`${name} logo`} className="h-14 w-auto max-w-[70%] object-contain sm:h-16 lg:h-20" />
        </div>
      ) : null}
    </div>
  );
}

export function PublicTradeSolutions({
  content,
  session,
}: {
  content: TradeSolutionsContent;
  session: ClientSession;
}) {
  const ctas = tradeSolutionsCtas(session, content);
  const heroSrc = cmsMediaDisplaySrc(content.hero.media);
  const portalSrc = cmsMediaDisplaySrc(content.portal.media);
  const faqs = content.faqs.filter((item) => item.question.trim() && item.answer.trim());

  return (
    <div
      data-trade-page="solutions"
      data-trade-template="trade-solutions"
      data-offer-trade-account={ctas.offerTradeAccount ? "yes" : "no"}
      className="overflow-x-hidden"
    >
      <section aria-labelledby="trade-hero-title" data-trade-section="hero" className="relative overflow-hidden">
        {heroSrc ? (
          <>
            <Cover media={content.hero.media} alt={content.hero.media.alt} className="object-[72%_center]" />
            <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/88 to-ink/25" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            data-hero-visual="fallback"
            style={{
              background: "radial-gradient(80% 90% at 78% 42%, var(--color-surface-2), var(--color-ink) 58%)",
            }}
          />
        )}
        <div className={cn(frameClass, "relative py-10 sm:py-12 lg:py-14")}>
          <div className="max-w-xl">
            {content.hero.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.hero.eyebrow}</p>
            ) : null}
            <MarkedHeading
              as="h1"
              id="trade-hero-title"
              text={content.hero.headline}
              highlight={content.hero.highlight}
              className="mt-3 font-display text-[2.4rem] font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl lg:text-[3.25rem]"
            />
            {content.hero.description ? (
              <p className="mt-4 text-[15px] leading-relaxed text-steel">{content.hero.description}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3" data-trade-cta="hero">
              <CtaLink link={ctas.heroPrimary} tone="primary" />
              {ctas.heroSecondary.label ? <CtaLink link={ctas.heroSecondary} tone="secondary" /> : null}
            </div>
            {content.hero.points.length ? (
              <ul className="mt-7 grid gap-3 sm:grid-cols-3">
                {content.hero.points.map((point, index) => {
                  const Icon = HERO_ICONS[index] ?? Wrench;
                  return (
                    <li key={point.title} className="flex items-start gap-2 text-[13px] leading-snug">
                      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>{point.title}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="trade-portal-title" data-trade-section="portal" className="border-t border-border/50">
        <div className={cn(frameClass, "grid items-center gap-8 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 lg:py-16")}>
          <div>
            {content.portal.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.portal.eyebrow}</p>
            ) : null}
            <MarkedHeading
              as="h2"
              id="trade-portal-title"
              text={content.portal.headline}
              highlight={content.portal.highlight}
              className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl"
            />
            {content.portal.description ? (
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-steel">{content.portal.description}</p>
            ) : null}
            <div className="mt-6" data-trade-cta="portal">
              <CtaLink link={ctas.portal} tone="primary" />
            </div>
          </div>
          <div data-portal-screenshot={portalSrc ? "image" : "missing"}>
            <div className="rounded-xl border border-border/80 bg-surface p-2 sm:p-3">
              <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-ink">
                {portalSrc ? (
                  <Cover media={content.portal.media} alt={content.portal.media.alt || "Trade portal"} className="object-top" />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-[13px] leading-relaxed text-steel">
                    The trade portal screenshot is added in Website → Pages. This page does not show sample products or prices.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="trade-benefits"
        aria-labelledby="trade-benefits-title"
        data-trade-section="benefits"
        className="scroll-mt-24 border-t border-border/50"
      >
        <div className={cn(frameClass, "py-12 lg:py-16")}>
          {content.benefits.eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.benefits.eyebrow}</p>
          ) : null}
          <MarkedHeading
            as="h2"
            id="trade-benefits-title"
            text={content.benefits.headline}
            highlight={content.benefits.highlight}
            className="mt-3 max-w-3xl font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl"
          />
          <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {content.benefits.items.map((item) => {
              const Icon = BENEFIT_ICONS[item.icon] ?? Tag;
              return (
                <li key={item.title} className="rounded-lg border border-border/80 bg-surface px-5 py-5">
                  <Icon className="size-5 text-primary" aria-hidden />
                  <h3 className="mt-4 font-display text-lg font-semibold uppercase tracking-tight">{item.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-steel">{item.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="trade-steps-title" data-trade-section="steps" className="border-t border-border/50">
        <div className={cn(frameClass, "py-12 lg:py-16")}>
          {content.steps.eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.steps.eyebrow}</p>
          ) : null}
          <h2 id="trade-steps-title" className="mt-3 font-display text-4xl font-semibold uppercase tracking-tight sm:text-5xl">
            {content.steps.headline}
          </h2>
          {content.steps.description ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-steel">{content.steps.description}</p>
          ) : null}
          <ol className="relative mt-8 grid gap-6 lg:grid-cols-3">
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-7 hidden h-px bg-border lg:block" aria-hidden />
            {content.steps.items.map((step, index) => {
              const Icon = STEP_ICONS[index] ?? BadgeCheck;
              return (
                <li key={step.title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="grid size-14 place-items-center rounded-full border border-primary/50 bg-ink font-display text-lg text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Icon className="size-5 text-primary" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-display text-xl font-semibold uppercase tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-steel">{step.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section aria-labelledby="trade-brands-title" data-trade-section="brands" className="border-t border-border/50">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)_minmax(0,1fr)]">
          <BrandPanel slug="steel-seal" name="Steel Seal" media={content.brands.steelSeal.media} />
          <div className="flex flex-col justify-center bg-ink px-5 py-10 sm:px-8 lg:px-8">
            {content.brands.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.brands.eyebrow}</p>
            ) : null}
            <h2 id="trade-brands-title" className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight">
              {content.brands.headline}
            </h2>
            {content.brands.description ? (
              <p className="mt-4 text-[15px] leading-relaxed text-steel">{content.brands.description}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3" data-trade-cta="brands">
              <CtaLink link={ctas.brandsPrimary} tone="primary" />
              {ctas.brandsSecondary.label ? <CtaLink link={ctas.brandsSecondary} tone="secondary" /> : null}
            </div>
          </div>
          <BrandPanel slug="power-maxed" name="Power Maxed" media={content.brands.powerMaxed.media} />
        </div>
      </section>

      {faqs.length ? (
        <section aria-labelledby="trade-faq-title" data-trade-section="faq" className="border-t border-border/50">
          <div className={cn(frameClass, "grid gap-8 py-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-16")}>
            <div>
              {content.faq.eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.faq.eyebrow}</p>
              ) : null}
              <MarkedHeading
                as="h2"
                id="trade-faq-title"
                text={content.faq.headline}
                highlight={content.faq.highlight}
                className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl"
              />
            </div>
            <div className="border-t border-border/70">
              {faqs.map((item, index) => (
                <details key={`${item.question}-${index}`} name="trade-faq" className="group border-b border-border/70">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[15px] font-semibold marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    <span>{item.question}</span>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-steel transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </summary>
                  <div className="hidden pb-4 text-[14px] leading-relaxed text-steel group-open:block">{item.answer}</div>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {content.close.enabled ? (
        <section aria-labelledby="trade-close-title" data-trade-section="close" className="border-t border-border/50">
          <div className={cn(frameClass, "py-12 lg:py-14")}>
            <h2 id="trade-close-title" className="max-w-3xl font-display text-3xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-5xl">
              {content.close.headline}
            </h2>
            {content.close.description ? (
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-steel">{content.close.description}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3" data-trade-cta="close">
              <CtaLink link={ctas.closePrimary} tone="primary" />
              {ctas.closeSecondary.label ? <CtaLink link={ctas.closeSecondary} tone="secondary" /> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
