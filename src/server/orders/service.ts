/**
 * Phase 6B B2B checkout — authoritative order creation.
 *
 * Constraints:
 * - Never trust browser companyId.
 * - TRADE + ACTIVE company only for placeOrder (admin test baskets cannot place real orders).
 * - Status SUBMITTED = received / pending Autopart — not despatched.
 * - ZERO Autopart order side effects: no Autopart API calls, no externalRef,
 *   and no Autopart qtyOnHand mutation. AB qtyReserved is updated on place
 *   (OrderStockReservation) — not an Autopart ERP reservation.
 */

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import {
  AuthError,
  requireAuthenticatedUser,
  requireCompanyPermission,
  requireSystemPermission,
} from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { recordAuditEvent } from "@/server/audit/record";
import { getBasket } from "@/server/basket/service";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { loadStockByVariantIds } from "@/server/stock/service";
import { getGlobalBackorderPolicy } from "@/server/ordering/settings";
import { trustedSellableForOrdering } from "@/server/ordering/policy";
import {
  allocateOrderLineQuantities,
  isEffectiveBackorderAllowed,
  resolveBackorderPolicy,
  orderContainsBackorder,
  orderIsFullyBackordered,
  presentOrderItemBackorder,
  BACKORDER_CHECKOUT_BODY,
  BACKORDER_CHECKOUT_HEADING,
  BACKORDER_CUSTOMER_NOTICE,
  type EffectiveBackorderPolicy,
} from "@/domain/backorder";
import { publicAvailabilityForOrderLine } from "@/domain/availability";
import {
  addMoney,
  applyVatInc,
  customerLineNetExVat,
  moneyToString,
  moneyZero,
  parseMoney,
  roundGbpDisplay,
  toCustomerSellUnitPrice,
} from "@/domain/money";
import {
  calculateTradeOrderTotals,
  tradeDeliveryTotalsDto,
} from "@/domain/trade-delivery";
import {
  assessBasketLineQuantity,
  isOrderableByStockPolicy,
  resolveCustomerOrdering,
  type BasketLineIssue,
} from "@/domain/ordering";
import {
  contactSnapshotSchema,
  deliveryAddressSnapshotSchema,
  placeOrderInputSchema,
  previewCheckoutDraftSchema,
  type CheckoutLineIssue,
  type ContactSnapshot,
  type DeliveryAddressSnapshot,
  type PlaceOrderInput,
  type PreviewCheckoutDraft,
} from "@/domain/checkout";
import { allocateOrderNumber } from "@/server/orders/order-number";
import { releaseStockForOrder, reserveStockForOrder } from "@/server/orders/reservations";
import { recordFulfilmentEvent } from "@/server/orders/fulfilment";
import {
  presentCustomerLineFulfilment,
  summariseCustomerOrderFulfilment,
  backorderUnitsLabel,
} from "@/domain/customer-fulfilment";
import { sendOrderEmailsAfterCommit } from "@/server/email/transactional";

export type CheckoutAddressSummary = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  town: string;
  county: string | null;
  postcode: string;
  country: string;
  isDefaultDelivery: boolean;
  contactName: string | null;
  contactPhone: string | null;
};

export type CheckoutContext = {
  companyId: string;
  companyName: string;
  paymentTerms: string | null;
  /** True when a verified Autopart customer code exists (code itself withheld from customers). */
  hasVerifiedAutopartCode: boolean;
  defaultAddressId: string | null;
  addresses: CheckoutAddressSummary[];
  contact: ContactSnapshot;
  basket: Awaited<ReturnType<typeof getBasket>>;
  canPlaceOrder: boolean;
};

export type CheckoutReviewLine = {
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  caseQty: number | null;
  orderingMode: "CASE" | "FINAL_PART_CASE" | null;
  customerUnitPrice: string | null;
  customerUnitPriceDisplay: string | null;
  lineNet: string | null;
  lineVat: string | null;
  lineGross: string | null;
  issue: CheckoutLineIssue;
  issueMessage: string | null;
  priceSource: string | null;
  availableQtyAtOrder: number;
  backorderQtyAtOrder: number;
  backordersAllowed: boolean;
};

export type CheckoutReview = {
  companyId: string;
  companyName: string;
  lines: CheckoutReviewLine[];
  hasBackorderItems: boolean;
  backorderNotice: { heading: string; body: string } | null;
  totals: {
    subtotal: string;
    vatTotal: string;
    deliveryTotal: string;
    grandTotal: string;
    currency: "GBP";
    freeDelivery: boolean;
    amountToFreeDelivery: string | null;
    thresholdExVat: string;
    progressPercent: number;
    deliveryLabel: string;
  };
  hasBlockingIssues: boolean;
  deliveryAddress: DeliveryAddressSnapshot | null;
  contact: ContactSnapshot;
  paymentTerms: string | null;
  poNumber: string | null;
  deliveryInstructions: string | null;
};

export type PublicOrderConfirmation = {
  id: string;
  orderNumber: string;
  status: "SUBMITTED";
  companyId: string;
  companyName: string;
  placedAt: string;
  poNumber: string | null;
  subtotal: string;
  vatTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  currency: string;
  deliveryAddress: DeliveryAddressSnapshot | null;
  contact: ContactSnapshot | null;
  paymentTerms: string | null;
  deliveryInstructions: string | null;
  lineCount: number;
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    customerUnitPrice: string;
    lineTotal: string;
    orderingMode: string | null;
  }>;
  /** Always null in Phase 6B — reserved for Autopart handoff. */
  externalRef: null;
  /** Present when created from an accepted quotation. */
  sourceQuoteId: string | null;
  sourceQuoteNumber: string | null;
};

export type PlaceOrderResult =
  | { ok: true; order: PublicOrderConfirmation }
  | { ok: false; code: "REVIEW_REQUIRED"; lines: CheckoutReviewLine[]; review: CheckoutReview };

export type OrderListItemBase = {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: string | null;
  poNumber: string | null;
  grandTotal: string;
  currency: string;
  lineCount: number;
};

export type PortalOrderListItem = OrderListItemBase & {
  hasBackorderItems: boolean;
  hasOutstandingBackorder: boolean;
  outstandingBackorderUnits: number;
  fullyBackordered: boolean;
  statusLabel: string;
  statusBadge:
    | "BACKORDERED"
    | "PART_BACKORDERED"
    | "PART_DESPATCHED"
    | "DESPATCHED"
    | "PROCESSING"
    | "RECEIVED"
    | "OTHER";
  backorderHint: string | null;
};

export type PortalOrderDetail = Omit<PublicOrderConfirmation, "status" | "items"> & {
  status: string;
  hasBackorderItems: boolean;
  hasOutstandingBackorder: boolean;
  outstandingBackorderUnits: number;
  statusLabel: string;
  statusBadge: PortalOrderListItem["statusBadge"];
  lineQuantitiesLimitation: string | null;
  items: Array<{
    id: string;
    sku: string;
    name: string;
    qty: number;
    customerUnitPrice: string;
    lineTotal: string;
    lineVat: string;
    lineGross: string;
    orderingMode: string | null;
    caseQty: number | null;
    availableQtyAtOrder: number | null;
    backorderQtyAtOrder: number;
    despatchedQty: number;
    fulfilment: {
      orderedQty: number;
      allocatedAtOrder: number | null;
      backorderedAtOrder: number;
      despatchedQty: number | null;
      outstandingBackorderQty: number | null;
      lineStatusLabel: string;
      despatchQuantitiesKnown: boolean;
      limitation: string | null;
    };
  }>;
  fulfilmentTimeline: Array<{
    id: string;
    kind: string;
    occurredAt: string;
    summary: string;
    lineQuantitiesKnown: boolean;
    limitation: string | null;
  }>;
};

export type AdminOrderListItem = OrderListItemBase & {
  companyName: string;
  salesRepName: string | null;
  autopartAccountLinked: boolean;
  autopartExportStatus: "NOT_EXPORTED" | "EXPORTED";
  autopartCustomerCodeSnapshot: string | null;
  subtotal: string;
  vatTotal: string;
  deliveryTotal: string;
  /** Coarse Autopart readiness for list filters. */
  autopartExportFilter: "READY" | "EXPORTED" | "BLOCKED";
  containsBackorder: boolean;
  fullyBackordered: boolean;
};

