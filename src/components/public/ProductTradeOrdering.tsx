import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  addToBasketFn,
  getProductOrderingPanelFn,
  previewProductOrderQuantityFn,
} from "@/server/phase2/fns";
import { useSession } from "@/lib/session";
import {
  hasOrderingCompanyContext,
  isTradeCustomerSession,
} from "@/lib/session-guards";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { publicTradeOrderingCopy } from "@/domain/case-ordering";
import { formatCaseCountLabel } from "@/domain/ordering";
import { formatCustomerSellUnitPrice } from "@/domain/money";
import { BASKET_UPDATED_EVENT } from "@/lib/basket-events";

export type ProductOrderingPanelView = {
  orderable: boolean;
  reason: string | null;
  caseQty: number | null;
  caseTitle: string | null;
  caseSubtitle: string | null;
  minimumQuantity: number | null;
  quantityStep: number | null;
  quantity: number | null;
  caseCount: number | null;
  caseCountLabel: string | null;
  unitPriceExVat?: string | null;
  unitPriceExVatDisplay: string | null;
  lineNetDisplay: string | null;
  canIncrement: boolean;
  canDecrement: boolean;
  canAdd: boolean;
  insufficientFullCase: boolean;
  isFinalPartCase: boolean;
  remainingQty: number | null;
};

export function ProductTradeOrdering({
  caseQty,
  variantId,
  productName,
  initialPanel,
}: {
  caseQty: number | null | undefined;
  variantId?: string | null;
  productName?: string;
  /** SSR panel from the product loader when the actor is already known. */
  initialPanel?: ProductOrderingPanelView | null;
}) {
  const session = useSession();
  const signedIn = session.signedIn;
  const tradeCustomer = isTradeCustomerSession(session);
  const orderingContext = hasOrderingCompanyContext(session);
  const copy = publicTradeOrderingCopy(caseQty);

  // Anonymous visitors with no case configuration: hide the block entirely.
  // Signed-in actors always see the block (even without caseQty) so we never
  // imply they are anonymous.
  if (!signedIn && !copy) return null;

  return (
    <ProductTradeOrderingCard
      copy={copy}
      signedIn={signedIn}
      tradeCustomer={tradeCustomer}
      orderingContext={orderingContext}
      {...(variantId != null ? { variantId } : {})}
      {...(productName != null ? { productName } : {})}
      {...(initialPanel != null ? { initialPanel } : {})}
    />
  );
}

