import { PUBLIC_AVAILABILITY_LABEL, type PublicAvailability } from "@/domain/availability";
import { cn } from "@/lib/utils";

export const PRODUCT_IMAGE_LOGO_SRC = "/brand/ab-logo.jpg";
export const PRODUCT_IMAGE_PLACEHOLDER_LABEL = "Image coming soon";
export const PRODUCT_IMAGE_STAGE_CLASS =
  "relative flex items-center justify-center overflow-hidden bg-surface p-3";
export const PRODUCT_IMAGE_FIT_CLASS =
  "max-h-[85%] max-w-[85%] object-contain object-center transition-transform duration-200 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]";

export function ProductImage({
  src,
  alt,
  layout = "card",
}: {
  src?: string | null;
  alt: string;
  layout?: "card" | "list" | "detail";
}) {
  const stage = cn(
    PRODUCT_IMAGE_STAGE_CLASS,
    layout === "list" && "aspect-square w-24 shrink-0 rounded-md p-1.5",
    layout === "card" && "aspect-[5/4] w-full rounded-md",
    layout === "detail" && "aspect-[5/4] w-full rounded-lg",
  );
  if (!src) {
    return (
      <div className={stage} aria-hidden="true">
        <div className="flex flex-col items-center gap-2 px-3 text-center">
          <img
            src={PRODUCT_IMAGE_LOGO_SRC}
            alt=""
            width={32}
            height={32}
            className="size-8 rounded-sm object-contain opacity-40"
          />
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-steel/70">
            {PRODUCT_IMAGE_PLACEHOLDER_LABEL}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={stage}>
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