export type AdminOrderDetail = PortalOrderDetail & {
  autopartCustomerCodeSnapshot: string | null;
  autopartAccountLinked: boolean;
  autopartExportStatus: "NOT_EXPORTED" | "EXPORTED";
  autopartExportedAt: string | null;
  autopartExportedByName: string | null;
  autopartExportCount: number;
  autopartExportBatch: {
    id: string;
    reference: string;
    filename: string;
    createdAt: string;
  } | null;
  salesRepIdSnapshot: string | null;
  salesRepCodeSnapshot: string | null;
  salesRepNameSnapshot: string | null;
  deliveryMethodLabel: string | null;
  basketId: string | null;
  items: Array<
    PortalOrderDetail["items"][number] & {
      unitPrice: string;
      priceSource: string | null;
      vatRate: string;
      vatCode: string | null;
    }
  >;
};

export type AdminBackorderLineRow = {
  orderId: string;
  orderNumber: string;
  orderDate: string | null;
  status: string;
  statusLabel: string;
  companyId: string;
  companyName: string;
  salesRepName: string | null;
  sku: string;
  productName: string;
  orderedQty: number;
  availableQtyAtOrder: number | null;
  outstandingBackorderQty: number;
  currentAutopartAvail: number | null;
  stockNowAvailable: boolean;
};

type ResolvedLine = {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  caseQty: number | null;
  orderingMode: "CASE" | "FINAL_PART_CASE" | null;
  commercialUnit4dp: string;
  customerUnit2dp: string;
  lineNet2dp: string;
  lineVat2dp: string;
  lineGross2dp: string;
  vatRatePercent: number;
  vatCode: string | null;
  priceSource: string;
  quantityBreakId: string | null;
  promotionId: string | null;
  issue: CheckoutLineIssue;
  issueMessage: string | null;
  availableQtyAtOrder: number;
  backorderQtyAtOrder: number;
  backordersAllowed: boolean;
};

function mapBasketIssueToCheckout(issue: BasketLineIssue): CheckoutLineIssue {
  switch (issue) {
    case "VALID":
      return "VALID";
    case "PRODUCT_UNAVAILABLE":
      return "PRODUCT_UNAVAILABLE";
    case "PRICE_UNAVAILABLE":
      return "PRICE_UNAVAILABLE";
    case "QUANTITY_UNAVAILABLE":
      return "STOCK_CHANGED";
    case "CASE_CONFIGURATION_CHANGED":
      return "CASE_CONFIGURATION_CHANGED";
    case "INSUFFICIENT_FULL_CASE":
      return "INSUFFICIENT_FULL_CASE";
    default:
      return "QUANTITY_INVALID";
  }
}

function checkoutIssueMessage(issue: CheckoutLineIssue): string | null {
  switch (issue) {
    case "VALID":
      return null;
    case "PRICE_UPDATED":
      return "Price has changed. Please review before placing your order.";
    case "STOCK_CHANGED":
      return "Quantity no longer available. Please reduce the quantity.";
    case "QUANTITY_INVALID":
      return "Please update the quantity for this line.";
    case "PRODUCT_UNAVAILABLE":
      return "No longer available";
    case "PRICE_UNAVAILABLE":
      return "Price unavailable";
    case "CASE_CONFIGURATION_CHANGED":
      return "Case size changed. Please update the quantity.";
    case "INSUFFICIENT_FULL_CASE":
      return "Insufficient stock for a full case";
    default:
      return "Please review this line";
  }
}

async function requireTradeCheckoutCompany(userId: string): Promise<{
  profile: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  company: {
    id: string;
    name: string;
    status: string;
    paymentTerms: string | null;
    taxStatus: string;
    autopartCustomerCode: string | null;
    autopartCustomerCodeVerifiedAt: Date | null;
  };
}> {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType !== "TRADE") {
    throw new AuthError(
      "Only trade customers can place checkout orders",
      "CHECKOUT_TRADE_ONLY",
      403,
    );
  }
  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];
  if (!membership) {
    throw new AuthError("No company context for checkout", "CHECKOUT_NO_COMPANY", 403);
  }
  const company = await prisma.company.findUnique({
    where: { id: membership.companyId },
    select: {
      id: true,
      name: true,
      status: true,
      paymentTerms: true,
      taxStatus: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
    },
  });
  if (!company || company.status !== "ACTIVE") {
    throw new AuthError("Company is not approved for ordering", "CHECKOUT_COMPANY_INACTIVE", 403);
  }
  return { profile, company };
}

