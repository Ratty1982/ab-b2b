import { ArrowRight, Globe, Handshake, Megaphone, Quote, Truck, Wrench, type LucideIcon } from "lucide-react";
import warehouseFallback from "@/assets/warehouse.jpg";
import { homepageBrandLogoSrc } from "@/domain/homepage-brand-logos";
import {
  publishedTestimonials,
  whyUsPrimaryCta,
  type WhyUsContent,
  type WhyUsLink,
  type WhyUsMedia,
} from "@/domain/why-us-content";
import { cmsFocalStyle, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/server/auth/session";

const frameClass = "mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10";

const primaryCtaClass =
  "inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none";

const SUPPORT_ICONS: Record<string, LucideIcon> = {
  distribution: Truck,
  development: Wrench,
  marketing: Megaphone,
  partnership: Handshake,
};

const STAT_ICONS = [Handshake, Globe, Globe] as const;

export type WhyUsTeamProfile = {
  id: string;
  displayName: string;
  jobTitle: string | null;
  photo: { src: string; alt: string; objectPosition?: string } | null;
};

function CtaLink({ link }: { link: WhyUsLink }) {
  return (
    <a href={link.href} className={primaryCtaClass}>
      {link.label}
      <ArrowRight className="size-4" aria-hidden />
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
        return (
          <span key={line} className="block">
            {line.slice(0, start)}
            <span className="text-brand-yellow">{line.slice(start, start + needle.length)}</span>
            {line.slice(start + needle.length)}
          </span>
        );
      })}
    </Tag>
  );
}

