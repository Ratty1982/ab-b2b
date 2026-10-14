import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { inputClass } from "@/components/ab/Drawer";
import type { OrderFulfilmentChoice, SalesOrderBackorderRow, SalesOrderDraftLineInput } from "@/domain/sales-order-entry";
import { parseStaffOrderUnitPrice } from "@/domain/sales-order-entry";
import { staffOrderAvailableLabel } from "@/domain/staff-order-stock";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Tailwind `lg` starts at 1024px. Narrower widths use stacked cards. */
export const SALES_ORDER_DESKTOP_MIN_WIDTH = 1024;
export const SALES_ORDER_CARD_LAYOUT_WIDTHS = [320, 375, 390, 768] as const;
export const SALES_ORDER_REVIEW_ID = "sales-order-review";
export const SALES_ORDER_MOBILE_FOOTER_ID = "sales-order-mobile-footer";

export function salesOrderUsesCardLayout(viewportWidth: number) {
  return viewportWidth < SALES_ORDER_DESKTOP_MIN_WIDTH;
}

/** 16px text stops iPhone from zooming focused fields. 44px is the touch target. */
export const salesOrderControlClass = cn(inputClass, "h-11 min-h-11 text-[16px]");

export const salesOrderPageFrameClass =
  "min-w-0 max-lg:overflow-x-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0";

export function formatSalesOrderMoney(value: string | null | undefined) {
  return value ? `£${value}` : "—";
}

export function isSalesOrderTypingField(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return target.type !== "checkbox" && target.type !== "radio" && target.type !== "button";
  }
  return false;
}

export function openSalesOrderReview(doc: Document = document) {
  const node = doc.getElementById(SALES_ORDER_REVIEW_ID);
  if (!(node instanceof HTMLElement)) return;
  node.scrollIntoView({ block: "start" });
  node.focus({ preventScroll: true });
}

/** Hides the mobile total bar while a text field is focused so it does not cover the keyboard. */
export function useSalesOrderKeyboard() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    function sync(target: EventTarget | null) {
      const active = target ?? document.activeElement;
      if (!isSalesOrderTypingField(active)) {
        setTyping(false);
        return;
      }
      setTyping(true);
      if (active instanceof HTMLElement && typeof active.scrollIntoView === "function") {
        active.scrollIntoView({ block: "center" });
      }
    }
    function onFocusIn(event: FocusEvent) {
      sync(event.target);
    }
    function onFocusOut() {
      window.setTimeout(() => sync(document.activeElement), 0);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return typing;
}

export function SalesOrderSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 rounded-lg border border-border"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[16px] font-semibold">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-right text-[13px]">
          {hint}
          <span className="shrink-0 font-semibold uppercase text-steel">{open ? "Hide" : "Show"}</span>
        </span>
      </summary>
      <div className="min-w-0 space-y-3 border-t border-border px-3 py-3">{children}</div>
    </details>
  );
}

export type SalesOrderCustomerCard = {
  id: string;
  name: string;
  tradingName: string | null;
  accountNumber: string | null;
  phone: string | null;
  primaryEmail: string | null;
  autopartCustomerCode: string | null;
  town: string | null;
  postcode: string | null;
  contactName: string | null;
  assignedSalesRep: { name: string; code: string } | null;
};

function customerLocation(customer: SalesOrderCustomerCard) {
  return [customer.town, customer.postcode].filter(Boolean).join(", ") || "—";
}