async function loadPrimarySalesRepSnapshot(companyId: string): Promise<{
  salesRepIdSnapshot: string | null;
  salesRepCodeSnapshot: string | null;
  salesRepNameSnapshot: string | null;
}> {
  const assignment = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true },
    include: {
      salesRep: {
        select: {
          id: true,
          code: true,
          active: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!assignment?.salesRep?.active) {
    const any = await prisma.companyAssignment.findFirst({
      where: { companyId },
      include: {
        salesRep: {
          select: {
            id: true,
            code: true,
            active: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!any?.salesRep?.active) {
      return {
        salesRepIdSnapshot: null,
        salesRepCodeSnapshot: null,
        salesRepNameSnapshot: null,
      };
    }
    return {
      salesRepIdSnapshot: any.salesRep.id,
      salesRepCodeSnapshot: any.salesRep.code,
      salesRepNameSnapshot: any.salesRep.user.name,
    };
  }
  return {
    salesRepIdSnapshot: assignment.salesRep.id,
    salesRepCodeSnapshot: assignment.salesRep.code,
    salesRepNameSnapshot: assignment.salesRep.user.name,
  };
}

async function resolveDeliverySnapshot(
  companyId: string,
  input: {
    addressId?: string | null | undefined;
    oneOffAddress?: DeliveryAddressSnapshot | null | undefined;
  },
): Promise<DeliveryAddressSnapshot> {
  if (input.oneOffAddress) {
    return deliveryAddressSnapshotSchema.parse(input.oneOffAddress);
  }
  if (input.addressId) {
    const address = await prisma.address.findFirst({
      where: {
        id: input.addressId,
        companyId,
        OR: [{ type: "DELIVERY" }, { isDefaultDelivery: true }, { type: "TRADING" }],
      },
    });
    if (!address) {
      throw new AuthError("Delivery address not found for this company", "ADDRESS_NOT_FOUND", 404);
    }
    return deliveryAddressSnapshotSchema.parse({
      line1: address.line1,
      line2: address.line2,
      town: address.town,
      county: address.county,
      postcode: address.postcode,
      country: address.country,
      label: address.label,
      contactName: address.contactName,
      contactPhone: address.contactPhone,
    });
  }
  const fallback = await prisma.address.findFirst({
    where: { companyId, isDefaultDelivery: true },
  });
  if (!fallback) {
    throw new AuthError("A delivery address is required", "ADDRESS_REQUIRED", 400);
  }
  return deliveryAddressSnapshotSchema.parse({
    line1: fallback.line1,
    line2: fallback.line2,
    town: fallback.town,
    county: fallback.county,
    postcode: fallback.postcode,
    country: fallback.country,
    label: fallback.label,
    contactName: fallback.contactName,
    contactPhone: fallback.contactPhone,
  });
}

function buildContactSnapshot(
  user: { name: string | null; email: string },
  overrides?: { name?: string | null; phone?: string | null } | null,
): ContactSnapshot {
  return contactSnapshotSchema.parse({
    name: overrides?.name?.trim() || user.name?.trim() || user.email,
    email: user.email,
    phone: overrides?.phone ?? null,
  });
}

/**
 * Re-resolve basket lines for checkout (prices, stock, ordering).
 * Does not mutate inventory — reservation happens only inside placeOrder.
 */
async function resolveCheckoutLines(
  companyId: string,
  expectedPrices?: Array<{ variantId: string; customerUnitPrice: string }> | null,
): Promise<{ lines: ResolvedLine[]; basketId: string; empty: boolean }> {
  const basket = await prisma.basket.findFirst({
    where: { companyId, status: "OPEN" },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  isActive: true,
                  isTradeVisible: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!basket || basket.items.length === 0) {
    return { lines: [], basketId: basket?.id ?? "", empty: true };
  }

  const variantIds = basket.items.map((i) => i.variantId);
  const [stockMap, globalBackorderPolicy] = await Promise.all([
    loadStockByVariantIds(variantIds),
    getGlobalBackorderPolicy(),
  ]);

  const qtyGroups = new Map<number, typeof basket.items>();
  for (const item of basket.items) {
    const list = qtyGroups.get(item.qty) ?? [];
    list.push(item);
    qtyGroups.set(item.qty, list);
  }

  const priceByVariant = new Map<
    string,
    Awaited<ReturnType<typeof resolveVariantTradePrices>> extends Map<string, infer V> ? V : never
  >();
  for (const [qty, group] of qtyGroups) {
    const resolved = await resolveVariantTradePrices({
      companyId,
      priceListId: null,
      adminTestActive: false,
      quantity: qty,
      variants: group.map((item) => ({
        id: item.variant.id,
        sku: item.variant.sku,
        tradePrice: item.variant.tradePrice,
        vatCode: item.variant.vatCode,
      })),
    });
    for (const [id, price] of resolved) priceByVariant.set(id, price);
  }

  const expectedMap = new Map(
    (expectedPrices ?? []).map((row) => [row.variantId, row.customerUnitPrice]),
  );

  const lines: ResolvedLine[] = [];

  for (const item of basket.items) {
    const variant = item.variant;
    const product = variant.product;
    const stock = stockMap.get(variant.id);
    const stale = stock?.stale ?? true;
    const backorderPolicy = resolveBackorderPolicy({
      globalPolicy: globalBackorderPolicy,
      variantPolicy: variant.backorderPolicy,
    });
    const rawSellable = stock?.sellableQty ?? 0;
    const sellableQty = trustedSellableForOrdering({ sellableQty: rawSellable, stale });
    const orderableByStockPolicy = stock
      ? isOrderableByStockPolicy(
          { sellableQty: rawSellable, stale, availability: stock.availability },
          backorderPolicy,
        )
      : isEffectiveBackorderAllowed(backorderPolicy);
    const resolution = priceByVariant.get(variant.id) ?? null;
    const hasPrice = Boolean(
      resolution && resolution.source !== "NONE" && resolution.unitPriceExVat,
    );

    const basketIssue = assessBasketLineQuantity({
      quantity: item.qty,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty,
      productActive: product.status === "ACTIVE" && product.isActive,
      tradeVisible: product.isTradeVisible,
      orderableByStockPolicy,
      hasTradePrice: hasPrice,
      backorderPolicy,
    });

    let issue = mapBasketIssueToCheckout(basketIssue);
    const ordering = resolveCustomerOrdering({
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty,
      orderableByStockPolicy,
      backorderPolicy,
    });
    const allocation = allocateOrderLineQuantities({
      orderedQty: item.qty,
      sellableQty,
    });

    let commercialUnit4dp = "0.0000";
    let customerUnit2dp = "0.00";
    let lineNet2dp = "0.00";
    let lineVat2dp = "0.00";
    let lineGross2dp = "0.00";
    let vatRatePercent = 0;
    let priceSource = "NONE";
    let quantityBreakId: string | null = null;
    let promotionId: string | null = null;

    if (hasPrice && resolution) {
      const commercial = parseMoney(resolution.unitPriceExVat)!;
      const sellUnit = toCustomerSellUnitPrice(commercial);
      const vatRate = parseMoney(resolution.vatRate)!;
      const lineNet = customerLineNetExVat(commercial, item.qty);
      const lineGross = applyVatInc(lineNet, vatRate);
      const lineVat = roundGbpDisplay({ minor: lineGross.minor - lineNet.minor });
      commercialUnit4dp = moneyToString(commercial, 4);
      customerUnit2dp = moneyToString(sellUnit, 2);
      lineNet2dp = moneyToString(lineNet, 2);
      lineVat2dp = moneyToString(lineVat, 2);
      lineGross2dp = moneyToString(lineGross, 2);
      vatRatePercent = resolution.vatPercent;
      priceSource = resolution.source;
      quantityBreakId = resolution.quantityBreakApplied?.id ?? null;
      promotionId = resolution.promotionApplied?.id ?? null;

      const expected = expectedMap.get(variant.id);
      if (expected != null && issue === "VALID") {
        const expectedMoney = parseMoney(expected);
        const liveMoney = parseMoney(customerUnit2dp);
        if (
          expectedMoney &&
          liveMoney &&
          moneyToString(expectedMoney, 2) !== moneyToString(liveMoney, 2)
        ) {
          issue = "PRICE_UPDATED";
        }
      }
    }

    lines.push({
      variantId: variant.id,
      productId: product.id,
      sku: variant.sku,
      name: product.name,
      quantity: item.qty,
      caseQty: ordering.caseQty,
      orderingMode:
        ordering.mode === "CASE" || ordering.mode === "FINAL_PART_CASE" ? ordering.mode : null,
      commercialUnit4dp,
      customerUnit2dp,
      lineNet2dp,
      lineVat2dp,
      lineGross2dp,
      vatRatePercent,
      vatCode: variant.vatCode,
      priceSource,
      quantityBreakId,
      promotionId,
      issue,
      issueMessage: checkoutIssueMessage(issue),
      availableQtyAtOrder: allocation.availableQtyAtOrder,
      backorderQtyAtOrder: allocation.backorderQtyAtOrder,
      backordersAllowed: isEffectiveBackorderAllowed(backorderPolicy),
    });
  }

  return { lines, basketId: basket.id, empty: false };
}

function linesToReviewLines(lines: ResolvedLine[]): CheckoutReviewLine[] {
  return lines.map((line) => ({
    variantId: line.variantId,
    sku: line.sku,
    name: line.name,
    quantity: line.quantity,
    caseQty: line.caseQty,
    orderingMode: line.orderingMode,
    customerUnitPrice: line.issue === "PRICE_UNAVAILABLE" ? null : line.customerUnit2dp,
    customerUnitPriceDisplay: line.issue === "PRICE_UNAVAILABLE" ? null : line.customerUnit2dp,
    lineNet: line.issue === "VALID" || line.issue === "PRICE_UPDATED" ? line.lineNet2dp : null,
    lineVat: line.issue === "VALID" || line.issue === "PRICE_UPDATED" ? line.lineVat2dp : null,
    lineGross: line.issue === "VALID" || line.issue === "PRICE_UPDATED" ? line.lineGross2dp : null,
    issue: line.issue,
    issueMessage: line.issueMessage,
    priceSource: line.priceSource === "NONE" ? null : line.priceSource,
    availableQtyAtOrder: line.availableQtyAtOrder,
    backorderQtyAtOrder: line.backorderQtyAtOrder,
    backordersAllowed: line.backordersAllowed,
  }));
}

function backorderNoticeFromLines(lines: ResolvedLine[]): {
  hasBackorderItems: boolean;
  backorderNotice: { heading: string; body: string } | null;
} {
  const hasBackorderItems = lines.some(
    (l) => l.issue === "VALID" && l.backorderQtyAtOrder > 0,
  );
  return {
    hasBackorderItems,
    backorderNotice: hasBackorderItems
      ? { heading: BACKORDER_CHECKOUT_HEADING, body: BACKORDER_CHECKOUT_BODY }
      : null,
  };
}

function sumValidTotals(
  lines: ResolvedLine[],
  companyTaxStatus?: string | null,
) {
  let goodsNet = moneyZero();
  let goodsVat = moneyZero();
  for (const line of lines) {
    if (line.issue !== "VALID" && line.issue !== "PRICE_UPDATED") continue;
    if (line.priceSource === "NONE") continue;
    goodsNet = addMoney(goodsNet, parseMoney(line.lineNet2dp)!);
    goodsVat = addMoney(goodsVat, parseMoney(line.lineVat2dp)!);
  }
  const breakdown = calculateTradeOrderTotals({
    goodsNet,
    goodsVat,
    companyTaxStatus: companyTaxStatus ?? "STANDARD",
  });
  return tradeDeliveryTotalsDto(breakdown);
}

function hasBlocking(lines: ResolvedLine[]): boolean {
  return lines.some((l) => l.issue !== "VALID");
}

export async function getCheckoutContext(userId: string): Promise<CheckoutContext> {
  const { profile, company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const addresses = await prisma.address.findMany({
    where: {
      companyId: company.id,
      OR: [{ type: "DELIVERY" }, { isDefaultDelivery: true }],
    },
    orderBy: [{ isDefaultDelivery: "desc" }, { label: "asc" }],
  });

  const defaultAddress =
    addresses.find((a) => a.isDefaultDelivery) ?? addresses[0] ?? null;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const basket = await getBasket(userId);
  if (basket.adminTest || basket.companyId !== company.id) {
    throw new AuthError("Checkout requires a company trade basket", "CHECKOUT_BASKET_INVALID", 403);
  }

  return {
    companyId: company.id,
    companyName: company.name,
    paymentTerms: company.paymentTerms,
    hasVerifiedAutopartCode: Boolean(
      company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt,
    ),
    defaultAddressId: defaultAddress?.id ?? null,
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      line1: a.line1,
      line2: a.line2,
      town: a.town,
      county: a.county,
      postcode: a.postcode,
      country: a.country,
      isDefaultDelivery: a.isDefaultDelivery,
      contactName: a.contactName,
      contactPhone: a.contactPhone,
    })),
    contact: buildContactSnapshot(user),
    basket,
    canPlaceOrder: hasPermission(profile, "orders.create") && !basket.hasBlockingIssues,
  };
}

export async function previewCheckout(
  userId: string,
  draftRaw: unknown,
): Promise<CheckoutReview> {
  const { company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");
  const draft: PreviewCheckoutDraft = previewCheckoutDraftSchema.parse(draftRaw ?? {});

  const { lines, empty } = await resolveCheckoutLines(company.id, draft.expectedLinePrices);
  if (empty) {
    throw new AuthError("Basket is empty", "BASKET_EMPTY", 400);
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });

  let deliveryAddress: DeliveryAddressSnapshot | null = null;
  try {
    deliveryAddress = await resolveDeliverySnapshot(company.id, {
      addressId: draft.addressId ?? null,
      oneOffAddress: draft.oneOffAddress ?? null,
    });
  } catch {
    deliveryAddress = null;
  }

  const contact = buildContactSnapshot(user, draft.contact);
  const poNumber = draft.poNumber ?? draft.customerReference ?? null;

  const backorderMeta = backorderNoticeFromLines(lines);
  return {
    companyId: company.id,
    companyName: company.name,
    lines: linesToReviewLines(lines),
    totals: sumValidTotals(lines, company.taxStatus),
    hasBlockingIssues: hasBlocking(lines),
    hasBackorderItems: backorderMeta.hasBackorderItems,
    backorderNotice: backorderMeta.backorderNotice,
    deliveryAddress,
    contact,
    paymentTerms: company.paymentTerms,
    poNumber,
    deliveryInstructions: draft.deliveryInstructions ?? null,
  };
}

function toConfirmation(
  order: {
    id: string;
    orderNumber: string;
    companyId: string;
    status: string;
    placedAt: Date | null;
    poNumber: string | null;
    subtotal: { toString(): string } | string;
    vatTotal: { toString(): string } | string;
    deliveryTotal: { toString(): string } | string;
    grandTotal: { toString(): string } | string;
    currency: string;
    deliveryAddress: unknown;
    contactSnapshot: unknown;
    paymentTermsSnapshot: string | null;
    deliveryInstructions: string | null;
    externalRef: string | null;
    sourceQuoteId?: string | null;
    sourceQuoteNumber?: string | null;
    items: Array<{
      id?: string;
      sku: string;
      name: string;
      qty: number;
      customerUnitPrice: { toString(): string } | string;
      lineTotal: { toString(): string } | string;
      lineVat?: { toString(): string } | string;
      lineGross?: { toString(): string } | string;
      orderingMode: string | null;
      caseQty?: number | null;
    }>;
  },
  companyName: string,
): PublicOrderConfirmation {
  const delivery =
    order.deliveryAddress && typeof order.deliveryAddress === "object"
      ? (order.deliveryAddress as DeliveryAddressSnapshot)
      : null;
  const contact =
    order.contactSnapshot && typeof order.contactSnapshot === "object"
      ? (order.contactSnapshot as ContactSnapshot)
      : null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: "SUBMITTED",
    companyId: order.companyId,
    companyName,
    placedAt: (order.placedAt ?? new Date()).toISOString(),
    poNumber: order.poNumber,
    subtotal: moneyToString(parseMoney(String(order.subtotal)) ?? moneyZero(), 2),
    vatTotal: moneyToString(parseMoney(String(order.vatTotal)) ?? moneyZero(), 2),
    deliveryTotal: moneyToString(parseMoney(String(order.deliveryTotal)) ?? moneyZero(), 2),
    grandTotal: moneyToString(parseMoney(String(order.grandTotal)) ?? moneyZero(), 2),
    currency: order.currency,
    deliveryAddress: delivery,
    contact,
    paymentTerms: order.paymentTermsSnapshot,
    deliveryInstructions: order.deliveryInstructions,
    lineCount: order.items.length,
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      customerUnitPrice: moneyToString(
        parseMoney(String(item.customerUnitPrice)) ?? moneyZero(),
        2,
      ),
      lineTotal: moneyToString(parseMoney(String(item.lineTotal)) ?? moneyZero(), 2),
      orderingMode: item.orderingMode,
    })),
    externalRef: null,
    sourceQuoteId: order.sourceQuoteId ?? null,
    sourceQuoteNumber: order.sourceQuoteNumber ?? null,
  };
}

