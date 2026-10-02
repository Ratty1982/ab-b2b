import { PUBLIC_AVAILABILITY_LABEL, type PublicAvailability } from "@/domain/availability";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { cn } from "@/lib/utils";

/** Plain-English exact qty for authorised internal staff. */
export function formatInternalAvailableQty(qty: number): string {
  return `${qty} available`;
}

/**
 * Authorised staff only. Never use this for trade/anonymous catalogue surfaces
 * unless `internalStock` was already gated server-side (inventory.view).
 *
 * Presentation: [availability badge]  N available
 * — never a naked quantity beside the badge.
 */
export function InternalStockDisplay({
  qty,
  availability,
  stale,
  className,
}: {
  qty: number | null | undefined;
  availability: PublicAvailability | null | undefined;
  stale?: boolean;
  className?: string;
}) {
  const availableLabel = qty != null ? formatInternalAvailableQty(qty) : null;

  return (
    <div
      className={cn("flex flex-col items-start gap-1", className)}
      data-internal-stock-display="true"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {availability ? <AvailabilityBadge availability={availability} /> : null}
        {availableLabel != null ? (
          <span
            className="num text-[12px] font-medium tabular-nums text-steel"
            data-internal-stock-qty="true"
          >
            {availableLabel}
          </span>
        ) : !availability ? (
          <span className="text-[11px] text-steel">—</span>
        ) : null}
      </div>
      {stale && availableLabel != null ? (
        <span className="text-[11px] text-warn" data-internal-stock-stale="true">
          Stock update may be delayed
        </span>
      ) : null}
      {stale && availableLabel == null ? (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-warn">Stale</span>
      ) : null}
      {!availability && !stale && qty == null ? (
        <span className="text-[11px] text-steel">Not synced</span>
      ) : null}
    </div>
  );
}

export function internalAvailabilityLabel(availability: PublicAvailability | null | undefined, stale?: boolean) {
  if (availability) return PUBLIC_AVAILABILITY_LABEL[availability];
  if (stale) return "Stale";
  return "Unknown";
}
