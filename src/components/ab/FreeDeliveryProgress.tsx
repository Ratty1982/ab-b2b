import { Check, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

export type FreeDeliveryProgressProps = {
  freeDelivery: boolean;
  /** Goods subtotal ex VAT (2dp display string, no £). */
  goodsNetDisplay: string;
  /** Free-delivery threshold ex VAT from domain DTO (2dp). */
  thresholdExVatDisplay: string;
  /** Remaining goods net to unlock; null when free. */
  amountToFreeDeliveryDisplay: string | null;
  /** 0–100 from server/domain — display only, not the charge. */
  progressPercent: number;
  className?: string;
};

/**
 * Visual free-delivery progress for basket / checkout summaries.
 * Does not calculate or override the delivery charge.
 */
export function FreeDeliveryProgress({
  freeDelivery,
  goodsNetDisplay,
  thresholdExVatDisplay,
  amountToFreeDeliveryDisplay,
  progressPercent,
  className,
}: FreeDeliveryProgressProps) {
  const capped = Math.min(100, Math.max(0, progressPercent));
  const progressLabel = freeDelivery
    ? `Free delivery unlocked. Qualifying spend £${thresholdExVatDisplay}+`
    : `Free delivery progress: £${goodsNetDisplay} of £${thresholdExVatDisplay}`;

  return (
    <div
      className={cn(
        "mb-4 rounded-md border border-border/80 bg-background/40 px-3 py-3",
        className,
      )}
      data-free-delivery={freeDelivery ? "unlocked" : "locked"}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            freeDelivery ? "bg-primary/15 text-primary" : "bg-muted text-steel",
          )}
          aria-hidden
        >
          {freeDelivery ? <Check className="size-3.5" strokeWidth={2.5} /> : <Truck className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {freeDelivery ? "Free delivery unlocked" : "Free delivery"}
          </p>
          {freeDelivery ? (
            <p className="mt-1 text-[13px] leading-snug text-foreground">
              Your order qualifies for free delivery
            </p>
          ) : (
            <p className="mt-1 text-[13px] leading-snug text-foreground">
              Spend £{amountToFreeDeliveryDisplay ?? "0.00"} more to unlock{" "}
              <span className="font-semibold">FREE DELIVERY</span>
            </p>
          )}
        </div>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(capped)}
        aria-valuetext={progressLabel}
        aria-label={progressLabel}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${capped}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] text-steel">
        {freeDelivery
          ? `£${thresholdExVatDisplay}+ qualifying spend`
          : `£${goodsNetDisplay} of £${thresholdExVatDisplay}`}
      </p>
    </div>
  );
}