export async function placeOrder(userId: string, raw: unknown): Promise<PlaceOrderResult> {
  const input: PlaceOrderInput = placeOrderInputSchema.parse(raw);
  const { profile, company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.create");

  // Idempotency — return existing order for the same key (same company).
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { items: true, company: { select: { name: true } } },
  });
  if (existing) {
    if (existing.companyId !== company.id) {
      throw new AuthError("Idempotency key conflict", "IDEMPOTENCY_CONFLICT", 409);
    }
    return {
      ok: true,
      order: toConfirmation(existing, existing.company.name),
    };
  }

  const { lines, basketId, empty } = await resolveCheckoutLines(
    company.id,
    input.expectedLinePrices,
  );
  if (empty) {
    throw new AuthError("Basket is empty", "BASKET_EMPTY", 400);
  }
  if (hasBlocking(lines)) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    let deliveryAddress: DeliveryAddressSnapshot | null = null;
    try {
      deliveryAddress = await resolveDeliverySnapshot(company.id, {
        addressId: input.addressId ?? null,
        oneOffAddress: input.oneOffAddress ?? null,
      });
    } catch {
      deliveryAddress = null;
    }
    const backorderMeta = backorderNoticeFromLines(lines);
    const review: CheckoutReview = {
      companyId: company.id,
      companyName: company.name,
      lines: linesToReviewLines(lines),
      totals: sumValidTotals(lines, company.taxStatus),
      hasBlockingIssues: true,
      hasBackorderItems: backorderMeta.hasBackorderItems,
      backorderNotice: backorderMeta.backorderNotice,
      deliveryAddress,
      contact: buildContactSnapshot(user, input.contact),
      paymentTerms: company.paymentTerms,
      poNumber: input.poNumber ?? input.customerReference ?? null,
      deliveryInstructions: input.deliveryInstructions ?? null,
    };
    return {
      ok: false,
      code: "REVIEW_REQUIRED",
      lines: review.lines,
      review,
    };
  }

  const deliveryAddress = await resolveDeliverySnapshot(company.id, {
    addressId: input.addressId ?? null,
    oneOffAddress: input.oneOffAddress ?? null,
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const contact = buildContactSnapshot(user, input.contact);
  const salesRep = await loadPrimarySalesRepSnapshot(company.id);
  const verifiedCode =
    company.autopartCustomerCodeVerifiedAt && company.autopartCustomerCode
      ? company.autopartCustomerCode
      : null;
  const poNumber = input.poNumber ?? input.customerReference ?? null;
  // Authoritative delivery + VAT recalculated server-side immediately before commit.
  const totals = sumValidTotals(lines, company.taxStatus);

  const created = await prisma.$transaction(async (tx) => {
    // Re-check idempotency inside the transaction.
    const again = await tx.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true, company: { select: { name: true } } },
    });
    if (again) {
      return { kind: "existing" as const, order: again };
    }

    const openBasket = await tx.basket.findFirst({
      where: { id: basketId, companyId: company.id, status: "OPEN" },
    });
    if (!openBasket) {
      throw new AuthError("Basket is no longer available", "BASKET_NOT_FOUND", 404);
    }

    const orderNumber = await allocateOrderNumber(tx);
    const placedAt = new Date();

    const order = await tx.order.create({
      data: {
        orderNumber,
        companyId: company.id,
        status: "SUBMITTED",
        poNumber,
        orderedByUserId: userId,
        currency: "GBP",
        subtotal: totals.subtotal,
        vatTotal: totals.vatTotal,
        deliveryTotal: totals.deliveryTotal,
        grandTotal: totals.grandTotal,
        deliveryAddress: deliveryAddress as unknown as Prisma.InputJsonValue,
        contactSnapshot: contact as unknown as Prisma.InputJsonValue,
        deliveryInstructions: input.deliveryInstructions ?? null,
        // Snapshot only — never invent default payment terms (e.g. "30 days").
        paymentTermsSnapshot: company.paymentTerms,
        autopartCustomerCodeSnapshot: verifiedCode,
        autopartAccountLinked: Boolean(verifiedCode),
        salesRepIdSnapshot: salesRep.salesRepIdSnapshot,
        salesRepCodeSnapshot: salesRep.salesRepCodeSnapshot,
        salesRepNameSnapshot: salesRep.salesRepNameSnapshot,
        deliveryMethodLabel: "Standard delivery",
        basketId: openBasket.id,
        idempotencyKey: input.idempotencyKey,
        // Phase 6B: never set externalRef (Autopart handoff is Phase 6C).
        externalRef: null,
        placedAt,
        items: {
          create: lines.map((line) => ({
            variantId: line.variantId,
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            qty: line.quantity,
            unitPrice: line.commercialUnit4dp,
            customerUnitPrice: line.customerUnit2dp,
            discountPct: 0,
            vatRate: line.vatRatePercent,
            vatCode: line.vatCode,
            lineTotal: line.lineNet2dp,
            lineVat: line.lineVat2dp,
            lineGross: line.lineGross2dp,
            caseQty: line.caseQty,
            orderingMode: line.orderingMode,
            priceSource: line.priceSource,
            quantityBreakId: line.quantityBreakId,
            promotionId: line.promotionId,
            availableQtyAtOrder: line.availableQtyAtOrder,
            backorderQtyAtOrder: line.backorderQtyAtOrder,
          })),
        },
      },
      include: { items: true, company: { select: { name: true } } },
    });

    // AB stock reservation under row locks — authoritative over preview checks.
    // Basket does NOT reserve; only order creation does.
    await reserveStockForOrder(tx, {
      orderId: order.id,
      lines: order.items.map((item) => ({
        orderItemId: item.id,
        variantId: item.variantId!,
        // Reserve ONLY available allocation — never backordered units.
        quantity: item.availableQtyAtOrder ?? 0,
      })),
    });

    const backorderUnits = order.items.reduce(
      (sum, item) => sum + (item.backorderQtyAtOrder ?? 0),
      0,
    );
    await recordFulfilmentEvent(tx, {
      orderId: order.id,
      kind: "ORDER_RECEIVED",
      summary:
        backorderUnits > 0
          ? `Order received · ${backorderUnits} item${backorderUnits === 1 ? "" : "s"} on backorder`
          : "Order received",
      source: "ORDER_PLACE",
      lineQuantitiesKnown: true,
    });

    await tx.basket.update({
      where: { id: openBasket.id },
      data: { status: "CONVERTED" },
    });

    return { kind: "created" as const, order };
  });

  if (created.kind === "existing") {
    return {
      ok: true,
      order: toConfirmation(created.order, created.order.company.name),
    };
  }

  const confirmation = toConfirmation(created.order, created.order.company.name);

  await recordAuditEvent({
    action: "order.created",
    entityType: "Order",
    entityId: created.order.id,
    actorUserId: userId,
    companyId: company.id,
    after: {
      orderNumber: created.order.orderNumber,
      status: "SUBMITTED",
      grandTotal: confirmation.grandTotal,
      lineCount: confirmation.lineCount,
      // Autopart ERP side effects remain false; AB reservation is local.
      autopartSideEffects: false,
      abReservation: true,
      externalRef: null,
    },
  });
  await recordAuditEvent({
    action: "basket.converted",
    entityType: "Basket",
    entityId: basketId,
    actorUserId: userId,
    companyId: company.id,
    after: { orderId: created.order.id, orderNumber: created.order.orderNumber },
  });

  // Email after commit — failures must not roll back the order.
  try {
    const emailResult = await sendOrderEmailsAfterCommit(created.order.id);
    if (!emailResult.customerOk) {
      await recordAuditEvent({
        action: "order.email_failed",
        entityType: "Order",
        entityId: created.order.id,
        actorUserId: userId,
        companyId: company.id,
        metadata: { detail: emailResult.detail ?? "send failed", channel: "customer" },
      });
    }
  } catch (error) {
    await recordAuditEvent({
      action: "order.email_failed",
      entityType: "Order",
      entityId: created.order.id,
      actorUserId: userId,
      companyId: company.id,
      metadata: {
        detail: error instanceof Error ? error.message : "unknown",
        channel: "customer",
      },
    });
  }

  return { ok: true, order: confirmation };
}

