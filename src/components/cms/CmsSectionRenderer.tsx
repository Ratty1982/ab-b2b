import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, Headphones, Truck, Warehouse } from "lucide-react";
import type { CmsSectionTypeKey } from "@/domain/cms";
import { brands } from "@/lib/data";
import { cn } from "@/lib/utils";
import heroImage from "@/assets/hero-parts.jpg";

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
      return (
        <section className="relative overflow-hidden border-b border-border/60">
          <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-10 lg:py-24">
            <div className="lg:col-span-6">
              <h1 className="font-display text-[44px] font-semibold uppercase leading-[0.92] tracking-tight sm:text-[72px]">
                {str(c, "headline")}
              </h1>
              <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-steel">
                {str(c, "supporting")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
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
            <div className="lg:col-span-6">
              <img
                src={str(mediaObj ?? {}, "src") || heroImage}
                alt={str(mediaObj ?? {}, "alt")}
                className="aspect-[6/5] w-full rounded-xl object-cover outline outline-1 -outline-offset-1 outline-border/60"
              />
            </div>
          </div>
        </section>
      );
    }

    case "FEATURED_BRANDS": {
      const slugs = Array.isArray(c["brandSlugs"]) ? (c["brandSlugs"] as string[]) : [];
      const selected = brands
        .filter((b) => slugs.includes(b.slug))
        .slice(0, num(c, "displayCount", 5) || 5);
      const list = selected.length ? selected : brands.slice(0, 5);
      return (
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              {str(c, "supporting", "Our brands")}
            </div>
            <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {str(c, "heading")}
            </h2>
            <div className="mt-8 grid gap-px border border-border bg-border lg:grid-cols-2">
              {list.map((brand, i) => (
                <Link
                  key={brand.slug}
                  to="/brands/$slug"
                  params={{ slug: brand.slug }}
                  className={cn(
                    "group bg-surface/70 p-6 transition-colors hover:bg-surface",
                    i === 0 && "lg:col-span-2",
                  )}
                >
                  <h3 className="font-display text-2xl font-semibold uppercase">{brand.name}</h3>
                  <p className="mt-2 max-w-md text-[13px] text-steel">{brand.blurb}</p>
                </Link>
              ))}
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

    case "FEATURED_PRODUCTS":
    case "BRAND_LOGO_STRIP":
    case "TEXT_IMAGE":
    case "IMAGE_TEXT":
      return (
        <section className="border-b border-border/60 px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-[1400px]">
            <h2 className="font-display text-2xl font-semibold uppercase">
              {str(c, "heading") || str(c, "headline") || section.type}
            </h2>
            <p className="mt-2 text-sm text-steel">
              {str(c, "supporting") || str(c, "body")}
            </p>
          </div>
        </section>
      );

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
