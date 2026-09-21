import { PUBLIC_AVAILABILITY_LABEL, type PublicAvailability } from "@/domain/availability";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { cn } from "@/lib/utils";

/**
 * Authorised staff only. Never use this on public/trade catalogue surfaces.
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
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2", className)}>
      {qty != null ? <span className="num font-semibold">{qty}</span> : <span className="text-steel">—</span>}
      {availability ? <AvailabilityBadge availability={availability} /> : null}
      {stale ? <span className="text-[10px] font-semibold uppercase tracking-wide text-warn">Stale</span> : null}
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