function mapPortalOrderListItem(row: {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: Date | null;
  poNumber: string | null;
  grandTotal: unknown;
  currency: string;
  _count: { items: number };
  items: Array<{
    qty: number;
    availableQtyAtOrder: number | null;
    backorderQtyAtOrder: number;
    despatchedQty: number;
  }>;
}): PortalOrderListItem {
  const fulfilment = summariseCustomerOrderFulfilment({
    status: row.status,
    items: row.items,
  });
  const fullyBackordered = orderIsFullyBackordered(row.items);
  const hint =
    fulfilment.hasOutstandingBackorder && fulfilment.outstandingBackorderUnits > 0
      ? backorderUnitsLabel(fulfilment.outstandingBackorderUnits)
      : fulfilment.hasOutstandingBackorder
        ? "Items awaiting stock"
        : null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: row.placedAt?.toISOString() ?? null,
    poNumber: row.poNumber,
    grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
    currency: row.currency,
    lineCount: row._count.items,
    hasBackorderItems: fulfilment.hasBackorderAtPlacement,
    hasOutstandingBackorder: fulfilment.hasOutstandingBackorder,
    outstandingBackorderUnits: fulfilment.outstandingBackorderUnits,
    fullyBackordered,
    statusLabel: fulfilment.orderStatusLabel,
    statusBadge: fulfilment.orderStatusBadge,
    backorderHint: hint,
  };
}

