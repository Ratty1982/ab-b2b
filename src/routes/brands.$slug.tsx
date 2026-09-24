import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicCatalogueShell } from "@/components/public/PublicCatalogueShell";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import { getClientSession } from "@/server/auth/session";
import { getPublicBrandFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/brands/$slug")({
  validateSearch: (search: Record<string, unknown>): { q?: string; page?: number; category?: string } => {
    const out: { q?: string; page?: number; category?: string } = {};
    if (typeof search["q"] === "string") out.q = search["q"];
    if (typeof search["category"] === "string") out.category = search["category"];
    if (typeof search["page"] === "string" || typeof search["page"] === "number") out.page = Number(search["page"]);
    return out;
  },
  loader: async ({ params, location }) => {
    const search = location.search as { q?: string; page?: number; category?: string };
    const [requestSession, result] = await Promise.all([
      getClientSession(),
      getPublicBrandFn({
        data: { slug: params.slug, q: search.q, page: search.page, categorySlug: search.category },
      }),
    ]);
    if (!result.ok || !result.data) throw notFound();
    return { ...result.data, requestSession };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "Brand"} — Automotive Brands` },
      { name: "description", content: loaderData?.description ?? "" },
    ],
  }),
  component: BrandPage,
});

function BrandLanding({
  name,
  slug,
  tagline,
  description,
  logoSrc,
  total,
}: {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  logoSrc: string | null;
  total: number;
}) {
  return (
    <div className="mb-2 grid gap-4 rounded-lg border border-border/70 bg-surface/40 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {tagline ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan">{tagline}</p>
        ) : null}
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-steel">
          {description || `${name} products available to Automotive Brands trade customers.`}
        </p>
        <p className="num mt-2 text-[12px] text-steel">
          {total.toLocaleString("en-GB")} trade-visible line{total === 1 ? "" : "s"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`/products?brand=${encodeURIComponent(slug)}`}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            Browse all {name}
          </a>
          <Link
            to="/register"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Open a trade account
          </Link>
        </div>
      </div>
      {logoSrc ? (
        <div className="grid h-24 w-40 place-items-center rounded-md bg-white p-3">
          <img src={logoSrc} alt={`${name} logo`} className={cn("max-h-full max-w-full", mediaContainClass)} />
        </div>
      ) : null}
    </div>
  );
}

function BrandPage() {
  const brand = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <PublicCatalogueShell
      data={{ ...brand.catalogue, error: null }}
      heading={
        search.category && brand.catalogue.category
          ? `${brand.name} · ${brand.catalogue.category.name}`
          : brand.name
      }
      intro={undefined}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Brands", to: "/brands" },
        { label: brand.name },
      ]}
      context={{ brandSlug: brand.slug, q: search.q, brandRoute: true, categorySlug: search.category }}
      searchAction={`/brands/${brand.slug}`}
      requestSession={brand.requestSession}
      leading={
        !search.category && !search.q ? (
          <BrandLanding
            name={brand.name}
            slug={brand.slug}
            tagline={brand.tagline}
            description={brand.description}
            logoSrc={brand.logoSrc}
            total={brand.catalogue.total}
          />
        ) : null
      }
    />
  );
}
