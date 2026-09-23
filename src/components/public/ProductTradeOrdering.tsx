import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
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
import { BASKET_UPDATED_EVENT } from "@/lib/basket-events";

export type ProductOrderingPanelView = {
  orderable: boolean;
  reason: string | null;
  caseQty: number | null;
  caseTitle: string | null;
  caseSubtitle: string | null;
  minimumQuantity: number | null;
  quantity: number | null;
  caseCount: number | null;
  caseCountLabel: string | null;
  unitPriceExVatDisplay: string | null;
  lineNetDisplay: string | null;
  canIncrement: boolean;
  canDecrement: boolean;
  canAdd: boolean;
  insufficientFullCase: boolean;
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
  const cases =
    activeQty != null && panel?.caseQty
      ? formatCaseCountLabel(activeQty / panel.caseQty)
      : panel?.caseCountLabel;
  const title = panel?.caseTitle ?? copy?.title ?? "Trade ordering";
  const subtitle =
    panel?.caseSubtitle ??
    copy?.subtitle ??
    (tradeCustomer || orderingContext
      ? "This product is not configured for online case ordering"
      : null);

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

  return (
    <section
      data-product-section="ordering"
      data-ordering-placement="hero"
      data-ordering-actor={signedIn ? (tradeCustomer ? "trade" : "internal") : "anonymous"}
      className="mt-6 rounded-lg border border-border bg-surface/40 p-5"
    >
      <h2 className="font-display text-lg font-semibold uppercase tracking-tight">Trade ordering</h2>
      <p className="mt-3 font-display text-2xl font-semibold uppercase tracking-tight">{title}</p>
      {subtitle ? <p className="mt-1 text-[13px] text-steel">{subtitle}</p> : null}

      {showAnonSignIn ? (
        <p className="mt-4 text-[13px] text-steel" role="status">
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>{" "}
          with a trade account to order online.
        </p>
      ) : null}

      {showTestLevelPrompt ? (
        <p className="mt-4 text-[13px] text-steel" role="status" data-ordering-status="needs-test-level">
          Select a trade test level in{" "}
          <Link to="/admin/settings" className="font-semibold text-primary hover:underline">
            Admin → Settings
          </Link>{" "}
          to enable ordering.
        </p>
      ) : null}

      {signedIn && !copy && !panel?.caseQty && orderingContext ? (
        <p className="mt-4 text-[13px] text-steel" role="status">
          This product is not available for online ordering
        </p>
      ) : null}

      {showControls && panel?.insufficientFullCase ? (
        <p className="mt-4 text-[13px] font-medium text-warn" role="status">
          Insufficient stock for a full case
        </p>
      ) : null}

      {showControls && panel && !panel.insufficientFullCase && panel.orderable ? (
        <div className="mt-5 space-y-4">
          {panel.unitPriceExVatDisplay ? (
            <p className="num text-[14px] font-semibold">£{panel.unitPriceExVatDisplay} each ex VAT</p>
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">Quantity</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className="inline-grid size-11 place-items-center rounded-md border border-border disabled:opacity-40"
                aria-label="Decrease quantity"
                disabled={busy || !panel.canDecrement || activeQty == null}
                onClick={() => {
                  if (activeQty == null || panel.caseQty == null) return;
                  void applyQuantity(activeQty - panel.caseQty);
                }}
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span className="num min-w-12 text-center text-lg font-semibold" aria-live="polite">
                {activeQty}
              </span>
              <button
                type="button"
                className="inline-grid size-11 place-items-center rounded-md border border-border disabled:opacity-40"
                aria-label="Increase quantity"
                disabled={busy || !panel.canIncrement || activeQty == null}
                onClick={() => {
                  if (activeQty == null || panel.caseQty == null) return;
                  void applyQuantity(activeQty + panel.caseQty);
                }}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          {cases && activeQty != null ? (
            <p className="text-[13px] text-steel">
              {cases} · {activeQty} units
            </p>
          ) : null}
          {panel.lineNetDisplay ? (
            <p className="num text-xl font-semibold">£{panel.lineNetDisplay} ex VAT</p>
          ) : null}
          <button
            type="button"
            className={cn(
              "h-12 w-full rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground",
              (!panel.canAdd || busy) && "opacity-50",
            )}
            disabled={!panel.canAdd || busy}
            onClick={() => void onAdd()}
          >
            Add to basket
          </button>
          <p className="text-[12px] text-steel">
            <Link to={ROUTES.portalBasket} className="font-semibold text-primary hover:underline">
              View basket
            </Link>
          </p>
        </div>
      ) : null}

      {showAuthenticatedBlocked && !showTestLevelPrompt ? (
        <p className="mt-4 text-[13px] text-steel" role="status" data-ordering-status="blocked">
          {panel!.reason}
        </p>
      ) : null}
    </section>
  );
}