export async function listPortalOrders(
  userId: string,
  raw?: {
    page?: number;
    pageSize?: number;
    /** Customer history filter. */
    filter?: "ALL" | "OPEN" | "BACKORDERS";
  },
): Promise<{ items: PortalOrderListItem[]; total: number; page: number; pageSize: number }> {
  const { company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const page = Math.max(1, raw?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, raw?.pageSize ?? 25));
  const filter = raw?.filter ?? "ALL";

  const baseWhere: Prisma.OrderWhereInput = {
    companyId: company.id,
    ...(filter === "OPEN" || filter === "BACKORDERS"
      ? {
          status: {
            in: ["SUBMITTED", "CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "ON_HOLD"],
          },
        }
      : { status: { not: "DRAFT" as const } }),
    ...(filter === "BACKORDERS"
      ? {
          OR: [
            { status: "PARTIALLY_DESPATCHED" as const },
            { items: { some: { backorderQtyAtOrder: { gt: 0 } } } },
          ],
        }
      : {}),
  };

  // BACKORDERS may need in-memory refine (outstanding vs historical placement only).
  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where: baseWhere }),
    prisma.order.findMany({
      where: baseWhere,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      skip: filter === "BACKORDERS" ? 0 : (page - 1) * pageSize,
      take: filter === "BACKORDERS" ? 200 : pageSize,
      include: {
        _count: { select: { items: true } },
        items: {
          select: {
            qty: true,
            availableQtyAtOrder: true,
            backorderQtyAtOrder: true,
            despatchedQty: true,
          },
        },
      },
    }),
  ]);

  let items = rows.map(mapPortalOrderListItem);
  if (filter === "BACKORDERS") {
    items = items.filter((row) => row.hasOutstandingBackorder);
    const start = (page - 1) * pageSize;
    return {
      total: items.length,
      page,
      pageSize,
      items: items.slice(start, start + pageSize),
    };
  }

  return {
    total,
    page,
    pageSize,
    items,
  };
}

export async function getPortalOrder(userId: string, orderId: string): Promise<PortalOrderDetail> {
  const { company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId: company.id },
    include: {
      items: true,
      fulfilmentEvents: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!order) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const base = toConfirmation(order, company.name);
  const summary = summariseCustomerOrderFulfilment({
    status: order.status,
    items: order.items,
  });
  return {
    ...base,
    status: order.status,
    hasBackorderItems: orderContainsBackorder(order.items),
    hasOutstandingBackorder: summary.hasOutstandingBackorder,
    outstandingBackorderUnits: summary.outstandingBackorderUnits,
    statusLabel: summary.orderStatusLabel,
    statusBadge: summary.orderStatusBadge,
    lineQuantitiesLimitation: summary.lineQuantitiesLimitation,
    items: order.items.map((item) => {
      const fulfilment = presentCustomerLineFulfilment({
        qty: item.qty,
        availableQtyAtOrder: item.availableQtyAtOrder,
        backorderQtyAtOrder: item.backorderQtyAtOrder ?? 0,
        despatchedQty: item.despatchedQty ?? 0,
        orderPartDespatchedWithoutLineQty: order.status === "PARTIALLY_DESPATCHED",
        orderFullyDespatched: order.status === "DISPATCHED" || order.status === "DELIVERED",
      });
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        qty: item.qty,
        customerUnitPrice: moneyToString(
          parseMoney(String(item.customerUnitPrice)) ?? moneyZero(),
          2,
        ),
        lineTotal: moneyToString(parseMoney(String(item.lineTotal)) ?? moneyZero(), 2),
        lineVat: moneyToString(parseMoney(String(item.lineVat)) ?? moneyZero(), 2),
        lineGross: moneyToString(parseMoney(String(item.lineGross)) ?? moneyZero(), 2),
        orderingMode: item.orderingMode,
        caseQty: item.caseQty,
        availableQtyAtOrder: item.availableQtyAtOrder,
        backorderQtyAtOrder: item.backorderQtyAtOrder ?? 0,
        despatchedQty: item.despatchedQty ?? 0,
        fulfilment: {
          orderedQty: fulfilment.orderedQty,
          allocatedAtOrder: fulfilment.allocatedAtOrder,
          backorderedAtOrder: fulfilment.backorderedAtOrder,
          despatchedQty: fulfilment.despatchedQty,
          outstandingBackorderQty: fulfilment.outstandingBackorderQty,
          lineStatusLabel: fulfilment.lineStatusLabel,
          despatchQuantitiesKnown: fulfilment.despatchQuantitiesKnown,
          limitation: fulfilment.limitation,
        },
      };
    }),
    fulfilmentTimeline: order.fulfilmentEvents.map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      occurredAt: ev.occurredAt.toISOString(),
      summary: ev.summary,
      lineQuantitiesKnown: ev.lineQuantitiesKnown,
      limitation: ev.limitation,
    })),
  };
}

