import { ArrowRight, ClipboardList, Headphones, Truck, Warehouse } from "lucide-react";
import type { CmsSectionTypeKey } from "@/domain/cms";
import { resolveFeaturedBrandCards, featuredBrandsIntro } from "@/domain/featured-brands";
import { brands } from "@/lib/data";
import { cn } from "@/lib/utils";
import heroImage from "@/assets/hero-parts.jpg";
import { cmsMediaDisplaySrc, cmsFocalStyle, cmsImageFitClass, readBrandLogos } from "@/lib/cms-media";
import { mediaContainClass } from "@/lib/media-presentation";

type Section = {
  id: string;
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
};

const icons = {
  warehouse: Warehouse,
  truck: Truck,
  clipboard: ClipboardList,
  headphones: Headphones,
} as const;

function str(c: Record<string, unknown>, key: string, fallback = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : fallback;
}

function num(c: Record<string, unknown>, key: string, fallback = 0): number {
  const v = c[key];
  return typeof v === "number" ? v : fallback;
}

export function CmsSectionRenderer({ section }: { section: Section }) {
  const c = section.config;
  switch (section.type) {
    case "HERO": {
      const media = c["media"];
      const mediaObj =
        media && typeof media === "object" ? (media as Record<string, unknown>) : null;
      const heroSrc = cmsMediaDisplaySrc(mediaObj) || heroImage;
      const fit = mediaObj?.["fit"] ?? "fill";
      const overlay = num(c, "overlayStrength", 0);
      const align = str(c, "alignment", "left");
      const position = str(c, "contentPosition", "middle");
      const variant = str(c, "variant", "split");
      const spacing = str(c, "spacing", "standard");
      const pad = spacing === "compact" ? "py-10 lg:py-14" : spacing === "relaxed" ? "py-20 lg:py-28" : "py-16 lg:py-24";
      const textAlign =
        align === "center" ? "text-center mx-auto" : align === "right" ? "text-right ml-auto" : "text-left";
      const vAlign =
        position === "top" ? "items-start" : position === "bottom" ? "items-end" : "items-center";
      const ctaWrap = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
      const copy = (
        <div className={cn("max-w-xl", textAlign)}>
          {str(c, "eyebrow") ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              {str(c, "eyebrow")}
            </div>
          ) : null}
          <h1
            className={cn(
              "font-display text-[44px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-[72px]",
              str(c, "eyebrow") && "mt-4",
            )}
          >
            {str(c, "headline")}
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-steel">{str(c, "supporting")}</p>
          <div className={cn("mt-8 flex flex-wrap items-center gap-3", ctaWrap)}>
            <a
              href={str(c, "ctaHref", "/register")}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              {str(c, "ctaLabel", "Open a Trade Account")}
              <ArrowRight className="size-4" aria-hidden />
            </a>
            {str(c, "secondaryCtaLabel") ? (
              <a
                href={str(c, "secondaryCtaHref", "/brands")}
                className="inline-flex h-12 items-center rounded-md border border-border bg-surface/50 px-6 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
              >
                {str(c, "secondaryCtaLabel")}
              </a>
            ) : null}
          </div>
        </div>
      );
      const picture = (
        <div className="relative overflow-hidden rounded-xl bg-ink outline outline-1 -outline-offset-1 outline-border/60">
          <div className="aspect-[25/21] w-full">
            <img
              src={heroSrc}
              alt={str(mediaObj ?? {}, "alt")}
              className={cmsImageFitClass(fit)}
              style={cmsFocalStyle(mediaObj)}
            />
          </div>
        </div>
      );

      if (variant === "dark" || variant === "light") {
        // Compact page header for marketing CMS pages (no full-bleed hero media).
        return (
          <section className="border-b border-border/60">
            <div className={cn("mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10", pad)}>
              <div className={cn("max-w-3xl", textAlign)}>
                {str(c, "eyebrow") ? (
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
                    {str(c, "eyebrow")}
                  </div>
                ) : null}
                <h1
                  className={cn(
                    "font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl",
                    str(c, "eyebrow") && "mt-2",
                  )}
                >
                  {str(c, "headline")}
                </h1>
                {str(c, "supporting") ? (
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">{str(c, "supporting")}</p>
                ) : null}
                <div className={cn("mt-6 flex flex-wrap items-center gap-3", ctaWrap)}>
                  {str(c, "ctaLabel") ? (
                    <a
                      href={str(c, "ctaHref", "/register")}
                      className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
                    >
                      {str(c, "ctaLabel")}
                      <ArrowRight className="size-4" aria-hidden />
                    </a>
                  ) : null}
                  {str(c, "secondaryCtaLabel") ? (
                    <a
                      href={str(c, "secondaryCtaHref", "/brands")}
                      className="inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
                    >
                      {str(c, "secondaryCtaLabel")}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        );
      }

      if (variant === "wide") {
        return (
          <section className="relative overflow-hidden border-b border-border/60">
            <div className="absolute inset-0">
              <img
                src={heroSrc}
                alt=""
                className={cn("h-full w-full", cmsImageFitClass("fill"))}
                style={cmsFocalStyle(mediaObj)}
              />
              <div className="absolute inset-0 bg-ink" style={{ opacity: overlay / 100 }} />
            </div>
            <div className={cn("relative mx-auto flex min-h-[420px] max-w-[1400px] px-4 sm:px-6 lg:px-10", pad, vAlign)}>
              {copy}
            </div>
          </section>
        );
      }

      return (
        <section className="relative overflow-hidden border-b border-border/60">
          <div className={cn("mx-auto grid max-w-[1400px] gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-10", pad, vAlign)}>
            <div className="lg:col-span-6">{copy}</div>
            <div className="lg:col-span-6">{picture}</div>
          </div>
        </section>
      );
    }

    case "FEATURED_BRANDS": {
      const list = resolveFeaturedBrandCards(c);
      return (
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
            <h2 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(c, "heading")}
            </h2>
            {featuredBrandsIntro(c) ? (
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-steel">{featuredBrandsIntro(c)}</p>
            ) : null}
            <div className="mt-8 grid gap-px border border-border bg-border lg:grid-cols-2">
              {list.map((brand, i) => {
                const logoSrc = cmsMediaDisplaySrc(brand.logo);
                const logoAlt = brand.logo?.alt || `${brand.heading} logo`;
                const href = brand.href || `/brands/${brand.slug}`;
                return (
                  <a
                    key={brand.slug}
                    href={href}
                    className={cn(
                      "group grid gap-4 bg-surface/70 p-6 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_140px]",
                      i === 0 && "lg:col-span-2 sm:grid-cols-[minmax(0,1fr)_220px]",
                    )}
                  >
                    <div className="min-w-0">
                      <h3 className="font-display text-2xl font-semibold uppercase">{brand.heading}</h3>
                      {brand.description ? (
                        <p className="mt-2 max-w-md text-[13px] text-steel">{brand.description}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-center rounded-md border border-border/70 bg-white p-4">
                      {logoSrc ? (
                        <img
                          src={logoSrc}
                          alt={logoAlt}
                          className={cn("max-h-16 w-full", mediaContainClass, i === 0 && "max-h-24")}
                        />
                      ) : (
                        <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-steel">
                          Logo not set
                        </div>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    case "CATEGORY_GRID": {
      const cats = Array.isArray(c["categories"])
        ? (c["categories"] as Array<{ name: string; href: string }>)
        : [];
      return (
        <section className="border-b border-border/60 bg-surface/30">
          <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
            <h2 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(c, "heading")}
            </h2>
            <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {cats.map((cat) => (
                <a
                  key={cat.name}
                  href={cat.href || "/products"}
                  className="bg-ink p-5 transition-colors hover:bg-surface"
                >
                  <div className="font-display text-lg font-semibold uppercase">{cat.name}</div>
                </a>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "BENEFITS_GRID": {
      const items = Array.isArray(c["items"])
        ? (c["items"] as Array<{ title: string; body: string; icon?: keyof typeof icons }>)
        : [];
      return (
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
            {str(c, "heading") ? (
              <h2 className="font-display text-3xl font-semibold uppercase tracking-tight">
                {str(c, "heading")}
              </h2>
            ) : null}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((item) => {
                const Icon = icons[item.icon ?? "warehouse"] ?? Warehouse;
                return (
                  <div key={item.title} className="border border-border bg-surface/40 p-5">
                    <Icon className="size-5 text-primary" aria-hidden />
                    <div className="mt-3 font-display text-lg font-semibold uppercase">{item.title}</div>
                    <p className="mt-2 text-[13px] text-steel">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    case "TRADE_CTA":
      return (
        <section className="border-b border-border/60 bg-primary/10">
          <div className="mx-auto max-w-[1400px] px-4 py-16 text-center sm:px-6 lg:px-10">
            <h2 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(c, "headline")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-steel">{str(c, "supporting")}</p>
            <a
              href={str(c, "ctaHref", "/register")}
              className="mt-8 inline-flex h-12 items-center rounded-md bg-primary px-6 text-sm font-bold uppercase tracking-wide text-primary-foreground"
            >
              {str(c, "ctaLabel")}
            </a>
          </div>
        </section>
      );

    case "BANNER":
      return (
        <div className="border-b border-border bg-surface/50 px-4 py-3 text-center text-sm">
          {str(c, "text")}
        </div>
      );

    case "RICH_TEXT":
      return (
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-steel">
            {str(c, "content")}
          </div>
        </section>
      );

    case "SPACER": {
      const size = str(c, "size", "md");
      return (
        <div className={cn(size === "sm" && "h-6", size === "md" && "h-12", size === "lg" && "h-24")} />
      );
    }

    case "TEXT_IMAGE":
    case "IMAGE_TEXT": {
      const media = c["media"];
      const mediaObj =
        media && typeof media === "object" ? (media as Record<string, unknown>) : null;
      const imgSrc = cmsMediaDisplaySrc(mediaObj);
      const imageFirst = section.type === "IMAGE_TEXT";
      const copy = (
        <div>
          <h2 className="font-display text-2xl font-semibold uppercase">
            {str(c, "heading") || section.type}
          </h2>
          <p className="mt-2 text-sm text-steel">{str(c, "body")}</p>
          {str(c, "ctaLabel") ? (
            <a
              href={str(c, "ctaHref", "/")}
              className="mt-4 inline-flex h-10 items-center text-sm font-semibold uppercase text-primary"
            >
              {str(c, "ctaLabel")}
            </a>
          ) : null}
        </div>
      );
      const picture = imgSrc ? (
        <img
          src={imgSrc}
          alt={str(mediaObj ?? {}, "alt")}
          className={cn(
            "aspect-[4/3] w-full rounded-xl outline outline-1 -outline-offset-1 outline-border/60",
            cmsImageFitClass(mediaObj?.["fit"] ?? "content"),
          )}
          style={cmsFocalStyle(mediaObj)}
        />
      ) : (
        <div className="grid aspect-[4/3] place-items-center rounded-xl border border-dashed border-border text-sm text-steel">
          No image selected
        </div>
      );
      return (
        <section className="border-b border-border/60 px-4 py-12 sm:px-6">
          <div className="mx-auto grid max-w-[1400px] items-center gap-8 lg:grid-cols-2">
            {imageFirst ? picture : copy}
            {imageFirst ? copy : picture}
          </div>
        </section>
      );
    }

    case "FEATURED_PRODUCTS":
    case "BRAND_LOGO_STRIP": {
      if (section.type === "BRAND_LOGO_STRIP") {
        const slugs = Array.isArray(c["brandSlugs"]) ? (c["brandSlugs"] as string[]) : [];
        const selected = brands.filter((b) => slugs.includes(b.slug));
        const logos = readBrandLogos(c);
        return (
          <section className="border-b border-border/60 px-4 py-10 sm:px-6">
            <div className="mx-auto max-w-[1400px]">
              {str(c, "heading") ? (
                <h2 className="mb-6 font-display text-xl font-semibold uppercase">{str(c, "heading")}</h2>
              ) : null}
              <div className="flex flex-wrap items-center gap-6">
                {(selected.length ? selected : brands.slice(0, 5)).map((brand) => {
                  const logoSrc = cmsMediaDisplaySrc(logos[brand.slug]);
                  return (
                    <div key={brand.slug} className="grid h-16 w-36 place-items-center border border-border bg-white px-3">
                      {logoSrc ? (
                        <img src={logoSrc} alt={logos[brand.slug]?.alt || brand.name} className={cn("max-h-10 max-w-full", mediaContainClass)} />
                      ) : (
                        <span className="text-[11px] font-semibold uppercase text-steel">{brand.name}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      }
      const skus = Array.isArray(c["productSkus"]) ? (c["productSkus"] as string[]) : [];
      return (
        <section className="border-b border-border/60 px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-[1400px]">
            <h2 className="font-display text-2xl font-semibold uppercase">
              {str(c, "heading") || section.type}
            </h2>
            <p className="mt-2 text-sm text-steel">{str(c, "supporting")}</p>
            {skus.length ? (
              <p className="mt-4 text-[12px] uppercase tracking-wide text-steel">SKUs: {skus.join(", ")}</p>
            ) : (
              <p className="mt-4 text-sm text-steel">No products selected yet. Add SKUs in section settings.</p>
            )}
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

export function CmsPageView({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((section) => (
        <CmsSectionRenderer key={section.id} section={section} />
      ))}
    </>
  );
}
