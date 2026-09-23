import { Link } from "@tanstack/react-router";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { CatalogueRrp, CatalogueYourPrice, TradePrice } from "@/components/ab/Price";
import { ProductImage } from "@/components/public/ProductImage";
import { CatalogueListQuickOrder } from "@/components/public/CatalogueListQuickOrder";
import type { PublicProductCard } from "@/server/catalogue/products";

export const CATALOGUE_GRID_KIND = "product-card-grid";
export const CATALOGUE_LIST_KIND = "product-list-rows";

/** Base list row template. When ORDER is present, `PRODUCT_LIST_ROW_ORDER_CLASS` is used. */
export const PRODUCT_LIST_ROW_CLASS =
  "group grid grid-cols-[80px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border/80 px-2 py-2.5 transition-colors hover:bg-surface/50 focus-within:bg-surface/40 min-h-[80px] lg:grid-cols-[80px_minmax(0,1.4fr)_9rem_6.5rem_8.5rem] lg:min-h-[88px] lg:max-h-[110px]";

export const PRODUCT_LIST_ROW_ORDER_CLASS =
  "group grid grid-cols-[80px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border/80 px-2 py-2.5 transition-colors hover:bg-surface/50 focus-within:bg-surface/40 min-h-[80px] lg:grid-cols-[80px_minmax(0,1.2fr)_7.5rem_5.5rem_7.5rem_minmax(11rem,14rem)] lg:min-h-[88px] lg:max-h-[120px]";

export const PRODUCT_LIST_HEADER_CLASS =
  "hidden border-b border-border bg-surface/40 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-steel lg:grid lg:grid-cols-[80px_minmax(0,1.4fr)_9rem_6.5rem_8.5rem] lg:gap-x-3";

export const PRODUCT_LIST_HEADER_ORDER_CLASS =
  "hidden border-b border-border bg-surface/40 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-steel lg:grid lg:grid-cols-[80px_minmax(0,1.2fr)_7.5rem_5.5rem_7.5rem_minmax(11rem,14rem)] lg:gap-x-3";

export function catalogueResultsKind(view: "grid" | "list") {
  return view === "list" ? CATALOGUE_LIST_KIND : CATALOGUE_GRID_KIND;
}

export function catalogueListShowsOrder(items: PublicProductCard[]) {
  return items.some((item) => item.ordering != null);
}

export function ProductCard({ product }: { product: PublicProductCard }) {
  return (
    <Link
      to="/products/$sku"
      params={{ sku: product.slug }}
      aria-label={`${product.name}, ${product.sku}`}
      data-catalogue-item="card"
      className="group flex flex-col rounded-lg border border-border bg-ink/50 p-3 shadow-none transition hover:border-primary/60 hover:bg-surface/55 hover:shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ProductImage src={product.imageSrc} alt={product.name} layout="card" />
      <div className="mt-3 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan">{product.brand}</p>
        <h2 className="mt-1 line-clamp-2 min-h-[2.5rem] font-display text-sm font-semibold uppercase leading-snug">
          {product.name}
        </h2>
        <p className="num mt-1 text-[11px] text-steel">{product.sku}</p>
        <div className="mt-2">
          <TradePrice trade={product.price.trade} rrp={product.price.rrp} size="sm" ctaMode="text" />
        </div>
        <div className="mt-2">
          <AvailabilityBadge availability={product.availability} />
        </div>
      </div>
    </Link>
  );
}

export function ProductListRow({
  product,
  showOrder,
}: {
  product: PublicProductCard;
  showOrder: boolean;
}) {
  const hrefParams = { sku: product.slug };
  return (
    <article
      data-catalogue-item="list-row"
      data-catalogue-order-column={showOrder ? "true" : "false"}
      className={showOrder ? PRODUCT_LIST_ROW_ORDER_CLASS : PRODUCT_LIST_ROW_CLASS}
    >
      <Link
        to="/products/$sku"
        params={hrefParams}
        tabIndex={-1}
        aria-hidden="true"
        className="row-start-1"
      >
        <ProductImage src={product.imageSrc} alt="" layout="thumb" />
      </Link>
      <div className="min-w-0 lg:pr-4">
        <Link
          to="/products/$sku"
          params={hrefParams}
          className="line-clamp-2 font-display text-sm font-semibold uppercase leading-snug text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {product.name}
        </Link>
        <p className="mt-0.5 truncate text-[12px] text-steel">
          <span className="text-cyan">{product.brand}</span>
          <span aria-hidden> · </span>
          <span className="num">{product.sku}</span>
        </p>
        <div className="mt-1 lg:hidden">
          <AvailabilityBadge availability={product.availability} />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 lg:hidden">
          <CatalogueYourPrice trade={product.price.trade} ctaMode="link" />
          <span className="text-[11px] text-steel">
            RRP <CatalogueRrp rrp={product.price.rrp} />
          </span>
        </div>
        {showOrder && product.variantId && product.ordering ? (
          <div className="mt-2 lg:hidden">
            <CatalogueListQuickOrder
              variantId={product.variantId}
              productName={product.name}
              availability={product.availability}
              initialPanel={product.ordering}
            />
          </div>
        ) : null}
      </div>
      <div className="hidden lg:flex lg:items-center">
        <AvailabilityBadge availability={product.availability} />
      </div>
      <div className="hidden lg:block lg:text-right">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">RRP</div>
        <CatalogueRrp rrp={product.price.rrp} />
      </div>
      <div className="hidden lg:block lg:text-right">
        <CatalogueYourPrice trade={product.price.trade} ctaMode="link" className="lg:text-right lg:[&>div]:ml-auto" />
      </div>
      {showOrder ? (
        <div className="hidden lg:block">
          {product.variantId && product.ordering ? (
            <CatalogueListQuickOrder
              variantId={product.variantId}
              productName={product.name}
              availability={product.availability}
              initialPanel={product.ordering}
            />
          ) : (
            <div className="text-[11px] text-steel">Unavailable</div>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function ProductResultList({ items }: { items: PublicProductCard[] }) {
  const showOrder = catalogueListShowsOrder(items);
  return (
    <div data-catalogue-layout="list" className="overflow-hidden rounded-lg border border-border bg-ink/40">
      <div className={showOrder ? PRODUCT_LIST_HEADER_ORDER_CLASS : PRODUCT_LIST_HEADER_CLASS}>
        <span className="sr-only">Image</span>
        <span className="col-start-2">Product</span>
        <span>Availability</span>
        <span className="text-right">RRP</span>
        <span className="text-right">Your price</span>
        {showOrder ? <span>Order</span> : null}
      </div>
      <div>
        {items.map((product) => (
          <ProductListRow key={product.id} product={product} showOrder={showOrder} />
        ))}
      </div>
    </div>
  );
}

export function ProductResultGrid({ items }: { items: PublicProductCard[] }) {
  return (
    <div
      data-catalogue-layout="grid"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      {items.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function ProductResults({
  items,
  layout,
}: {
  items: PublicProductCard[];
  layout: "grid" | "list";
}) {
  if (layout === "list") return <ProductResultList items={items} />;
  return <ProductResultGrid items={items} />;
}

export function productRowHasQuantity(availabilityLabel: string, payload: unknown) {
  const json = JSON.stringify(payload);
  return /\b\d+\s*(?:in stock|units?|pcs)\b/i.test(availabilityLabel) || /qtyOnHand|stockQty/.test(json);
}
