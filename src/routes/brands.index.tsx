import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import { getPublicCmsPageFn, listPublicBrandsFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("brands")!;

export const Route = createFileRoute("/brands/")({
  loader: async () => {
    const [cms, brands] = await Promise.all([
      getPublicCmsPageFn({ data: { slug: "brands" } }),
      listPublicBrandsFn(),
    ]);
    if (!cms.ok || !cms.data) throw notFound();
    return {
      page: cms.data,
      brands: brands.ok ? brands.data : [],
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.page.seoTitle || FALLBACK.seoTitle },
      {
        name: "description",
        content: loaderData?.page.metaDescription || FALLBACK.metaDescription,
      },
    ],
  }),
  component: BrandsIndex,
});

function BrandDirectory({
  brands,
}: {
  brands: Array<{
    slug: string;
    name: string;
    tagline: string | null;
    description: string | null;
    logoSrc: string | null;
    lines: number;
  }>;
}) {
  if (!brands.length) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 text-sm text-steel sm:px-6 lg:px-10">
        No public brands are available yet.
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:px-10">
      {brands.map((b) => (
        <article
          key={b.slug}
          className="flex flex-col gap-4 rounded-lg border border-border/80 bg-surface/40 p-6 sm:p-8"
        >
          {b.logoSrc ? (
            <div className="grid h-16 w-fit place-items-center rounded-md bg-white px-3 py-2">
              <img src={b.logoSrc} alt={`${b.name} logo`} className={cn("h-10 w-auto", mediaContainClass)} />
            </div>
          ) : (
            <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
              {b.name
                .split(" ")
                .map((w) => w[0])
                .join("")}
            </span>
          )}
          <div>
            <h2 className="font-display text-2xl font-semibold uppercase sm:text-3xl">{b.name}</h2>
            {b.tagline ? (
              <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-cyan">{b.tagline}</p>
            ) : null}
          </div>
          {b.description ? <p className="text-sm leading-relaxed text-steel">{b.description}</p> : null}
          <p className="num text-[12px] text-steel">
            {b.lines.toLocaleString("en-GB")} trade-visible line{b.lines === 1 ? "" : "s"}
          </p>
          <Link
            to="/brands/$slug"
            params={{ slug: b.slug }}
            className="mt-auto inline-flex h-11 w-fit items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Shop {b.name}
          </Link>
        </article>
      ))}
    </div>
  );
}

function BrandsIndex() {
  const { page, brands } = Route.useLoaderData();
  return (
    <PublicCmsPage
      page={page}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Brands" }]}
      trailing={<BrandDirectory brands={brands} />}
    />
  );
}