function Cover({ media, alt, className, fallbackSrc }: { media: WhyUsMedia; alt: string; className?: string; fallbackSrc?: string }) {
  const src = cmsMediaDisplaySrc(media) || fallbackSrc;
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
  heading,
  description,
  cta,
  media,
}: {
  slug: "steel-seal" | "power-maxed";
  name: string;
  heading: string;
  description: string;
  cta: WhyUsLink;
  media: WhyUsMedia;
}) {
  const src = cmsMediaDisplaySrc(media);
  const logo = homepageBrandLogoSrc(slug, null);
  return (
    <article className="relative min-h-[22rem] overflow-hidden bg-ink lg:min-h-[26rem]" data-why-brand={slug}>
      {src ? (
        <Cover media={media} alt={media.alt || name} />
      ) : (
        <div
          className="absolute inset-0"
          data-why-brand-visual="fallback"
          style={{ background: "radial-gradient(90% 80% at 50% 40%, var(--color-surface-2), var(--color-ink) 72%)" }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/10" />
      <div className="relative flex min-h-[22rem] flex-col justify-end p-6 lg:min-h-[26rem] lg:p-8">
        {logo ? <img src={logo} alt={`${name} logo`} className="mb-4 h-12 w-auto max-w-[12rem] object-contain" /> : null}
        <h3 className="font-display text-3xl font-semibold uppercase tracking-tight">{heading}</h3>
        {description ? <p className="mt-3 max-w-md text-[14px] leading-relaxed text-steel">{description}</p> : null}
        {cta.label ? (
          <div className="mt-5">
            <CtaLink link={cta} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function PublicWhyUs({
  content,
  session,
  team = [],
}: {
  content: WhyUsContent;
  session: ClientSession;
  team?: readonly WhyUsTeamProfile[];
}) {
  const primary = whyUsPrimaryCta(session, content);
  const quotes = publishedTestimonials(content).slice(0, 3);
  const visibleTeam = content.team.enabled ? team.filter((member) => member.photo?.src && member.displayName.trim()) : [];
  const heroSrc = cmsMediaDisplaySrc(content.hero.media);
  const storySrc = cmsMediaDisplaySrc(content.story.media);

  return (
    <div data-why-page="company" data-why-template="why-us" data-offer-trade-account={primary.offerTradeAccount ? "yes" : "no"} className="overflow-x-hidden">
      {content.hero.enabled ? (
        <section aria-labelledby="why-hero-title" data-why-section="hero" className="relative overflow-hidden">
          {heroSrc || warehouseFallback ? (
            <>
              <Cover
                media={content.hero.media}
                alt={content.hero.media.alt}
                fallbackSrc={warehouseFallback}
                className="object-[center_45%]"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/25" />
            </>
          ) : (
            <div className="absolute inset-0" data-hero-visual="fallback" />
          )}
          <div className={cn(frameClass, "relative py-12 sm:py-14 lg:py-16")}>
            <div className="max-w-xl">
              {content.hero.eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.hero.eyebrow}</p>
              ) : null}
              <MarkedHeading
                as="h1"
                id="why-hero-title"
                text={content.hero.headline}
                highlight={content.hero.highlight}
                className="mt-3 font-display text-[2.4rem] font-semibold uppercase leading-[0.92] tracking-tight sm:text-5xl lg:text-[3.25rem]"
              />
              {content.hero.description ? (
                <p className="mt-4 text-[15px] leading-relaxed text-steel">{content.hero.description}</p>
              ) : null}
              <div className="mt-6" data-why-cta="hero">
                <CtaLink link={primary} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {content.stats.enabled && content.stats.items.length ? (
        <section aria-label="Company credibility" data-why-section="stats" className="border-t border-border/50">
          <ul className={cn(frameClass, "grid gap-6 py-8 sm:grid-cols-3 sm:py-10")}>
            {content.stats.items.map((item, index) => {
              const Icon = STAT_ICONS[index] ?? Globe;
              return (
                <li key={`${item.value}-${item.label}`} className="flex gap-3">
                  <Icon className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-display text-3xl font-semibold uppercase tracking-tight">{item.value}</p>
                    <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.14em]">{item.label}</p>
                    {item.body ? <p className="mt-2 text-[13px] leading-relaxed text-steel">{item.body}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {content.story.enabled ? (
        <section aria-labelledby="why-story-title" data-why-section="story" className="border-t border-border/50">
          <div className="grid lg:grid-cols-2">
            <div className="relative min-h-[16rem] bg-ink lg:min-h-[24rem]" data-why-story-visual={storySrc ? "image" : "fallback"}>
              {storySrc ? (
                <Cover media={content.story.media} alt={content.story.media.alt} />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{ background: "radial-gradient(80% 80% at 50% 40%, var(--color-surface-2), var(--color-ink) 70%)" }}
                />
              )}
            </div>
            <div className="flex flex-col justify-center bg-ink px-5 py-10 sm:px-8 lg:px-12">
              {content.story.eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.story.eyebrow}</p>
              ) : null}
              <MarkedHeading
                as="h2"
                id="why-story-title"
                text={content.story.headline}
                highlight={content.story.highlight}
                className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight"
              />
              {content.story.body.split("\n").filter((line) => line.trim()).map((paragraph) => (
                <p key={paragraph} className="mt-4 max-w-xl text-[15px] leading-relaxed text-steel">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {content.support.enabled && content.support.items.length ? (
        <section aria-labelledby="why-support-title" data-why-section="support" className="border-t border-border/50">
          <div className={cn(frameClass, "py-12 lg:py-16")}>
            {content.support.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.support.eyebrow}</p>
            ) : null}
            <h2 id="why-support-title" className="mt-3 max-w-3xl font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight">
              {content.support.headline}
            </h2>
            <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {content.support.items.map((item) => {
                const Icon = SUPPORT_ICONS[item.icon] ?? Handshake;
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
      ) : null}

      {quotes.length ? (
        <section aria-labelledby="why-quotes-title" data-why-section="testimonials" className="border-t border-border/50">
          <div className={cn(frameClass, "py-12 lg:py-16")}>
            {content.testimonials.eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.testimonials.eyebrow}</p>
            ) : null}
            <h2 id="why-quotes-title" className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight">
              {content.testimonials.headline}
            </h2>
            <ul className="mt-8 grid gap-4 lg:grid-cols-3">
              {quotes.map((item) => (
                <li key={item.name} className="rounded-lg border border-border/80 bg-surface px-5 py-5">
                  <Quote className="size-5 text-primary" aria-hidden />
                  <blockquote className="mt-4 text-[14px] leading-relaxed text-foreground">“{item.quote}”</blockquote>
                  <footer className="mt-4 text-[13px] leading-snug">
                    <p className="font-semibold">{item.name}</p>
                    {item.business ? <p className="text-steel">{item.business}</p> : null}
                    {item.country ? <p className="text-steel">{item.country}</p> : null}
                  </footer>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {content.brands.enabled ? (
        <section aria-label="Our brands" data-why-section="brands" className="border-t border-border/50">
          <div className="grid lg:grid-cols-2">
            <BrandPanel
              slug="steel-seal"
              name="Steel Seal"
              heading={content.brands.steelSeal.heading}
              description={content.brands.steelSeal.description}
              cta={{ label: content.brands.steelSeal.ctaLabel, href: content.brands.steelSeal.ctaHref }}
              media={content.brands.steelSeal.media}
            />
            <BrandPanel
              slug="power-maxed"
              name="Power Maxed"
              heading={content.brands.powerMaxed.heading}
              description={content.brands.powerMaxed.description}
              cta={{ label: content.brands.powerMaxed.ctaLabel, href: content.brands.powerMaxed.ctaHref }}
              media={content.brands.powerMaxed.media}
            />
          </div>
        </section>
      ) : null}

      {visibleTeam.length ? (
        <section aria-labelledby="why-team-title" data-why-section="team" className="border-t border-border/50">
          <div className={cn(frameClass, "py-12 lg:py-16")}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Meet the Team</p>
            <h2 id="why-team-title" className="mt-3 font-display text-4xl font-semibold uppercase tracking-tight">
              The people behind Automotive Brands
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
              {visibleTeam.map((member) => (
                <li key={member.id} className="overflow-hidden rounded-lg border border-border/80 bg-surface">
                  <img
                    src={member.photo!.src}
                    alt={member.photo!.alt || member.displayName}
                    className="aspect-[4/5] w-full object-cover"
                    style={member.photo!.objectPosition ? { objectPosition: member.photo!.objectPosition } : undefined}
                  />
                  <div className="px-3 py-3">
                    <p className="font-semibold">{member.displayName}</p>
                    {member.jobTitle ? <p className="text-[13px] text-steel">{member.jobTitle}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <a href="/meet-the-team" className={primaryCtaClass}>
                Meet the Team
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {content.close.enabled ? (
        <section aria-labelledby="why-close-title" data-why-section="close" className="border-t border-border/50">
          <div className={cn(frameClass, "flex flex-col gap-6 py-12 lg:flex-row lg:items-center lg:justify-between lg:py-14")}>
            <div className="max-w-2xl">
              {content.close.eyebrow ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">{content.close.eyebrow}</p>
              ) : null}
              <MarkedHeading
                as="h2"
                id="why-close-title"
                text={content.close.headline}
                highlight={content.close.highlight}
                className="mt-3 font-display text-4xl font-semibold uppercase leading-[0.92] tracking-tight"
              />
              {content.close.description ? (
                <p className="mt-4 text-[15px] leading-relaxed text-steel">{content.close.description}</p>
              ) : null}
            </div>
            <div data-why-cta="close">
              <CtaLink
                link={
                  primary.offerTradeAccount
                    ? { label: content.close.ctaLabel || primary.label, href: content.close.ctaHref || primary.href }
                    : primary
                }
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
