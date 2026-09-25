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
import { reserveStockForOrder } from "@/server/orders/reservations";
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
};

export type CheckoutReview = {
  companyId: string;
  companyName: string;
  lines: CheckoutReviewLine[];
  totals: {
    subtotal: string;
    vatTotal: string;
    deliveryTotal: string;
    grandTotal: string;
    currency: "GBP";
    freeDelivery?: boolean;
    amountToFreeDelivery?: string | null;
    deliveryLabel?: string;
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
};

export type PlaceOrderResult =
  | { ok: true; order: PublicOrderConfirmation }
  | { ok: false; code: "REVIEW_REQUIRED"; lines: CheckoutReviewLine[]; review: CheckoutReview };

export type PortalOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  placedAt: string | null;
  poNumber: string | null;
  grandTotal: string;
  currency: string;
  lineCount: number;
};

export type PortalOrderDetail = Omit<PublicOrderConfirmation, "status" | "items"> & {
  status: string;
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
  }>;
};

export type AdminOrderListItem = PortalOrderListItem & {
  companyName: string;
  salesRepName: string | null;
  autopartAccountLinked: boolean;
  subtotal: string;
  vatTotal: string;
};

export type AdminOrderDetail = PortalOrderDetail & {
  autopartCustomerCodeSnapshot: string | null;
  autopartAccountLinked: boolean;
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
  const stockMap = await loadStockByVariantIds(variantIds);

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
    const sellableQty = stock?.sellableQty ?? 0;
    const stale = stock?.stale ?? true;
    const availability = stock?.availability ?? null;
    const orderableByStockPolicy = stock
      ? isOrderableByStockPolicy({ sellableQty, stale, availability })
      : false;
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
    });

    let issue = mapBasketIssueToCheckout(basketIssue);
    const ordering = resolveCustomerOrdering({
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty,
      orderableByStockPolicy,
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
  }));
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

  return {
    companyId: company.id,
    companyName: company.name,
    lines: linesToReviewLines(lines),
    totals: sumValidTotals(lines, company.taxStatus),
    hasBlockingIssues: hasBlocking(lines),
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
    const review: CheckoutReview = {
      companyId: company.id,
      companyName: company.name,
      lines: linesToReviewLines(lines),
      totals: sumValidTotals(lines, company.taxStatus),
      hasBlockingIssues: true,
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
        quantity: item.qty,
      })),
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

export async function listPortalOrders(
  userId: string,
  raw?: { page?: number; pageSize?: number },
): Promise<{ items: PortalOrderListItem[]; total: number; page: number; pageSize: number }> {
  const { company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const page = Math.max(1, raw?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, raw?.pageSize ?? 25));
  const where = { companyId: company.id, status: { not: "DRAFT" as const } };

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { items: true } } },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      placedAt: row.placedAt?.toISOString() ?? null,
      poNumber: row.poNumber,
      grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
      currency: row.currency,
      lineCount: row._count.items,
    })),
  };
}

export async function getPortalOrder(userId: string, orderId: string): Promise<PortalOrderDetail> {
  const { company } = await requireTradeCheckoutCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId: company.id },
    include: { items: true },
  });
  if (!order) {
    throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  const base = toConfirmation(order, company.name);
  return {
    ...base,
    status: order.status,
    items: order.items.map((item) => ({
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
    })),
  };
}

export async function listAdminOrders(
  userId: string,
  raw?: { page?: number; pageSize?: number; companyId?: string; q?: string },
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
  };

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { items: true } }, company: { select: { name: true } } },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      placedAt: row.placedAt?.toISOString() ?? null,
      poNumber: row.poNumber,
      grandTotal: moneyToString(parseMoney(String(row.grandTotal)) ?? moneyZero(), 2),
      subtotal: moneyToString(parseMoney(String(row.subtotal)) ?? moneyZero(), 2),
      vatTotal: moneyToString(parseMoney(String(row.vatTotal)) ?? moneyZero(), 2),
      currency: row.currency,
      lineCount: row._count.items,
      companyName: row.company.name,
      salesRepName: row.salesRepNameSnapshot,
      autopartAccountLinked: row.autopartAccountLinked,
    })),
  };
}

export async function getAdminOrder(userId: string, orderId: string): Promise<AdminOrderDetail> {
  const profile = await requireSystemPermission(userId, "orders.view");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, company: { select: { id: true, name: true } } },
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
  return {
    ...base,
    status: order.status,
    autopartCustomerCodeSnapshot: order.autopartCustomerCodeSnapshot,
    autopartAccountLinked: order.autopartAccountLinked,
    salesRepIdSnapshot: order.salesRepIdSnapshot,
    salesRepCodeSnapshot: order.salesRepCodeSnapshot,
    salesRepNameSnapshot: order.salesRepNameSnapshot,
    deliveryMethodLabel: order.deliveryMethodLabel,
    basketId: order.basketId,
    items: order.items.map((item) => ({
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
    })),
  };
}