function ProductTradeOrderingCard({
  copy,
  signedIn,
  tradeCustomer,
  orderingContext,
  variantId,
  productName,
  initialPanel,
}: {
  copy: { title: string; subtitle: string } | null;
  signedIn: boolean;
  tradeCustomer: boolean;
  orderingContext: boolean;
  variantId?: string | null;
  productName?: string;
  initialPanel?: ProductOrderingPanelView | null;
}) {
  const session = useSession();
  const actorId = signedIn && session.signedIn ? session.user.id : null;
  // Load panel for any signed-in actor — server decides company context.
  const mayOrder = Boolean(signedIn && actorId);
  const [panel, setPanel] = useState<ProductOrderingPanelView | null>(
    mayOrder ? (initialPanel ?? null) : null,
  );
  const [quantity, setQuantity] = useState<number | null>(
    mayOrder ? (initialPanel?.quantity ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!variantId || !mayOrder) {
      setPanel(null);
      setQuantity(null);
      return;
    }
    if (initialPanel) {
      setPanel(initialPanel);
      setQuantity(initialPanel.quantity);
      return;
    }
    let cancelled = false;
    void getProductOrderingPanelFn({ data: { variantId } }).then((result) => {
      if (cancelled || !result.ok) return;
      setPanel(result.data);
      setQuantity(result.data.quantity);
    });
    return () => {
      cancelled = true;
    };
  }, [variantId, actorId, mayOrder, initialPanel]);

  useEffect(() => {
    if (!justAdded) return;
    const t = window.setTimeout(() => setJustAdded(false), 1800);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  const interactive = Boolean(variantId && mayOrder && panel);

  async function applyQuantity(next: number) {
    if (!variantId || !panel) return;
    setBusy(true);
    const result = await previewProductOrderQuantityFn({ data: { variantId, quantity: next } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPanel(result.data);
    if (result.data.quantity != null) setQuantity(result.data.quantity);
  }

  async function onAdd() {
    if (!variantId || quantity == null) return;
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
    toast.success(`Added to basket · ${quantity} × ${productName ?? "product"}`, {
      action: {
        label: "View basket",
        onClick: () => {
          window.location.href = ROUTES.portalBasket;
        },
      },
    });
  }

  const showControls = interactive && panel && (panel.orderable || panel.insufficientFullCase);
  const activeQty = quantity ?? panel?.quantity ?? panel?.minimumQuantity;
  const step = panel?.quantityStep ?? panel?.caseQty;
  const cases =
    activeQty != null && panel?.caseQty && panel.orderable && !panel.isFinalPartCase
      ? formatCaseCountLabel(activeQty / panel.caseQty)
      : panel?.caseCountLabel;
  const title = panel?.caseTitle ?? copy?.title ?? "Trade ordering";
  const subtitle =
    panel?.caseSubtitle ??
    copy?.subtitle ??
    (tradeCustomer || orderingContext
      ? "This product is not configured for online case ordering"
      : null);
  const caseLine =
    copy || panel?.caseTitle
      ? subtitle
        ? `${title} · ${subtitle}`
        : title
      : null;

  const unitLabel =
    panel?.unitPriceExVatDisplay ?? formatCustomerSellUnitPrice(panel?.unitPriceExVat);

  const showAnonSignIn = !signedIn;
  const showAuthenticatedBlocked =
    signedIn &&
    panel &&
    !panel.orderable &&
    !panel.insufficientFullCase &&
    panel.reason;
  const showAwaitingContext =
    signedIn &&
    !orderingContext &&
    !panel &&
    !showAnonSignIn;

  const blockedReason = panel?.reason ?? null;
  const showTestLevelPrompt =
    signedIn &&
    !orderingContext &&
    (showAwaitingContext ||
      (blockedReason != null && /trade test level/i.test(blockedReason)));

  const orderSummary =
    panel?.isFinalPartCase && activeQty != null
      ? activeQty === 1
        ? "1 unit"
        : `${activeQty} units`
      : cases && activeQty != null
        ? panel?.caseQty === 1
          ? `${activeQty === 1 ? "1 unit" : `${activeQty} units`}`
          : `${cases} · ${activeQty} units`
        : null;

  const finalStock =
    showControls && panel?.orderable && panel.isFinalPartCase && panel.remainingQty != null;

  return (
    <section
      data-product-section="ordering"
      data-ordering-placement="hero"
      data-ordering-actor={signedIn ? (tradeCustomer ? "trade" : "internal") : "anonymous"}
      data-ordering-mode={
        panel?.isFinalPartCase ? "final-part-case" : panel?.orderable ? "case" : undefined
      }
      className="mt-5 rounded-lg border border-border bg-surface/40 px-4 py-3.5 sm:px-5 sm:py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-sm font-semibold uppercase tracking-tight sm:text-[15px]">
          Trade ordering
        </h2>
        {unitLabel && showControls && panel && !panel.insufficientFullCase && panel.orderable ? (
          <p className="num text-[13px] font-semibold uppercase tracking-wide text-steel sm:text-[14px]">
            £{unitLabel} each ex VAT
          </p>
        ) : null}
      </div>

      {caseLine && (showControls || showAnonSignIn || showTestLevelPrompt || orderingContext) ? (
        <p className="mt-1.5 text-[13px] text-steel">{caseLine}</p>
      ) : null}

      {showAnonSignIn ? (
        <p className="mt-3 text-[13px] text-steel" role="status">
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>{" "}
          with a trade account to order online.
        </p>
      ) : null}

      {showTestLevelPrompt ? (
        <p className="mt-3 text-[13px] text-steel" role="status" data-ordering-status="needs-test-level">
          Select a trade test level in{" "}
          <Link to="/admin/settings" className="font-semibold text-primary hover:underline">
            Admin → Settings
          </Link>{" "}
          to enable ordering.
        </p>
      ) : null}

      {signedIn && !copy && !panel?.caseQty && orderingContext ? (
        <p className="mt-3 text-[13px] text-steel" role="status">
          This product is not available for online ordering
        </p>
      ) : null}

      {showControls && panel?.insufficientFullCase ? (
        <p className="mt-3 text-[13px] font-medium text-warn" role="status">
          Insufficient stock for a full case
        </p>
      ) : null}

      {finalStock ? (
        <div
          className="mt-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2"
          role="status"
          data-ordering-final-stock="true"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200">
            Final stock
          </p>
          <p className="mt-0.5 text-[13px] font-medium text-amber-900 dark:text-amber-100">
            Only {panel!.remainingQty} remaining
          </p>
          <p className="mt-1 text-[12px] text-amber-900/80 dark:text-amber-100/80">
            Final stock can be ordered as individual units.
          </p>
        </div>
      ) : null}

      {showControls && panel && !panel.insufficientFullCase && panel.orderable ? (
        <div className="mt-3 space-y-3">
          {/* Desktop: quantity / order / total in one row; mobile stacks */}
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end sm:gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Quantity</p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  className="inline-grid size-10 place-items-center rounded-md border border-border disabled:opacity-40 sm:size-9"
                  aria-label="Decrease quantity"
                  disabled={busy || !panel.canDecrement || activeQty == null || step == null}
                  onClick={() => {
                    if (activeQty == null || step == null) return;
                    void applyQuantity(activeQty - step);
                  }}
                >
                  <Minus className="size-4" aria-hidden />
                </button>
                <span className="num min-w-10 text-center text-base font-semibold tabular-nums" aria-live="polite">
                  {activeQty}
                </span>
                <button
                  type="button"
                  className="inline-grid size-10 place-items-center rounded-md border border-border disabled:opacity-40 sm:size-9"
                  aria-label="Increase quantity"
                  disabled={busy || !panel.canIncrement || activeQty == null || step == null}
                  onClick={() => {
                    if (activeQty == null || step == null) return;
                    void applyQuantity(activeQty + step);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="sm:pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Order</p>
              {orderSummary ? (
                <p className="mt-1.5 text-[13px] text-steel" aria-live="polite">
                  {orderSummary}
                </p>
              ) : null}
            </div>

            <div className="sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Total</p>
              {panel.lineNetDisplay ? (
                <p className="num mt-1 text-lg font-semibold leading-tight sm:text-xl">
                  £{panel.lineNetDisplay}{" "}
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                    ex VAT
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground sm:h-10",
              (!panel.canAdd || busy) && !justAdded && "opacity-50",
              justAdded && "bg-good text-ink",
            )}
            disabled={!panel.canAdd || busy}
            onClick={() => void onAdd()}
            data-ordering-action={justAdded ? "added" : "add"}
          >
            {justAdded ? (
              <>
                <Check className="size-4" aria-hidden />
                Added to basket
              </>
            ) : (
              "Add to basket"
            )}
          </button>
        </div>
      ) : null}

      {showAuthenticatedBlocked && !showTestLevelPrompt ? (
        <p className="mt-3 text-[13px] text-steel" role="status" data-ordering-status="blocked">
          {panel!.reason}
        </p>
      ) : null}
    </section>
  );
}
