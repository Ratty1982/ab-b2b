import { ArrowRight, Flag, Handshake, Users } from "lucide-react";
import { HOMEPAGE_MOTORSPORT_DEFAULTS } from "@/domain/motorsport";
import { cmsFocalStyle, cmsImageFitClass, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";

const FEATURE_ICONS = {
  flag: Flag,
  handshake: Handshake,
  users: Users,
} as const;

function str(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function mediaObj(config: Record<string, unknown>): Record<string, unknown> | null {
  const media = config["media"];
  return media && typeof media === "object" ? (media as Record<string, unknown>) : null;
}

/**
 * Full-bleed Power Maxed Motorsport band for the canonical public homepage.
 * Background photography comes from CMS/R2 — no baked-in race car artwork.
 */
export function MotorsportFeatureSection({
  config,
  compact = false,
}: {
  config: Record<string, unknown>;
  /** Compact page-hero style (used on /motorsport). */
  compact?: boolean;
}) {
  const media = mediaObj(config);
  const src = cmsMediaDisplaySrc(media);
  const fit = (media?.["fit"] as string | undefined) ?? "fill";
  const focalStyle = cmsFocalStyle(media);
  const alt =
    typeof media?.["alt"] === "string" && media["alt"]
      ? media["alt"]
      : "Power Maxed Racing motorsport photography";

  const eyebrow = str(config, "eyebrow", HOMEPAGE_MOTORSPORT_DEFAULTS.eyebrow);
  const headline = str(config, "headline", HOMEPAGE_MOTORSPORT_DEFAULTS.headline);
  const supporting = str(config, "supporting", HOMEPAGE_MOTORSPORT_DEFAULTS.supporting);
  const ctaLabel = str(config, "ctaLabel", HOMEPAGE_MOTORSPORT_DEFAULTS.ctaLabel);
  const ctaHref = str(config, "ctaHref", HOMEPAGE_MOTORSPORT_DEFAULTS.ctaHref);
  const secondaryCtaLabel = str(
    config,
    "secondaryCtaLabel",
    HOMEPAGE_MOTORSPORT_DEFAULTS.secondaryCtaLabel,
  );
  const secondaryCtaHref = str(
    config,
    "secondaryCtaHref",
    HOMEPAGE_MOTORSPORT_DEFAULTS.secondaryCtaHref,
  );

  const featuresRaw = config["features"];
  const features = Array.isArray(featuresRaw)
    ? featuresRaw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : HOMEPAGE_MOTORSPORT_DEFAULTS.features;

  const isExternal = /^https?:\/\//i.test(secondaryCtaHref);

  return (
    <section
      data-homepage-section="motorsport"
      data-motorsport-compact={compact ? "true" : undefined}
      className="relative isolate overflow-hidden bg-[#070b14] text-white"
      aria-labelledby="motorsport-feature-heading"
    >
      <div
        className={cn(
          "relative",
          compact ? "min-h-[28rem] sm:min-h-[32rem]" : "min-h-[36rem] sm:min-h-[42rem] lg:min-h-[48rem]",
        )}
      >
        {/* Photographic plane — genuine CMS media only; dark atmosphere when empty */}
        <div className="absolute inset-0" aria-hidden={!src}>
          {src ? (
            <img
              src={src}
              alt={alt}
              className={cn(
                "size-full",
                cmsImageFitClass(fit === "contain" ? "contain" : "fill"),
                // Prefer right-side subject on desktop; CMS focal overrides.
                !media?.["focalX"] && !media?.["focalY"] && "object-[72%_42%] sm:object-[75%_40%]",
              )}
              style={focalStyle}
              loading={compact ? "eager" : "lazy"}
              decoding="async"
              sizes="100vw"
            />
          ) : (
            <div
              className="size-full bg-[radial-gradient(ellipse_at_70%_40%,#1a2744_0%,#070b14_55%,#05070d_100%)]"
              role="img"
              aria-label="Motorsport photography placeholder — upload licensed imagery in Website Builder"
            />
          )}
          {/* Left-weighted navy gradient — text legibility without burying the car */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#05070d] via-[#05070d]/88 to-[#05070d]/15 sm:via-[#05070d]/75 sm:to-transparent"
            aria-hidden
          />
          <div
            className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#05070d]/90 to-transparent"
            aria-hidden
          />
        </div>

        <div className="relative mx-auto flex h-full max-w-[1400px] flex-col justify-end px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
          <div className="max-w-xl">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan">{eyebrow}</p>
            ) : null}
            <h2
              id="motorsport-feature-heading"
              className={cn(
                "mt-3 font-display font-semibold uppercase leading-[0.92] tracking-tight whitespace-pre-line",
                compact
                  ? "text-[2.25rem] sm:text-[3.25rem]"
                  : "text-[2.5rem] sm:text-[3.5rem] lg:text-[4rem]",
              )}
            >
              {headline}
            </h2>
            {supporting ? (
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/75">{supporting}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={ctaHref || "/motorsport"}
                className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
              >
                {ctaLabel}
                <ArrowRight className="size-4" aria-hidden />
              </a>
              {secondaryCtaLabel && secondaryCtaHref ? (
                <a
                  href={secondaryCtaHref}
                  {...(isExternal
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="inline-flex h-12 items-center rounded-md border border-white/25 bg-white/5 px-6 text-[13px] font-semibold uppercase tracking-wide text-white transition hover:border-white/50"
                >
                  {secondaryCtaLabel}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {features.length > 0 ? (
        <div className="relative border-t border-white/10 bg-[#080c16]">
          <ul className="mx-auto grid max-w-[1400px] gap-0 sm:grid-cols-3">
            {features.map((feature, index) => {
              const title = typeof feature["title"] === "string" ? feature["title"] : "";
              const body = typeof feature["body"] === "string" ? feature["body"] : "";
              const iconKey =
                feature["icon"] === "handshake" || feature["icon"] === "users"
                  ? feature["icon"]
                  : "flag";
              const Icon = FEATURE_ICONS[iconKey];
              return (
                <li
                  key={`${title}-${index}`}
                  className={cn(
                    "flex gap-3 px-4 py-5 sm:px-6 lg:px-10",
                    index > 0 && "border-t border-white/10 sm:border-t-0 sm:border-l",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white">{title}</p>
                    <p className="mt-1.5 text-[13px] leading-snug text-white/65">{body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
