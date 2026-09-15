import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { StockBadge } from "@/components/ab/Badges";
import { brands, products, gbp } from "@/lib/data";

export const Route = createFileRoute("/brands/$slug")({
  loader: ({ params }) => {
    const brand = brands.find((b) => b.slug === params.slug);
    if (!brand) throw notFound();
    return { brand };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Brand not found — Automotive Brands" }, { name: "robots", content: "noindex" }],
      };
    }
    const { brand } = loaderData;
    return {
      meta: [
        { title: `${brand.name} — Automotive Brands` },
        { name: "description", content: brand.blurb },
        { property: "og:title", content: `${brand.name} — Automotive Brands` },
        { property: "og:description", content: brand.blurb },
      ],
    };
  },
  component: BrandPage,
});

function BrandPage() {
  const { brand } = Route.useLoaderData();
  const brandProducts = products.filter((p) => p.brand === brand.name);
  const related = brands.filter((b) => b.slug !== brand.slug).slice(0, 4);

  return (
    <PublicLayout>
      <section className="border-b border-border/60 bg-surface/30">
        <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10">
          <Breadcrumbs
            items={[{ label: "Home", to: "/" }, { label: "Brands", to: "/brands" }, { label: brand.name }]}
          />
          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
                {brand.category}
              </div>
              <h1 className="mt-2 font-display text-4xl font-semibold uppercase tracking-tight sm:text-5xl">
                {brand.name}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-steel">{brand.blurb}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/products"
                search={{ brand: brand.name }}
                className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:brightness-110"
              >
                Shop {brand.name}
              </Link>
              <Link
                to="/register"
                className="inline-flex h-11 items-center rounded-md border border-border px-5 text-sm font-semibold transition-colors hover:border-steel"
              >
                Open a Trade Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-tight">
          Featured products
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {brandProducts.map((p) => (
            <Link
              key={p.sku}
              to="/products/$sku"
              params={{ sku: p.sku }}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40 transition-colors hover:border-primary/60"
            >
              <img
                src={p.image}
                alt={p.name}
                loading="lazy"
                width={912}
                height={736}
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="p-4">
                <div className="text-sm font-semibold leading-snug">{p.name}</div>
                <div className="num text-[12px] text-steel">SKU {p.sku}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="num font-display text-lg font-semibold">{gbp(p.trade)}</span>
                  <StockBadge stock={p.stock} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border/60">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:px-10">
          <div>
            <h2 className="font-display text-xl font-semibold uppercase tracking-tight">
              Trade resources
            </h2>
            <ul className="mt-4 divide-y divide-border border border-border">
              {[
                `${brand.name} Trade Price List 2026`,
                `${brand.name} Product Catalogue (PDF)`,
                "Point of sale & display artwork",
                "Product imagery pack",
              ].map((d) => (
                <li key={d} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate">{d}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wider text-steel">
                    Trade login required
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold uppercase tracking-tight">
              Related brands
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((b) => (
                <Link
                  key={b.slug}
                  to="/brands/$slug"
                  params={{ slug: b.slug }}
                  className="rounded-lg border border-border bg-surface/50 p-4 transition-colors hover:border-primary/60"
                >
                  <div className="font-display text-base font-semibold uppercase">{b.name}</div>
                  <div className="text-[12px] text-steel">{b.category}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
