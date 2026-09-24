import { Link } from "@tanstack/react-router";
import { MotorsportFeatureSection } from "@/components/public/MotorsportFeatureSection";
import { MotorsportPartnershipForm } from "@/components/public/MotorsportPartnershipForm";
import { MotorsportMediaGallery } from "@/components/public/MotorsportMediaGallery";
import type { CmsSectionTypeKey } from "@/domain/cms";
import { MOTORSPORT_PAGE_DEFAULTS } from "@/domain/motorsport";
import { cmsFocalStyle, cmsImageFitClass, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";

type Section = {
  id: string;
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
};

function str(c: Record<string, unknown>, key: string, fallback = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : fallback;
}

function mediaObj(c: Record<string, unknown>): Record<string, unknown> | null {
  const media = c["media"];
  return media && typeof media === "object" ? (media as Record<string, unknown>) : null;
}

function AboutSection({ config }: { config: Record<string, unknown> }) {
  const media = mediaObj(config);
  const src = cmsMediaDisplaySrc(media);
  const fit = (media?.["fit"] as string | undefined) ?? "fill";
  return (
    <section className="border-b border-border/50 bg-ink" data-motorsport-section="about">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-14 lg:px-10 lg:py-20">
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[#0c1220]">
          {src ? (
            <img
              src={src}
              alt={typeof media?.["alt"] === "string" ? media["alt"] : "Power Maxed Racing"}
              className={cn("size-full", cmsImageFitClass(fit === "contain" ? "contain" : "fill"))}
              style={cmsFocalStyle(media)}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div
              className="size-full bg-[radial-gradient(ellipse_at_40%_50%,#1a2744,#070b14)]"
              role="img"
              aria-label="Upload Power Maxed Racing photography in Media"
            />
          )}
        </div>
        <div>
          <h2 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            {str(config, "heading", MOTORSPORT_PAGE_DEFAULTS.about.heading)}
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-steel">
            {str(config, "body", MOTORSPORT_PAGE_DEFAULTS.about.body)}
          </p>
        </div>
      </div>
    </section>
  );
}

function BrandsOnTrackSection({ config }: { config: Record<string, unknown> }) {
  const media = mediaObj(config);
  const src = cmsMediaDisplaySrc(media);
  const fit = (media?.["fit"] as string | undefined) ?? "fill";
  return (
    <section className="border-b border-border/50 bg-surface/20" data-motorsport-section="brands">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-14 lg:px-10 lg:py-20">
        <div className="order-2 lg:order-1">
          <h2 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            {str(config, "heading", MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.heading)}
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-steel">
            {str(config, "body", MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.body)}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/brands/$slug"
              params={{ slug: "power-maxed" }}
              className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
              data-motorsport-cta="shop-power-maxed"
            >
              {MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.powerMaxedLabel}
            </Link>
            <Link
              to="/brands/$slug"
              params={{ slug: "steel-seal" }}
              className="inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-[12px] font-semibold uppercase tracking-wide transition hover:border-steel"
              data-motorsport-cta="shop-steel-seal"
            >
              {MOTORSPORT_PAGE_DEFAULTS.brandsOnTrack.steelSealLabel}
            </Link>
          </div>
        </div>
        <div className="relative order-1 aspect-[16/10] overflow-hidden rounded-lg bg-[#0c1220] lg:order-2">
          {src ? (
            <img
              src={src}
              alt={
                typeof media?.["alt"] === "string"
                  ? media["alt"]
                  : "Steel Seal and Power Maxed on track"
              }
              className={cn("size-full", cmsImageFitClass(fit === "contain" ? "contain" : "fill"))}
              style={cmsFocalStyle(media)}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div
              className="size-full bg-[radial-gradient(ellipse_at_60%_40%,#1a2744,#070b14)]"
              role="img"
              aria-label="Upload branded race-car photography in Media"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function PartnershipOpportunities({ config }: { config: Record<string, unknown> }) {
  const itemsRaw = config["items"];
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    : MOTORSPORT_PAGE_DEFAULTS.partnerships.opportunities.map((o) => ({
        title: o.title,
        body: o.body,
      }));

  return (
    <section
      id="partnerships"
      className="scroll-mt-24 border-b border-border/50 bg-ink"
      data-motorsport-section="partnerships"
    >
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
          {str(config, "eyebrow", MOTORSPORT_PAGE_DEFAULTS.partnerships.eyebrow)}
        </p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          {str(config, "heading", MOTORSPORT_PAGE_DEFAULTS.partnerships.headline)}
        </h2>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-steel">
          {str(config, "supporting", MOTORSPORT_PAGE_DEFAULTS.partnerships.body)}
        </p>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={`${String(item["title"])}-${index}`} className="border-l border-primary/40 pl-4">
              <h3 className="text-[13px] font-bold uppercase tracking-[0.14em]">
                {typeof item["title"] === "string" ? item["title"] : ""}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-steel">
                {typeof item["body"] === "string" ? item["body"] : ""}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-14">
          <MotorsportPartnershipForm />
        </div>
      </div>
    </section>
  );
}

/**
 * Commercial motorsport landing — photographic CMS sections + partnership lead form.
 * Not a fan microsite; stays on the public Automotive Brands shell.
 */
export function MotorsportLanding({ sections }: { sections: Section[] }) {
  const hero = sections.find((s) => s.type === "MOTORSPORT_FEATURE");
  const about = sections.find((s) => s.type === "IMAGE_TEXT");
  const brands = sections.find((s) => s.type === "TEXT_IMAGE");
  const gallery = sections.find((s) => s.type === "MEDIA_GALLERY");
  const partnerships = sections.find((s) => s.type === "BENEFITS_GRID");

  // Merge page-hero CTA: primary → #partnerships; secondary → external racing URL when set.
  const heroConfig = hero
    ? {
        ...hero.config,
        features: [],
        ctaLabel: str(hero.config, "ctaLabel", MOTORSPORT_PAGE_DEFAULTS.hero.ctaLabel),
        ctaHref: str(hero.config, "ctaHref", "#partnerships"),
        secondaryCtaLabel: str(
          hero.config,
          "secondaryCtaLabel",
          MOTORSPORT_PAGE_DEFAULTS.hero.secondaryCtaLabel,
        ),
        secondaryCtaHref: str(hero.config, "secondaryCtaHref", ""),
      }
    : {
        ...MOTORSPORT_PAGE_DEFAULTS.hero,
        eyebrow: MOTORSPORT_PAGE_DEFAULTS.hero.eyebrow,
        headline: MOTORSPORT_PAGE_DEFAULTS.hero.headline,
        supporting: MOTORSPORT_PAGE_DEFAULTS.hero.supporting,
        ctaLabel: MOTORSPORT_PAGE_DEFAULTS.hero.ctaLabel,
        ctaHref: "#partnerships",
        secondaryCtaLabel: MOTORSPORT_PAGE_DEFAULTS.hero.secondaryCtaLabel,
        secondaryCtaHref: MOTORSPORT_PAGE_DEFAULTS.hero.externalRacingUrl,
        features: [],
        media: {
          alt: "Power Maxed Racing photography — upload licensed imagery in Media",
          fit: "fill",
          focalX: 68,
          focalY: 40,
        },
      };

  return (
    <div data-page="motorsport">
      <MotorsportFeatureSection config={heroConfig} compact />
      {about ? <AboutSection config={about.config} /> : <AboutSection config={{}} />}
      {brands ? <BrandsOnTrackSection config={brands.config} /> : <BrandsOnTrackSection config={{}} />}
      {gallery ? (
        <MotorsportMediaGallery config={gallery.config} />
      ) : (
        <MotorsportMediaGallery
          config={{
            eyebrow: "Gallery",
            heading: "Power Maxed Racing",
            supporting:
              "Upload genuine motorsport photography in Website Builder → Media. Do not alter watermarked previews.",
            items: [],
          }}
        />
      )}
      {partnerships ? (
        <PartnershipOpportunities config={partnerships.config} />
      ) : (
        <PartnershipOpportunities config={{}} />
      )}
    </div>
  );
}
