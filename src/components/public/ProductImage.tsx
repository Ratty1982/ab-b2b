import { PUBLIC_AVAILABILITY_LABEL, type PublicAvailability } from "@/domain/availability";
import { cn } from "@/lib/utils";

export const PRODUCT_IMAGE_LOGO_SRC = "/brand/ab-logo.jpg";
export const PRODUCT_IMAGE_PLACEHOLDER_LABEL = "Image coming soon";
export const PRODUCT_IMAGE_FIT_CLASS =
  "max-h-[85%] max-w-[85%] object-contain object-center transition-transform duration-200 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]";

/** Full catalogue card / PDP stage — never used by list rows. */
export const PRODUCT_IMAGE_CARD_STAGE_CLASS =
  "relative flex aspect-[5/4] w-full items-center justify-center overflow-hidden rounded-md bg-surface p-3";

export const PRODUCT_IMAGE_DETAIL_STAGE_CLASS =
  "relative flex aspect-[5/4] w-full items-center justify-center overflow-hidden rounded-lg bg-surface p-3";

/** Compact list thumbnail: 80px square, never full-width. */
export const PRODUCT_IMAGE_THUMB_STAGE_CLASS =
  "relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface p-1";

export const PRODUCT_IMAGE_STAGE_CLASS = PRODUCT_IMAGE_CARD_STAGE_CLASS;

export type ProductImageLayout = "card" | "thumb" | "list" | "detail";

export function productImageStageClass(layout: ProductImageLayout = "card") {
  if (layout === "thumb" || layout === "list") return PRODUCT_IMAGE_THUMB_STAGE_CLASS;
  if (layout === "detail") return PRODUCT_IMAGE_DETAIL_STAGE_CLASS;
  return PRODUCT_IMAGE_CARD_STAGE_CLASS;
}

export function ProductImage({
  src,
  alt,
  layout = "card",
  className,
}: {
  src?: string | null;
  alt: string;
  layout?: ProductImageLayout;
  className?: string;
}) {
  const compact = layout === "thumb" || layout === "list";
  const stage = cn(productImageStageClass(layout), className);
  if (!src) {
    return (
      <div className={stage} data-product-image-stage={compact ? "thumb" : layout} aria-hidden="true">
        <div className={cn("flex flex-col items-center text-center", compact ? "gap-0.5 px-0.5" : "gap-2 px-3")}>
          <img
            src={PRODUCT_IMAGE_LOGO_SRC}
            alt=""
            width={compact ? 20 : 32}
            height={compact ? 20 : 32}
            className={cn("rounded-sm object-contain opacity-40", compact ? "size-5" : "size-8")}
          />
          <span
            className={cn(
              "font-semibold uppercase tracking-[0.14em] text-steel/70",
              compact ? "text-[7px] leading-tight" : "text-[9px] tracking-[0.18em]",
            )}
          >
            {PRODUCT_IMAGE_PLACEHOLDER_LABEL}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={stage} data-product-image-stage={compact ? "thumb" : layout}>
      <img src={src} alt={alt} className={PRODUCT_IMAGE_FIT_CLASS} />
    </div>
  );
}

export function ProductAvailabilityText({
  availability,
}: {
  availability: PublicAvailability | null | undefined;
}) {
  if (!availability) return null;
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        availability === "in" && "text-good",
        availability === "low" && "text-warn",
        availability === "out" && "text-bad",
      )}
    >
      {PUBLIC_AVAILABILITY_LABEL[availability]}
    </p>
  );
}