export async function listAdminOrders(
  userId: string,
  raw?: {
    page?: number;
    pageSize?: number;
    companyId?: string;
    q?: string;
    /** Autopart export list filter. */
    autopartExport?: "READY" | "EXPORTED" | "BLOCKED" | "ALL";
    /** Backorder list filter. */
    backorders?: "ALL" | "CONTAINS" | "FULL";
  },
): Promise<{ items: AdminOrderListItem[]; total: number; page: number; pageSize: number }> {
  const profile = await requireSystemPermission(userId, "orders.view");
  const page = Math.max(1, raw?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, raw?.pageSize ?? 25));

  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const companyFilter =
    accessible === "all"
      ? raw?.companyId
        ? { companyId: raw.companyId }
        : {}
      : {
          companyId: {
            in: raw?.companyId
              ? accessible.includes(raw.companyId)
                ? [raw.companyId]
                : []
              : accessible,
          },
        };

  const q = raw?.q?.trim();
  const exportFilter = raw?.autopartExport ?? "ALL";
  const backorderFilter = raw?.backorders ?? "ALL";

  const where: Prisma.OrderWhereInput = {
    ...companyFilter,
    status: { not: "DRAFT" },
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { poNumber: { contains: q, mode: "insensitive" } },
            { company: { name: { contains: q, mode: "insensitive" } } },
            { autopartCustomerCodeSnapshot: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(exportFilter === "EXPORTED"
      ? { autopartExportStatus: "EXPORTED" }
      : exportFilter === "READY"
        ? {
            autopartExportStatus: "NOT_EXPORTED",
            status: { notIn: ["DRAFT", "CANCELLED"] },
            autopartAccountLinked: true,
            autopartCustomerCodeSnapshot: { not: null },
            items: { some: {} },
          }
        : exportFilter === "BLOCKED"
          ? {
              OR: [
                { status: "CANCELLED" },
                { autopartAccountLinked: false },
                { autopartCustomerCodeSnapshot: null },
                { items: { none: {} } },
              ],
              autopartExportStatus: "NOT_EXPORTED",
            }
          : {}),
    ...(backorderFilter === "CONTAINS"
      ? { items: { some: { backorderQtyAtOrder: { gt: 0 } } } }
      : backorderFilter === "FULL"
        ? {
            items: { some: {} },
            AND: [
              { items: { every: { backorderQtyAtOrder: { gt: 0 } } } },
              // Fully backordered: every line has backorder and available at order is 0 or null-with-full-backorder
              {
                NOT: {
                  items: {
                    some: {
                      OR: [
                        { backorderQtyAtOrder: { lte: 0 } },
                        { availableQtyAtOrder: { gt: 0 } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { items: true } },
        company: { select: { name: true } },
        items: { select: { qty: true, availableQtyAtOrder: true, backorderQtyAtOrder: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((row) => {
      const linked = row.autopartAccountLinked && Boolean(row.autopartCustomerCodeSnapshot?.trim());
      const blocked =
        row.status === "CANCELLED" ||
        row._count.items === 0 ||
        !linked;
      const autopartExportFilter: AdminOrderListItem["autopartExportFilter"] =
        row.autopartExportStatus === "EXPORTED"
          ? "EXPORTED"
          : blocked
            ? "BLOCKED"
            : "READY";
      return {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        placedAt: row.placedAt?.toISOString() ?? null,
        poNumber: row.poNumber,
        grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
        subtotal: moneyToString(parseMoney(String(row.subtotal)) ?? moneyZero(), 2),
        vatTotal: moneyToString(parseMoney(String(row.vatTotal)) ?? moneyZero(), 2),
        deliveryTotal: moneyToString(parseMoney(String(row.deliveryTotal)) ?? moneyZero(), 2),
        currency: row.currency,
        lineCount: row._count.items,
        companyName: row.company.name,
        salesRepName: row.salesRepNameSnapshot,
        autopartAccountLinked: row.autopartAccountLinked,
        autopartExportStatus: row.autopartExportStatus,
        autopartCustomerCodeSnapshot: row.autopartCustomerCodeSnapshot,
        autopartExportFilter,
        containsBackorder: orderContainsBackorder(row.items),
        fullyBackordered: orderIsFullyBackordered(row.items),
      };
    }),
  };
}

export async function getAdminOrder(userId: string, orderId: string): Promise<AdminOrderDetail> {
  const profile = await requireSystemPermission(userId, "orders.view");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      fulfilmentEvents: { orderBy: { occurredAt: "asc" } },
      company: { select: { id: true, name: true } },
      autopartExportedBy: { select: { name: true, email: true } },
      autopartExportBatch: { select: { id: true, reference: true, filename: true, createdAt: true } },
    },
  });
  if (!order) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "sales.view_all_accounts")) {
    const accessible = await getAccessibleCompanyIdsForSales(profile);
    if (accessible !== "all" && !accessible.includes(order.companyId)) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }
  }

  const base = toConfirmation(order, order.company.name);
  const summary = summariseCustomerOrderFulfilment({
    status: order.status,
    items: order.items,
  });
  return {
    ...base,
    status: order.status,
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot,
    autopartAccountLinked: order.autopartAccountLinked,
    autopartExportStatus: order.autopartExportStatus,
    autopartExportedAt: order.autopartExportedAt?.toISOString() ?? null,
    autopartExportedByName: order.autopartExportedBy?.name ?? order.autopartExportedBy?.email ?? null,
    autopartExportCount: order.autopartExportCount,
    autopartExportBatch: order.autopartExportBatch
      ? {
          id: order.autopartExportBatch.id,
          reference: order.autopartExportBatch.reference,
          filename: order.autopartExportBatch.filename,
          createdAt: order.autopartExportBatch.createdAt.toISOString(),
        }
      : null,
    salesRepIdSnapshot: order.salesRepIdSnapshot,
    salesRepCodeSnapshot: order.salesRepCodeSnapshot,
    salesRepNameSnapshot: order.salesRepNameSnapshot,
    deliveryMethodLabel: order.deliveryMethodLabel,
    basketId: order.basketId,
    hasBackorderItems: orderContainsBackorder(order.items),
    hasOutstandingBackorder: summary.hasOutstandingBackorder,
    outstandingBackorderUnits: summary.outstandingBackorderUnits,
    statusLabel: summary.orderStatusLabel,
    statusBadge: summary.orderStatusBadge,
    lineQuantitiesLimitation: summary.lineQuantitiesLimitation,
    items: order.items.map((item) => {
      const fulfilment = presentCustomerLineFulfilment({
        qty: item.qty,
        availableQtyAtOrder: item.availableQtyAtOrder,
        backorderQtyAtOrder: item.backorderQtyAtOrder ?? 0,
        despatchedQty: item.despatchedQty ?? 0,
        orderPartDespatchedWithoutLineQty: order.status === "PARTIALLY_DESPATCHED",
        orderFullyDespatched: order.status === "DISPATCHED" || order.status === "DELIVERED",
      });
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        qty: item.qty,
        customerUnitPrice: moneyToString(
          parseMoney(String(item.customerUnitPrice)) ?? moneyZero(),
          2,
        ),
        unitPrice: moneyToString(parseMoney(String(item.unitPrice)) ?? moneyZero(), 4),
        lineTotal: moneyToString(parseMoney(String(item.lineTotal)) ?? moneyZero(), 2),
        lineVat: moneyToString(parseMoney(String(item.lineVat)) ?? moneyZero(), 2),
        lineGross: moneyToString(parseMoney(String(item.lineGross)) ?? moneyZero(), 2),
        orderingMode: item.orderingMode,
        caseQty: item.caseQty,
        priceSource: item.priceSource,
        vatRate: moneyToString(parseMoney(String(item.vatRate)) ?? moneyZero(), 2),
        vatCode: item.vatCode,
        availableQtyAtOrder: item.availableQtyAtOrder,
        backorderQtyAtOrder: item.backorderQtyAtOrder ?? 0,
        despatchedQty: item.despatchedQty ?? 0,
        fulfilment: {
          orderedQty: fulfilment.orderedQty,
          allocatedAtOrder: fulfilment.allocatedAtOrder,
          backorderedAtOrder: fulfilment.backorderedAtOrder,
          despatchedQty: fulfilment.despatchedQty,
          outstandingBackorderQty: fulfilment.outstandingBackorderQty,
          lineStatusLabel: fulfilment.lineStatusLabel,
          despatchQuantitiesKnown: fulfilment.despatchQuantitiesKnown,
          limitation: fulfilment.limitation,
        },
      };
    }),
    fulfilmentTimeline: order.fulfilmentEvents.map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      occurredAt: ev.occurredAt.toISOString(),
      summary: ev.summary,
      lineQuantitiesKnown: ev.lineQuantitiesKnown,
      limitation: ev.limitation,
    })),
  };
}

/**
 * Line-level outstanding backorder operational view (Sales → Orders → Backorders).
 */
export async function listAdminBackorderLines(
  userId: string,
  raw?: {
    q?: string;
    stockNowAvailable?: boolean;
    fullyBackordered?: boolean;
    partBackordered?: boolean;
  },
): Promise<{ items: AdminBackorderLineRow[] }> {
  const profile = await requireSystemPermission(userId, "orders.view");
  const accessible = await getAccessibleCompanyIdsForSales(profile);
  const companyFilter = accessible === "all" ? {} : { companyId: { in: accessible } };

  const rows = await prisma.orderItem.findMany({
    where: {
      backorderQtyAtOrder: { gt: 0 },
      order: {
        ...companyFilter,
        status: {
          in: ["SUBMITTED", "CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED", "ON_HOLD"],
        },
        ...(raw?.q?.trim()
          ? {
              OR: [
                { orderNumber: { contains: raw.q.trim(), mode: "insensitive" as const } },
                { company: { name: { contains: raw.q.trim(), mode: "insensitive" as const } } },
                { items: { some: { sku: { contains: raw.q.trim(), mode: "insensitive" as const } } } },
              ],
            }
          : {}),
      },
    },
    select: {
      sku: true,
      name: true,
      qty: true,
      availableQtyAtOrder: true,
      backorderQtyAtOrder: true,
      despatchedQty: true,
      variantId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          placedAt: true,
          createdAt: true,
          salesRepNameSnapshot: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ order: { placedAt: "desc" } }],
    take: 500,
  });

  const variantIds = [...new Set(rows.map((r) => r.variantId).filter(Boolean))] as string[];
  const { AUTOPART_WAREHOUSE_CODE } = await import("@/domain/stock");
  const inventories = variantIds.length
    ? await prisma.inventory.findMany({
        where: {
          variantId: { in: variantIds },
          warehouse: { code: AUTOPART_WAREHOUSE_CODE },
        },
        select: { variantId: true, qtyOnHand: true },
      })
    : [];
  const availByVariant = new Map(inventories.map((i) => [i.variantId, i.qtyOnHand]));

  const items: AdminBackorderLineRow[] = [];
  for (const row of rows) {
    const fulfilment = presentCustomerLineFulfilment({
      qty: row.qty,
      availableQtyAtOrder: row.availableQtyAtOrder,
      backorderQtyAtOrder: row.backorderQtyAtOrder,
      despatchedQty: row.despatchedQty,
      orderPartDespatchedWithoutLineQty: row.order.status === "PARTIALLY_DESPATCHED",
    });
    const outstanding =
      fulfilment.outstandingBackorderQty ??
      (fulfilment.backorderedAtOrder > 0 ? fulfilment.backorderedAtOrder : 0);
    if (outstanding <= 0 && row.order.status !== "PARTIALLY_DESPATCHED") continue;

    const avail = row.variantId != null ? (availByVariant.get(row.variantId) ?? null) : null;
    const stockNowAvailable = avail != null && avail > 0 && outstanding > 0;
    const fullyBo =
      (row.availableQtyAtOrder ?? 0) <= 0 && (row.backorderQtyAtOrder ?? 0) >= row.qty;
    const partBo = !fullyBo && (row.backorderQtyAtOrder ?? 0) > 0;

    if (raw?.stockNowAvailable && !stockNowAvailable) continue;
    if (raw?.fullyBackordered && !fullyBo) continue;
    if (raw?.partBackordered && !partBo) continue;

    const summary = summariseCustomerOrderFulfilment({
      status: row.order.status,
      items: [
        {
          qty: row.qty,
          availableQtyAtOrder: row.availableQtyAtOrder,
          backorderQtyAtOrder: row.backorderQtyAtOrder,
          despatchedQty: row.despatchedQty,
        },
      ],
    });

    items.push({
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      orderDate: (row.order.placedAt ?? row.order.createdAt).toISOString(),
      status: row.order.status,
      statusLabel: summary.orderStatusLabel,
      companyId: row.order.company.id,
      companyName: row.order.company.name,
      salesRepName: row.order.salesRepNameSnapshot,
      sku: row.sku,
      productName: row.name,
      orderedQty: row.qty,
      availableQtyAtOrder: row.availableQtyAtOrder,
      outstandingBackorderQty: outstanding || row.backorderQtyAtOrder,
      currentAutopartAvail: avail,
      stockNowAvailable,
    });
  }

  return { items };
}