export function SalesOrderCustomerResults({
  customers,
  showEmpty,
}: {
  customers: SalesOrderCustomerCard[];
  showEmpty: boolean;
}) {
  return (
    <>
      <ul data-layout="mobile-cards" className="mt-4 grid min-w-0 gap-3 lg:hidden">
        {customers.map((customer) => (
          <li key={customer.id} data-testid="customer-result" className="min-w-0 rounded-lg border border-border p-3">
            <p className="break-words text-[16px] font-semibold">{customer.name}</p>
            {customer.tradingName && customer.tradingName !== customer.name ? (
              <p className="break-words text-[13px] text-steel">{customer.tradingName}</p>
            ) : null}
            <dl className="mt-2 grid gap-1 text-[14px]">
              <div className="flex min-w-0 justify-between gap-3">
                <dt className="text-steel">Account</dt>
                <dd className="min-w-0 break-all text-right font-mono">{customer.accountNumber ?? "—"}</dd>
              </div>
              <div className="flex min-w-0 justify-between gap-3">
                <dt className="text-steel">Representative</dt>
                <dd className="min-w-0 break-words text-right">
                  {customer.assignedSalesRep?.name ?? "Unassigned"}
                </dd>
              </div>
              <div className="flex min-w-0 justify-between gap-3">
                <dt className="text-steel">Contact</dt>
                <dd className="min-w-0 break-words text-right">{customer.contactName ?? "—"}</dd>
              </div>
              <div className="flex min-w-0 justify-between gap-3">
                <dt className="text-steel">Location</dt>
                <dd className="min-w-0 break-words text-right">{customerLocation(customer)}</dd>
              </div>
            </dl>
            {customer.phone || customer.primaryEmail ? (
              <p className="mt-1 break-all text-[13px] text-steel">{customer.phone ?? customer.primaryEmail}</p>
            ) : null}
            <Link
              to="/sales/orders/new"
              search={{ companyId: customer.id }}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
            >
              Start order
            </Link>
          </li>
        ))}
        {showEmpty ? <li className="px-1 py-6 text-[14px] text-steel">No active customers match that search.</li> : null}
      </ul>
      <div data-layout="desktop-table" className="mt-4 hidden min-w-0 overflow-x-auto rounded-lg border border-border lg:block">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-border bg-surface/60 text-[10px] uppercase tracking-[0.12em] text-steel">
            <tr>
              <th className="px-3 py-2 font-semibold">Customer</th>
              <th className="px-3 py-2 font-semibold">Account</th>
              <th className="px-3 py-2 font-semibold">Assigned representative</th>
              <th className="px-3 py-2 font-semibold">Location</th>
              <th className="px-3 py-2 font-semibold">Contact</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b border-border/60 last:border-0" data-testid="customer-result">
                <td className="px-3 py-3">
                  <p className="font-semibold">{customer.name}</p>
                  {customer.tradingName && customer.tradingName !== customer.name ? (
                    <p className="text-steel">{customer.tradingName}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <p className="font-mono">{customer.accountNumber ?? "—"}</p>
                  {customer.autopartCustomerCode ? (
                    <p className="text-[11px] text-steel">Autopart {customer.autopartCustomerCode}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  {customer.assignedSalesRep ? (
                    customer.assignedSalesRep.name
                  ) : (
                    <span className="text-steel">Unassigned</span>
                  )}
                </td>
                <td className="px-3 py-3 text-steel">{customerLocation(customer)}</td>
                <td className="px-3 py-3">
                  <p>{customer.contactName ?? "—"}</p>
                  <p className="text-[11px] text-steel">{customer.phone ?? customer.primaryEmail ?? ""}</p>
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    to="/sales/orders/new"
                    search={{ companyId: customer.id }}
                    className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 text-[12px] font-bold uppercase tracking-wide text-primary-foreground"
                  >
                    Start order
                  </Link>
                </td>
              </tr>
            ))}
            {showEmpty ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-steel">
                  No active customers match that search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

export type SalesOrderLinePricing = {
  variantId: string;
  promotionCode?: string | null;
  issue?: string;
  issueMessage?: string | null;
  caseQty?: number | null;
  availableQtyAtOrder?: number;
  backorderQtyAtOrder?: number;
  /** Trusted sellable stock. Not the quantity allocated to this line. */
  sellableQty?: number;
  stockConfirmed?: boolean;
  backordersAllowed?: boolean;
  lineNet?: string | null;
  resolvedUnitPrice?: string | null;
  customerUnitPrice?: string | null;
  priceSource?: string | null;
};

function linePricing(lines: SalesOrderLinePricing[], variantId: string) {
  return lines.find((line) => line.variantId === variantId);
}

function LineQuantity({
  line,
  caseQty,
  onQuantityChange,
  onQuantityBlur,
}: {
  line: SalesOrderDraftLineInput;
  caseQty: number | null | undefined;
  onQuantityChange: (variantId: string, raw: string) => void;
  onQuantityBlur: () => void;
}) {
  return (
    <label className="block text-[13px] text-steel">
      <span className="lg:sr-only">Quantity</span>
      <input
        className={cn(salesOrderControlClass, "mt-1 w-full", line.qty == null && "border-bad")}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        aria-label={`Quantity for ${line.sku}`}
        data-qty-variant={line.variantId}
        value={line.qty ?? ""}
        onChange={(event) => onQuantityChange(line.variantId, event.target.value)}
        onBlur={onQuantityBlur}
      />
      {line.qty == null ? <span className="mt-1 block font-semibold text-bad">Enter a quantity</span> : null}
      {caseQty ? <span className="mt-1 block text-[12px]">Case {caseQty}</span> : null}
    </label>
  );
}

function LinePrice({
  line,
  priced,
  draft,
  onPriceDraftChange,
  onPriceOverride,
  onClearPriceDraft,
}: {
  line: SalesOrderDraftLineInput;
  priced: SalesOrderLinePricing | undefined;
  draft: string | undefined;
  onPriceDraftChange: (variantId: string, raw: string) => void;
  onPriceOverride: (variantId: string, override: string | null) => void;
  onClearPriceDraft: (variantId: string) => void;
}) {
  return (
    <div>
      <label className="block text-[13px] text-steel">
        {line.unitPriceOverride ? "Manual price ex VAT" : "Unit price ex VAT"}
        <input
          className={cn(salesOrderControlClass, "mt-1 w-full")}
          inputMode="decimal"
          aria-label={`Unit price for ${line.sku}`}
          value={draft ?? line.unitPriceOverride ?? priced?.resolvedUnitPrice ?? priced?.customerUnitPrice ?? ""}
          onChange={(event) => onPriceDraftChange(line.variantId, event.target.value)}
          onBlur={() => {
            if (draft == null) return;
            const parsed = parseStaffOrderUnitPrice(draft);
            if (!parsed) {
              toast.error("Enter a unit price in pounds and pence, excluding VAT");
              onClearPriceDraft(line.variantId);
              return;
            }
            const resolved = priced?.resolvedUnitPrice ?? priced?.customerUnitPrice ?? null;
            const override = resolved != null && parsed === resolved ? null : parsed;
            onClearPriceDraft(line.variantId);
            onPriceOverride(line.variantId, override);
          }}
        />
      </label>
      {line.unitPriceOverride ? (
        <div className="mt-1">
          <p className="text-[12px] text-steel">Manual price applied</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-[13px] font-semibold text-foreground underline"
            onClick={() => {
              onClearPriceDraft(line.variantId);
              onPriceOverride(line.variantId, null);
            }}
          >
            Reset to customer price
            {priced?.resolvedUnitPrice ? ` ${formatSalesOrderMoney(priced.resolvedUnitPrice)}` : ""}
          </button>
        </div>
      ) : priced?.priceSource ? (
        <p className="text-[12px] text-steel">{priced.priceSource}</p>
      ) : null}
    </div>
  );
}

function LineStock({
  priced,
  qty,
}: {
  priced: SalesOrderLinePricing | undefined;
  qty: number | null;
}) {
  if (qty == null) return <p className="text-[13px] font-semibold text-bad">Enter a quantity</p>;
  if (!priced) return <p className="text-[13px] text-steel">Stock —</p>;
  const allocated = priced.availableQtyAtOrder ?? 0;
  const backorder = priced.backorderQtyAtOrder ?? 0;
  const availableLabel = staffOrderAvailableLabel({
    sellableQty: priced.sellableQty ?? 0,
    stockConfirmed: priced.stockConfirmed === true,
  });
  return (
    <div className="space-y-1">
      {backorder > 0 ? (
        <>
          <p className="inline-flex rounded-sm border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-[11px] font-bold tracking-wide text-amber-200">
            BACKORDER
          </p>
          <p className="text-[13px] font-semibold text-amber-200">
            {allocated > 0 ? "Part backorder" : "Fully backordered"}
          </p>
        </>
      ) : null}
      <p className="text-[13px] text-steel">{availableLabel}</p>
      <p className="text-[13px] text-steel">Ordered {qty}</p>
      <p className="text-[13px] text-steel">Allocated to order: {allocated}</p>
      {backorder > 0 ? <p className="text-[13px] text-steel">Backordered {backorder}</p> : null}
    </div>
  );
}

export function SalesOrderLines({
  lines,
  reviewLines,
  priceDrafts,
  onQuantityChange,
  onQuantityBlur,
  onPriceDraftChange,
  onPriceOverride,
  onClearPriceDraft,
  onRemove,
}: {
  lines: SalesOrderDraftLineInput[];
  reviewLines: SalesOrderLinePricing[];
  priceDrafts: Record<string, string>;
  onQuantityChange: (variantId: string, raw: string) => void;
  onQuantityBlur: () => void;
  onPriceDraftChange: (variantId: string, raw: string) => void;
  onPriceOverride: (variantId: string, override: string | null) => void;
  onClearPriceDraft: (variantId: string) => void;
  onRemove: (variantId: string) => void;
}) {
  return (
    <>
      <ul data-layout="mobile-cards" className="grid min-w-0 gap-3 lg:hidden">
        {lines.length === 0 ? <li className="text-[14px] text-steel">No products on this order yet.</li> : null}
        {lines.map((line) => {
          const priced = linePricing(reviewLines, line.variantId);
          return (
            <li key={line.variantId} data-testid="order-line-card" className="min-w-0 rounded-lg border border-border p-3">
              <p className="break-all font-medium">{line.sku}</p>
              <p className="break-words text-steel">{line.name}</p>
              {priced?.promotionCode ? <p className="text-[13px] text-steel">Promo {priced.promotionCode}</p> : null}
              {priced?.issue && priced.issue !== "VALID" && priced.issueMessage ? (
                <p className="text-bad">{priced.issueMessage}</p>
              ) : null}
              <div className="mt-3 grid gap-3">
                <LineQuantity
                  line={line}
                  caseQty={priced?.caseQty}
                  onQuantityChange={onQuantityChange}
                  onQuantityBlur={onQuantityBlur}
                />
                <LinePrice
                  line={line}
                  priced={priced}
                  draft={priceDrafts[line.variantId]}
                  onPriceDraftChange={onPriceDraftChange}
                  onPriceOverride={onPriceOverride}
                  onClearPriceDraft={onClearPriceDraft}
                />
                <LineStock priced={priced} qty={line.qty} />
                <p className="text-[15px] font-semibold">Line total {formatSalesOrderMoney(priced?.lineNet)}</p>
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border text-[13px] font-semibold"
                  onClick={() => onRemove(line.variantId)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div data-layout="desktop-table" className="hidden min-w-0 overflow-x-auto rounded-lg border border-border lg:block">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2 text-right">Line</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const priced = linePricing(reviewLines, line.variantId);
              return (
                <tr key={line.variantId} className="border-b border-border/60">
                  <td className="px-3 py-2">
                    <p className="font-medium">{line.sku}</p>
                    <p className="text-steel">{line.name}</p>
                    {priced?.promotionCode ? <p className="text-steel">Promo {priced.promotionCode}</p> : null}
                    {priced?.issue && priced.issue !== "VALID" && priced.issueMessage ? (
                      <p className="text-bad">{priced.issueMessage}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <LineQuantity
                      line={line}
                      caseQty={priced?.caseQty}
                      onQuantityChange={onQuantityChange}
                      onQuantityBlur={onQuantityBlur}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <LinePrice
                      line={line}
                      priced={priced}
                      draft={priceDrafts[line.variantId]}
                      onPriceDraftChange={onPriceDraftChange}
                      onPriceOverride={onPriceOverride}
                      onClearPriceDraft={onClearPriceDraft}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <LineStock priced={priced} qty={line.qty} />
                  </td>
                  <td className="num px-3 py-2 text-right">{formatSalesOrderMoney(priced?.lineNet)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center text-[13px] font-semibold text-steel"
                      onClick={() => onRemove(line.variantId)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export type SalesOrderPriceChangeView = {
  variantId: string;
  sku: string;
  previousUnitPrice: string | null;
  newUnitPrice: string | null;
  previousLineNet: string | null;
  newLineNet: string | null;
};

export function SalesOrderPriceChangeList({
  changes,
  totalsChanged,
  previousGrandTotal,
  grandTotal,
}: {
  changes: SalesOrderPriceChangeView[];
  totalsChanged: boolean;
  previousGrandTotal: string | null;
  grandTotal: string | null | undefined;
}) {
  return (
    <>
      <p className="font-semibold text-bad">Review these changes before placing the order.</p>
      {changes.map((change) => (
        <p key={change.variantId}>
          {change.sku}: {formatSalesOrderMoney(change.previousUnitPrice)} becomes{" "}
          {formatSalesOrderMoney(change.newUnitPrice)}
          {change.previousLineNet !== change.newLineNet
            ? ` (line ${formatSalesOrderMoney(change.previousLineNet)} becomes ${formatSalesOrderMoney(change.newLineNet)})`
            : ""}
        </p>
      ))}
      {totalsChanged && previousGrandTotal ? (
        <p>
          Order total {formatSalesOrderMoney(previousGrandTotal)} becomes {formatSalesOrderMoney(grandTotal)}. This
          includes VAT and delivery.
        </p>
      ) : null}
    </>
  );
}

export function SalesOrderPriceAlert({
  changes,
  totalsChanged,
  previousGrandTotal,
  grandTotal,
  onReview,
}: {
  changes: SalesOrderPriceChangeView[];
  totalsChanged: boolean;
  previousGrandTotal: string | null;
  grandTotal: string | null | undefined;
  onReview: () => void;
}) {
  if (changes.length === 0 && !totalsChanged) return null;
  return (
    <div role="alert" className="min-w-0 space-y-2 rounded-md border border-bad/40 bg-bad/5 p-3 text-[14px]">
      <SalesOrderPriceChangeList
        changes={changes}
        totalsChanged={totalsChanged}
        previousGrandTotal={previousGrandTotal}
        grandTotal={grandTotal}
      />
      <button type="button" onClick={onReview} className="inline-flex min-h-11 items-center font-semibold text-primary">
        Review order
      </button>
    </div>
  );
}

export function SalesOrderMobileFooter({
  total,
  priceWarning,
  hidden,
  onReview,
}: {
  total: string | null | undefined;
  priceWarning: boolean;
  hidden: boolean;
  onReview: () => void;
}) {
  return (
    <div
      id={SALES_ORDER_MOBILE_FOOTER_ID}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-ink px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden",
        hidden && "hidden",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">Order total</p>
          <p className="text-[16px] font-semibold">{formatSalesOrderMoney(total)}</p>
          {priceWarning ? <p className="text-[12px] font-semibold text-bad">Prices changed</p> : null}
        </div>
        <button
          type="button"
          onClick={onReview}
          className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-md bg-primary px-3 text-[13px] font-bold uppercase text-primary-foreground"
        >
          Review order
        </button>
      </div>
    </div>
  );
}

export function SalesOrderReviewPanel({
  companyName,
  paymentTerms,
  poNumber,
  subtotal,
  deliveryTotal,
  vatTotal,
  grandTotal,
  blocking,
  changes,
  totalsChanged,
  previousGrandTotal,
  acceptedPrices,
  authorised,
  placing,
  placeDisabled,
  placeLabel,
  placingLabel,
  fulfilmentChoice,
  backorders,
  backorderAcknowledged,
  onAcceptPrices,
  onAuthorised,
  onBackorderAcknowledged,
  onPlace,
}: {
  companyName: string | undefined;
  paymentTerms: string | null | undefined;
  poNumber: string;
  subtotal: string | null | undefined;
  deliveryTotal: string | null | undefined;
  vatTotal: string | null | undefined;
  grandTotal: string | null | undefined;
  blocking: boolean;
  changes: SalesOrderPriceChangeView[];
  totalsChanged: boolean;
  previousGrandTotal: string | null;
  acceptedPrices: boolean;
  authorised: boolean;
  placing: boolean;
  placeDisabled: boolean;
  placeLabel: string;
  placingLabel?: string;
  fulfilmentChoice: OrderFulfilmentChoice;
  backorders: SalesOrderBackorderRow[];
  backorderAcknowledged: boolean;
  onAcceptPrices: (checked: boolean) => void;
  onAuthorised: (checked: boolean) => void;
  onBackorderAcknowledged: (checked: boolean) => void;
  onPlace: () => void;
}) {
  return (
    <aside
      id={SALES_ORDER_REVIEW_ID}
      tabIndex={-1}
      className="h-fit min-w-0 scroll-mt-4 space-y-3 rounded-lg border border-border p-4 text-[14px] outline-none"
    >
      <h2 className="font-display text-[16px] uppercase">Order review</h2>
      <p className="break-words">{companyName}</p>
      <p className="text-steel">Payment terms: {paymentTerms || "As agreed"}</p>
      <p className="break-words text-steel">PO: {poNumber || "—"}</p>
      <p>Net {formatSalesOrderMoney(subtotal)}</p>
      {fulfilmentChoice === "COLLECTION" ? (
        <p className="font-semibold">Customer Collection · £0.00</p>
      ) : (
        <p>Delivery {formatSalesOrderMoney(deliveryTotal)}</p>
      )}
      <p>VAT {formatSalesOrderMoney(vatTotal)}</p>
      <p className="text-[16px] font-semibold">Total {formatSalesOrderMoney(grandTotal)}</p>
      {blocking ? <p className="text-bad">Resolve the line issues shown before placing the order.</p> : null}
      {changes.length > 0 || totalsChanged ? (
        <div className="space-y-2 rounded-md border border-bad/40 bg-bad/5 p-3">
          <SalesOrderPriceChangeList
            changes={changes}
            totalsChanged={totalsChanged}
            previousGrandTotal={previousGrandTotal}
            grandTotal={grandTotal}
          />
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={acceptedPrices}
              onChange={(event) => onAcceptPrices(event.target.checked)}
              className="size-5"
            />
            <span>I have reviewed the updated prices and totals.</span>
          </label>
        </div>
      ) : (
        <p className="text-steel">Place order uses the prices shown here. A later price change stops the order for review.</p>
      )}
      {backorders.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-400/50 bg-amber-400/10 p-3">
          <p className="font-semibold text-amber-200">Backorder</p>
          {backorders.map((line) => (
            <p key={line.variantId}>
              {line.sku} · {line.extent === "FULL" ? "Fully backordered" : "Part backorder"} ·{" "}
              {line.stockConfirmed && line.sellableQty != null
                ? `${line.sellableQty} available`
                : "Stock not confirmed"}
              {" · "}ordered {line.orderedQty}, allocated {line.availableQty}, backordered {line.backorderQty}
            </p>
          ))}
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={backorderAcknowledged}
              onChange={(event) => onBackorderAcknowledged(event.target.checked)}
              className="mt-1 size-5"
            />
            <span>The customer has been informed of this backorder.</span>
          </label>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={authorised}
          onChange={(event) => onAuthorised(event.target.checked)}
          className="size-5"
        />
        <span>I am authorised to submit this order on the customer’s behalf.</span>
      </label>
      <button
        type="button"
        disabled={placeDisabled}
        onClick={onPlace}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
      >
        {placing ? (placingLabel ?? "Placing…") : placeLabel}
      </button>
    </aside>
  );
}
