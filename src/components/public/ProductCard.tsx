import { Link } from "@tanstack/react-router";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { TradePrice } from "@/components/ab/Price";
import { ProductImage } from "@/components/public/ProductImage";
import type { PublicProductCard } from "@/server/catalogue/products";
import { cn } from "@/lib/utils";

export function ProductCard({
  product,
  layout = "grid",
}: {
  product: PublicProductCard;
  layout?: "grid" | "list";
}) {
  const body = (
    <>
      <ProductImage src={product.imageSrc} alt={product.name} layout={layout === "list" ? "list" : "card"} />
      <div className={cn("min-w-0", layout === "list" ? "flex flex-1 flex-col justify-center" : "mt-3")}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan">{product.brand}</p>
        <h2
          className={cn(
            "mt-1 font-display text-sm font-semibold uppercase leading-snug",
            layout === "grid" ? "line-clamp-2 min-h-[2.5rem]" : "line-clamp-2",
          )}
        >
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
    </>
  );

  return (
    <Link
      to="/products/$sku"
      params={{ sku: product.slug }}
      aria-label={`${product.name}, ${product.sku}`}
      className={cn(
        "group rounded-lg border border-border bg-ink/50 p-3 shadow-none transition hover:border-primary/60 hover:bg-surface/55 hover:shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        layout === "grid" ? "flex flex-col" : "flex items-stretch gap-4",
      )}
    >
      {body}
    </Link>
  );
}

export function ProductResultGrid({
  items,
  layout,
}: {
  items: PublicProductCard[];
  layout: "grid" | "list";
}) {
  if (layout === "list") {
    return (
      <div className="grid gap-2">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} layout="list" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((product) => (
        <ProductCard key={product.id} product={product} layout="grid" />
      ))}
    </div>
  );
}