type DeleteAdminOrderResult = {
  orderId: string;
  orderNumber: string;
  releasedQuantity: number;
  reservationCount: number;
};

async function assertCanDeleteOrders(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "orders.edit") && !hasPermission(profile, "admin.access")) {
    throw new AuthError("You do not have permission to delete orders", "FORBIDDEN", 403);
  }
  return profile;
}

/**
 * Admin delete order: release ACTIVE stock holds (sellable returns), then remove the order.
 * qtyOnHand is never incremented — Autopart Avail remains physical stock authority.
 */
export async function deleteAdminOrder(
  userId: string,
  orderId: string,
): Promise<DeleteAdminOrderResult> {
  const profile = await assertCanDeleteOrders(userId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      companyId: true,
      status: true,
      autopartExportStatus: true,
      sourceQuoteId: true,
      _count: { select: { invoices: true } },
    },
  });
  if (!order) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "sales.view_all_accounts")) {
    const accessible = await getAccessibleCompanyIdsForSales(profile);
    if (accessible !== "all" && !accessible.includes(order.companyId)) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }
  }

  if (order.status === "DISPATCHED" || order.status === "DELIVERED") {
    throw new AuthError(
      "This order has already been despatched. Stock holds were released at despatch; delete is blocked to preserve fulfilment history.",
      "ORDER_ALREADY_DESPATCHED",
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const released = await releaseStockForOrder(tx, { orderId: order.id });

    // Detach Autopart invoices (if any) so hard-delete is not blocked by FK.
    if (order._count.invoices > 0) {
      await tx.invoice.updateMany({
        where: { orderId: order.id },
        data: { orderId: null },
      });
    }

    // Soft quote link (convertedOrderId is not a Prisma FK) — clear when deleting.
    await tx.quote.updateMany({
      where: { convertedOrderId: order.id },
      data: { convertedOrderId: null },
    });

    await tx.transactionalEmail.deleteMany({
      where: { entityType: "Order", entityId: order.id },
    });

    await tx.order.delete({ where: { id: order.id } });

    return released;
  });

  await recordAuditEvent({
    action: "order.deleted",
    entityType: "Order",
    entityId: order.id,
    actorUserId: userId,
    companyId: order.companyId,
    metadata: {
      orderNumber: order.orderNumber,
      previousStatus: order.status,
      autopartExportStatus: order.autopartExportStatus,
      releasedQuantity: result.releasedQuantity,
      reservationCount: result.reservationCount,
      qtyOnHandUnchanged: true,
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    releasedQuantity: result.releasedQuantity,
    reservationCount: result.reservationCount,
  };
}

/**
 * Bulk admin delete with explicit confirmation of selected count.
 * Skips already-despatched orders and reports them rather than failing the whole batch.
 */
export async function deleteAdminOrders(
  userId: string,
  raw: unknown,
): Promise<{
  deleted: DeleteAdminOrderResult[];
  skipped: Array<{ orderId: string; orderNumber: string; reason: string }>;
}> {
  await assertCanDeleteOrders(userId);
  const input = z
    .object({
      orderIds: z.array(z.string().cuid()).min(1).max(100),
      confirmCount: z.number().int().positive(),
    })
    .parse(raw);

  if (input.orderIds.length !== input.confirmCount) {
    throw new AuthError(
      `Confirm count mismatch (expected ${input.orderIds.length}, got ${input.confirmCount})`,
      "CONFIRMATION_REQUIRED",
      400,
    );
  }

  const deleted: DeleteAdminOrderResult[] = [];
  const skipped: Array<{ orderId: string; orderNumber: string; reason: string }> = [];

  for (const orderId of input.orderIds) {
    try {
      deleted.push(await deleteAdminOrder(userId, orderId));
    } catch (error) {
      if (error instanceof AuthError) {
        const row = await prisma.order.findUnique({
          where: { id: orderId },
          select: { orderNumber: true },
        });
        skipped.push({
          orderId,
          orderNumber: row?.orderNumber ?? orderId,
          reason: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  if (deleted.length === 0 && skipped.length > 0) {
    throw new AuthError(
      skipped.map((s) => `${s.orderNumber}: ${s.reason}`).join(" · "),
      "DELETE_FAILED",
      400,
    );
  }

  return { deleted, skipped };
}

/**
 * Explicit staff repair: copy the company's current verified Autopart code onto
 * an order that was placed without a snapshot. Never silent; never overwrites
 * an existing snapshot; blocked after Autopart CSV export.
 */
export async function repairOrderAutopartCustomerCodeSnapshot(
  userId: string,
  orderId: string,
): Promise<{
  orderId: string;
  orderNumber: string;
  autopartCustomerCodeSnapshot: string;
}> {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "orders.edit") && !hasPermission(profile, "admin.access")) {
    throw new AuthError("You do not have permission to repair order Autopart snapshots", "FORBIDDEN", 403);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      companyId: true,
      status: true,
      autopartCustomerCodeSnapshot: true,
      autopartAccountLinked: true,
      autopartExportStatus: true,
      company: {
        select: {
          autopartCustomerCode: true,
          autopartCustomerCodeVerifiedAt: true,
        },
      },
    },
  });
  if (!order) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);

  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "sales.view_all_accounts")) {
    const accessible = await getAccessibleCompanyIdsForSales(profile);
    if (accessible !== "all" && !accessible.includes(order.companyId)) {
      throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
    }
  }

  if (order.autopartExportStatus === "EXPORTED") {
    throw new AuthError(
      "Cannot repair Autopart snapshot after the order has been exported to Autopart",
      "ORDER_ALREADY_EXPORTED",
      400,
    );
  }
  if (order.autopartCustomerCodeSnapshot?.trim()) {
    throw new AuthError(
      "This order already has an Autopart account snapshot — historical snapshots are not overwritten",
      "SNAPSHOT_ALREADY_SET",
      400,
    );
  }

  const code =
    order.company.autopartCustomerCodeVerifiedAt && order.company.autopartCustomerCode?.trim()
      ? order.company.autopartCustomerCode.trim()
      : null;
  if (!code) {
    throw new AuthError(
      "Company has no verified Autopart customer code to copy onto this order",
      "AUTOPART_CODE_MISSING",
      400,
    );
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      autopartCustomerCodeSnapshot: code,
      autopartAccountLinked: true,
    },
    select: { id: true, orderNumber: true, autopartCustomerCodeSnapshot: true },
  });

  await recordAuditEvent({
    action: "order.autopart_snapshot_repaired",
    entityType: "Order",
    entityId: order.id,
    actorUserId: userId,
    companyId: order.companyId,
    metadata: {
      orderNumber: order.orderNumber,
      previousSnapshot: null,
      autopartCustomerCodeSnapshot: code,
      source: "company.verified",
    },
  });

  return {
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    autopartCustomerCodeSnapshot: updated.autopartCustomerCodeSnapshot!,
  };
}
