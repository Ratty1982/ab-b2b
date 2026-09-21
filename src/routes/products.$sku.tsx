import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PublicLayout, Breadcrumbs } from "@/components/ab/PublicLayout";
import { TradePrice } from "@/components/ab/Price";
import { ProductImage } from "@/components/public/ProductImage";
import { ProductCard } from "@/components/public/ProductCard";
import { getPublicProductFn } from "@/server/phase2/fns";
import { gbp } from "@/lib/data";

export const Route = createFileRoute("/products/$sku")({
  loader: async ({ params }) => {
    const result = await getPublicProductFn({ data: { slug: params.sku } });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Product unavailable — Automotive Brands" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.card;
    return {
      meta: [
        { title: `${p.name} — Automotive Brands` },
        { name: "description", content: loaderData.shortDescription || `${p.name} by ${p.brand}` },
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const data = Route.useLoaderData();
  const p = data.card;
  const [active, setActive] = useState(0);
  const images = data.gallery.length ? data.gallery : [{ src: p.imageSrc ?? "", alt: p.name }];

  return (
    <PublicLayout>
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Products", to: "/products" }, { label: p.name }]} />
        <div className="mt-6 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            {images[active]?.src ? (
              <ProductImage src={images[active]!.src} alt={images[active]!.alt || p.name} layout="detail" />
            ) : (
              <ProductImage src={null} alt="" layout="detail" />
            )}
            {images.length > 1 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {images.map((img, i) => (
                  <button key={img.src + i} type="button" onClick={() => setActive(i)} className="block w-full" aria-label={`Show image ${i + 1}`}>
                    <ProductImage src={img.src} alt="" layout="card" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="lg:col-span-7">
            <p className="text-[12px] uppercase tracking-[0.16em] text-cyan">{p.brand}</p>
            <h1 className="mt-2 font-display text-3xl font-semibold uppercase">{p.name}</h1>
            <p className="num mt-1 text-[13px] text-steel">{data.sku}</p>
            <div className="mt-4">
              <TradePrice trade={p.price.trade} rrp={p.price.rrp} size="lg" />
            </div>
            {data.shortDescription ? <p className="mt-4 max-w-xl text-sm text-steel">{data.shortDescription}</p> : null}
            {data.description ? <div className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed">{data.description}</div> : null}
            {data.specifications.length ? (
              <dl className="mt-6 grid max-w-lg grid-cols-2 gap-2 text-[13px]">
                {data.specifications.map((s) => (
                  <div key={s.name} className="contents">
                    <dt className="text-steel">{s.name}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
        {data.related.length ? (
          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold uppercase">Related</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.related.map((r) => (
                <ProductCard key={r.id} product={r} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PublicLayout>
  );
}

void gbp;
