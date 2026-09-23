import { useEffect, useState, type MouseEvent } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  addToBasketFn,
  previewProductOrderQuantityFn,
} from "@/server/phase2/fns";
import type { ProductOrderingPanel } from "@/server/basket/service";
import type { PublicAvailability } from "@/domain/availability";
import { BASKET_UPDATED_EVENT } from "@/lib/basket-events";
import { cn } from "@/lib/utils";

/**
 * Compact catalogue list-view quick order.
 * Uses the same Phase 6A preview/add mutations as the PDP — no second order path.
 */
export function CatalogueListQuickOrder({
  variantId,
  productName,
  availability,
  initialPanel,
}: {
  variantId: string;
  productName: string;
  availability: PublicAvailability | null;
  initialPanel: ProductOrderingPanel;
}) {
  const [panel, setPanel] = useState(initialPanel);
  const [quantity, setQuantity] = useState(initialPanel.quantity);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // Reset when search/filter/pagination replaces the row payload.
  useEffect(() => {
    setPanel(initialPanel);
    setQuantity(initialPanel.quantity);
    setJustAdded(false);
  }, [initialPanel, variantId]);

  useEffect(() => {
    if (!justAdded) return;
    const t = window.setTimeout(() => setJustAdded(false), 1600);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  const outOfStock = availability === "out";
  const noPrice =
    !panel.orderable &&
    !panel.insufficientFullCase &&
    (panel.reason === "Trade price unavailable" || /price unavailable/i.test(panel.reason ?? ""));
  const unavailable =
    outOfStock ||
    (!panel.orderable && !panel.insufficientFullCase && !panel.canAdd && panel.caseQty == null);

  if (outOfStock) {
    return (
      <div className="text-[11px] text-steel" data-catalogue-order="unavailable">
        Unavailable
      </div>
    );
  }

  if (panel.insufficientFullCase) {
    return (
      <div className="max-w-[11rem] text-[11px] leading-snug text-warn" data-catalogue-order="insufficient-case">
        Insufficient stock for full case
      </div>
    );
  }

  if (noPrice || (!panel.orderable && !panel.canAdd)) {
    return (
      <div className="max-w-[11rem] text-[11px] leading-snug text-steel" data-catalogue-order="blocked">
        {panel.reason === "Trade price unavailable"
          ? "Pricing unavailable"
          : panel.reason ?? "Unavailable"}
      </div>
    );
  }

  if (!panel.orderable || panel.caseQty == null || quantity == null) {
    return (
      <div className="text-[11px] text-steel" data-catalogue-order="unavailable">
        {unavailable ? "Unavailable" : (panel.reason ?? "Unavailable")}
      </div>
    );
  }

  const caseHint =
    panel.caseQty === 1 ? "Single unit" : panel.caseTitle ?? `Case of ${panel.caseQty}`;

  async function applyQuantity(next: number) {
    setBusy(true);
    const result = await previewProductOrderQuantityFn({
      data: { variantId, quantity: next },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPanel(result.data);
    if (result.data.quantity != null) setQuantity(result.data.quantity);
  }

  async function onAdd(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (quantity == null) return;
    setBusy(true);
    const result = await addToBasketFn({ data: { variantId, quantity } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BASKET_UPDATED_EVENT));
    }
    setJustAdded(true);
  }

  return (
    <div
      className="flex flex-col items-stretch gap-1"
      data-catalogue-order="controls"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-grid size-8 place-items-center rounded-md border border-border disabled:opacity-40"
            aria-label={`Decrease quantity for ${productName}`}
            disabled={busy || !panel.canDecrement}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (panel.caseQty == null || quantity == null) return;
              void applyQuantity(quantity - panel.caseQty);
            }}
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <span
            className="num min-w-8 text-center text-[13px] font-semibold tabular-nums"
            aria-live="polite"
          >
            {quantity}
          </span>
          <button
            type="button"
            className="inline-grid size-8 place-items-center rounded-md border border-border disabled:opacity-40"
            aria-label={`Increase quantity for ${productName}`}
            disabled={busy || !panel.canIncrement}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (panel.caseQty == null || quantity == null) return;
              void applyQuantity(quantity + panel.caseQty);
            }}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 min-w-[3.5rem] items-center justify-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground",
            (!panel.canAdd || busy) && !justAdded && "opacity-50",
            justAdded && "bg-good text-ink",
          )}
          disabled={!panel.canAdd || busy}
          data-catalogue-order-action={justAdded ? "added" : "add"}
          onClick={(e) => void onAdd(e)}
        >
          {justAdded ? (
            <>
              <Check className="size-3.5" aria-hidden />
              Added
            </>
          ) : (
            "Add"
          )}
        </button>
      </div>
      <p className="text-[10px] leading-tight text-steel">{caseHint}</p>
    </div>
  );
}
