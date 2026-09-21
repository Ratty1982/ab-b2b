import { useState } from "react";
import { Check } from "lucide-react";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { TradePrice } from "@/components/ab/Price";
import { ProductImage } from "@/components/public/ProductImage";
import { ProductCard } from "@/components/public/ProductCard";
import { sanitizeProductDescriptionHtml } from "@/domain/product-content-html";
import {
  featuresForDisplay,
  formatPublicOrderingRows,
  formatPublicSpecRows,
  hasPublicText,
  parseDirections,
} from "@/domain/product-spec-display";
import { cn } from "@/lib/utils";
import type { PublicProductCard } from "@/server/catalogue/products";
import type { ProductSellingContent } from "@/domain/product-specifications";

export type PublicProductDetail = {
  card: PublicProductCard;
  sku: string;
  shortDescription: string | null;
  description: string | null;
  specifications: Array<{ name: string; value: string }>;
  selling?: ProductSellingContent | null;
  gallery: Array<{ src: string; alt: string }>;
  related: PublicProductCard[];
  packQty?: number | null;
  caseQty?: number | null;
  minimumOrderQty?: number | null;
  orderIncrement?: number | null;
};

export function ProductDetailView({ data }: { data: PublicProductDetail }) {
  const selling = data.selling ?? {
    keyBenefits: [],
    features: [],
    applications: [],
    directions: null,
    warnings: null,
  };
  const benefits = selling.keyBenefits.filter(Boolean);
  const features = featuresForDisplay(benefits, selling.features.filter(Boolean));
  const applications = selling.applications.filter(Boolean);
  const specs = formatPublicSpecRows(data.specifications);
  const ordering = formatPublicOrderingRows({
    packQty: data.packQty,
    caseQty: data.caseQty,
    minimumOrderQty: data.minimumOrderQty,
    orderIncrement: data.orderIncrement,
  });
  const showDescription = hasPublicText(data.description);
  const showDirections = hasPublicText(selling.directions);
  const showWarnings = hasPublicText(selling.warnings);
  const showLeft = showDirections || showWarnings;
  const showRight = specs.length > 0 || ordering.length > 0;

  return (
    <div
      data-product-detail="page"
      className="mx-auto max-w-[1400px] overflow-x-hidden px-4 py-6 sm:px-6 lg:px-10"
    >
      <ProductDetailHero data={data} />
      <div data-product-detail="content" className="mt-10 space-y-10 border-t border-border/70 pt-10">
        {showDescription ? <ProductDescription html={data.description!} /> : null}
        {benefits.length && features.length ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:items-start">
            <ProductBenefits items={benefits} />
            <ProductFeatures items={features} />
          </div>
        ) : (
          <>
            {benefits.length ? <ProductBenefits items={benefits} /> : null}
            {features.length ? <ProductFeatures items={features} /> : null}
          </>
        )}
        {applications.length ? <ProductApplications items={applications} /> : null}
        {showLeft || showRight ? (
          <div
            data-product-lower={showLeft && showRight ? "split" : showLeft ? "directions" : "specs"}
            className={cn(
              "grid items-start gap-8",
              showLeft && showRight && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
              !showLeft && showRight && "max-w-3xl",
            )}
          >
            {showLeft ? (
              <div className="space-y-6">
                {showDirections ? <ProductDirections text={selling.directions!} /> : null}
                {showWarnings ? <ProductWarnings text={selling.warnings!} /> : null}
              </div>
            ) : null}
            {showRight ? <ProductSpecifications productRows={specs} orderingRows={ordering} /> : null}
          </div>
        ) : null}
      </div>
      {data.related.length ? (
        <section data-product-section="related" className="mt-12 border-t border-border/70 pt-10">
          <h2 className="font-display text-xl font-semibold uppercase tracking-tight">Related products</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.related.map((related) => (
              <ProductCard key={related.id} product={related} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ProductDetailHero({ data }: { data: PublicProductDetail }) {
  const product = data.card;
  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
      <ProductGallery images={data.gallery} fallbackSrc={product.imageSrc} name={product.name} />
      <div className="lg:col-span-7">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-cyan">{product.brand}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-4xl">
          {product.name}
        </h1>
        <p className="num mt-2 text-[13px] text-steel">{data.sku}</p>
        {product.availability ? (
          <div className="mt-3" data-product-availability={product.availability}>
            <AvailabilityBadge availability={product.availability} />
          </div>
        ) : null}
        <div className="mt-4">
          <TradePrice trade={product.price.trade} rrp={product.price.rrp} size="lg" />
        </div>
        {hasPublicText(data.shortDescription) ? (
          <p data-product-short-description className="mt-5 max-w-xl text-[15px] leading-relaxed text-steel">
            {data.shortDescription}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProductGallery({
  images,
  fallbackSrc,
  name,
}: {
  images: Array<{ src: string; alt: string }>;
  fallbackSrc: string | null;
  name: string;
}) {
  const slides = images.length ? images : [{ src: fallbackSrc ?? "", alt: name }];
  const [active, setActive] = useState(0);
  const current = slides[Math.min(active, slides.length - 1)]!;
  return (
    <div className="lg:col-span-5">
      <ProductImage src={current.src || null} alt={current.alt || name} layout="detail" />
      {slides.length > 1 ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {slides.map((img, i) => (
            <button
              key={img.src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              className="block w-full"
            >
              <ProductImage src={img.src || null} alt="" layout="card" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProductDescription({ html }: { html: string }) {
  const sanitised = sanitizeProductDescriptionHtml(html);
  const isHtml = /<[a-z][\s\S]*>/i.test(sanitised);
  return (
    <section data-product-section="description">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">Product description</h2>
      {isHtml ? (
        <div
          className="mt-4 max-w-3xl text-[15px] leading-relaxed text-foreground/90 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-lg [&_h3]:mt-3 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_strong]:text-foreground"
          dangerouslySetInnerHTML={{ __html: sanitised }}
        />
      ) : (
        <p className="mt-4 max-w-3xl whitespace-pre-wrap text-[15px] leading-relaxed">{sanitised}</p>
      )}
    </section>
  );
}

export function ProductBenefits({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section data-product-section="benefits">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">Key benefits</h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 rounded-lg border border-border bg-ink/60 p-3.5">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className="text-[13px] leading-snug">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductFeatures({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section data-product-section="features" className="rounded-lg border border-border bg-surface/40 p-5">
      <h2 className="font-display text-lg font-semibold uppercase tracking-tight">Features</h2>
      <ul className="mt-3 grid gap-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-snug">
            <Check className="mt-0.5 size-3.5 shrink-0 text-cyan" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductApplications({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section data-product-section="applications">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">Suitable for</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-full border border-border bg-surface/50 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProductDirections({ text }: { text: string }) {
  if (!hasPublicText(text)) return null;
  const parsed = parseDirections(text);
  return (
    <section data-product-section="directions" className="rounded-lg border border-border bg-surface/30 p-5">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">How to use</h2>
      {parsed.kind === "steps" ? (
        <ol className="mt-3 grid gap-2 text-[14px] leading-relaxed">
          {parsed.steps.map((step, i) => (
            <li key={step} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
              <span className="num text-primary">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{parsed.text}</p>
      )}
    </section>
  );
}

export function ProductWarnings({ text }: { text: string }) {
  if (!hasPublicText(text)) return null;
  return (
    <section data-product-section="warnings" className="rounded-lg border border-warn/35 bg-warn/5 p-5">
      <h2 className="font-display text-lg font-semibold uppercase tracking-tight">Important information</h2>
      <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{text}</p>
    </section>
  );
}

function SpecTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="divide-y divide-border/80 border-y border-border/80">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-[12px] font-semibold uppercase tracking-wide text-steel">{row.label}</dt>
          <dd className="num text-[14px]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProductSpecifications({
  productRows = [],
  orderingRows = [],
}: {
  productRows?: Array<{ label: string; value: string }>;
  orderingRows?: Array<{ label: string; value: string }>;
}) {
  if (!productRows.length && !orderingRows.length) return null;
  return (
    <section data-product-section="specifications">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">Specifications</h2>
      {productRows.length ? (
        <div className="mt-4">
          {orderingRows.length ? (
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">Product</h3>
          ) : null}
          <SpecTable rows={productRows} />
        </div>
      ) : null}
      {orderingRows.length ? (
        <div className="mt-6" data-product-section="ordering">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">Ordering</h3>
          <SpecTable rows={orderingRows} />
        </div>
      ) : null}
    </section>
  );
}
