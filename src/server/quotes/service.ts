/**
 * Production B2B quotation workflow.
 *
 * Quotes snapshot commercial terms; conversion creates a normal AB Order
 * (SUBMITTED / Received) with AB stock reservation — no Autopart side effects.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission, requireCompanyPermission } from "@/server/rbac/guards";
import { hasPermission, loadAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales, getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";
import { recordAuditEvent } from "@/server/audit/record";
import { allocateQuoteNumber } from "@/server/quotes/quote-number";
import { allocateOrderNumber } from "@/server/orders/order-number";
import { reserveStockForOrder } from "@/server/orders/reservations";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { loadStockByVariantIds } from "@/server/stock/service";
import { sendOrderEmailsAfterCommit } from "@/server/email/transactional";
import {
  addCalendarDaysDateOnly,
  customerCanRespond,
  dateOnlyFromValidUntil,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  isQuoteExpired,
  QUOTE_CUSTOMER_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  quoteAcceptOnBehalfSchema,
  quoteAcceptSchema,
  quoteCreateSchema,
  quoteDeclineSchema,
  quoteIdSchema,
  quoteListQuerySchema,
  quoteSendSchema,
  quoteUpdateDraftSchema,
  validUntilFromDateOnly,
  type QuoteStatusKey,
} from "@/domain/quote";
import {
  applyVatInc,
  customerLineNetExVat,
  moneyToString,
  moneyZero,
  parseMoney,
  toCustomerSellUnitPrice,
  vatRateForCodes,
  addMoney,
} from "@/domain/money";
import {
  calculateTradeOrderTotals,
  tradeDeliveryTotalsDto,
} from "@/domain/trade-delivery";
import {
  assessBasketLineQuantity,
  basketLineIssueMessage,
  isOrderableByStockPolicy,
  resolveCustomerOrdering,
} from "@/domain/ordering";
import type { VariantStock } from "@/domain/stock";

function money2(value: unknown): string {
  return moneyToString(parseMoney(String(value)) ?? moneyZero(), 2);
}

function money4(value: unknown): string {
  return moneyToString(parseMoney(String(value)) ?? moneyZero(), 4);
}

async function requireQuoteStaff(userId: string, permission: string) {
  const profile = await requireSystemPermission(userId, permission as never);
  return profile;
}

async function assertCompanyInSalesScope(userId: string, companyId: string) {
  const profile = await loadAccessProfile(userId);
  if (!profile) throw new AuthError("Not authenticated", "UNAUTHORIZED", 401);
  if (hasPermission(profile, "admin.access")) return profile;
  const ok = await canAccessCompanyAsSales(profile, companyId);
  if (!ok) throw new AuthError("Company is outside your sales scope", "FORBIDDEN", 403);
  return profile;
}

async function loadPrimarySalesRepSnapshot(companyId: string) {
  const assignment = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true },
    include: {
      salesRep: {
        select: { id: true, code: true, active: true, user: { select: { name: true } } },
      },
    },
  });
  const rep = assignment?.salesRep?.active ? assignment.salesRep : null;
  return {
    salesRepIdSnapshot: rep?.id ?? null,
    salesRepCodeSnapshot: rep?.code ?? null,
    salesRepNameSnapshot: rep?.user?.name ?? null,
  };
}

async function loadCompanyForQuote(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      taxStatus: true,
      paymentTerms: true,
      priceListId: true,
      primaryEmail: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  if (company.status !== "ACTIVE") {
    throw new AuthError("Only ACTIVE trade companies can receive quotes", "COMPANY_NOT_ACTIVE", 400);
  }
  return company;
}

type BuiltLine = {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitPrice: string;
  normalUnitPrice: string;
  customerUnitPrice: string;
  normalCustomerUnitPrice: string;
  priceOverride: boolean;
  vatRate: string;
  vatCode: string | null;
  lineTotal: string;
  lineVat: string;
  lineGross: string;
  caseQty: number | null;
  orderingMode: string | null;
  priceSource: string | null;
  quantityBreakId: string | null;
  promotionId: string | null;
  sortOrder: number;
};

async function buildQuoteLines(
  companyId: string,
  companyTaxStatus: string,
  lines: Array<{ variantId: string; qty: number; quotedUnitPrice?: string | null }>,
  opts: { allowOverride: boolean; actorUserId: string },
): Promise<BuiltLine[]> {
  if (!lines.length) return [];
  const variantIds = lines.map((l) => l.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: {
      product: { select: { id: true, name: true, status: true, isActive: true, isTradeVisible: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const stockMap = await loadStockByVariantIds(variantIds);

  const built: BuiltLine[] = [];
  let sortOrder = 0;
  for (const input of lines) {
    const variant = byId.get(input.variantId);
    if (!variant || !variant.product.isActive || variant.product.status !== "ACTIVE") {
      throw new AuthError(`Product not available for quoting`, "VARIANT_UNAVAILABLE", 400);
    }
    const prices = await resolveVariantTradePrices({
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: String(variant.tradePrice),
          vatCode: variant.vatCode,
        },
      ],
      companyId,
      quantity: input.qty,
    });
    const resolved = prices.get(variant.id);
    if (!resolved || resolved.source === "NONE") {
      throw new AuthError(`No trade price for ${variant.sku}`, "NO_PRICE", 400);
    }

    const stock = stockMap.get(variant.id) ?? null;
    const sellable = stock?.sellableQty ?? 0;
    const backorderPolicy = stock?.backorderPolicy === "ALLOW" || variant.backorderPolicy === "ALLOW" ? "ALLOW" : "DENY";
    const orderableByStock = stock ? isOrderableByStockPolicy(stock, backorderPolicy) : backorderPolicy === "ALLOW";
    const ordering = resolveCustomerOrdering({
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty: sellable,
      orderableByStockPolicy: orderableByStock,
      backorderPolicy,
    });
    const qtyIssue = assessBasketLineQuantity({
      quantity: input.qty,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty: sellable,
      productActive: variant.product.isActive && variant.product.status === "ACTIVE",
      tradeVisible: variant.product.isTradeVisible,
      orderableByStockPolicy: orderableByStock,
      hasTradePrice: true,
      backorderPolicy,
    });
    if (qtyIssue !== "VALID") {
      throw new AuthError(
        basketLineIssueMessage(qtyIssue) ?? `Invalid quantity for ${variant.sku}`,
        "INVALID_QTY",
        400,
      );
    }

    const normalCommercial = parseMoney(resolved.unitPriceExVat)!;
    const normalCustomer = toCustomerSellUnitPrice(normalCommercial);
    let quotedCommercial = normalCommercial;
    let priceOverride = false;
    if (input.quotedUnitPrice != null && String(input.quotedUnitPrice).trim() !== "") {
      if (!opts.allowOverride) {
        throw new AuthError("Quote price override not permitted", "FORBIDDEN", 403);
      }
      const override = parseMoney(String(input.quotedUnitPrice));
      if (!override || override.minor < 0n) {
        throw new AuthError("Invalid quoted unit price", "VALIDATION", 400);
      }
      quotedCommercial = override;
      priceOverride = moneyToString(override, 4) !== moneyToString(normalCommercial, 4);
    }
    const quotedCustomer = toCustomerSellUnitPrice(quotedCommercial);
    const lineNet = customerLineNetExVat(quotedCommercial, input.qty);
    const vatInfo = vatRateForCodes({
      vatCode: variant.vatCode,
      companyTaxStatus,
    });
    const gross = applyVatInc(lineNet, vatInfo.rate);
    const vatMoney = { minor: gross.minor - lineNet.minor };

    built.push({
      variantId: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      name: variant.product.name,
      qty: input.qty,
      unitPrice: moneyToString(quotedCommercial, 4),
      normalUnitPrice: moneyToString(normalCommercial, 4),
      customerUnitPrice: moneyToString(quotedCustomer, 2),
      normalCustomerUnitPrice: moneyToString(normalCustomer, 2),
      priceOverride,
      vatRate: String(vatInfo.percent),
      vatCode: variant.vatCode ?? null,
      lineTotal: moneyToString(lineNet, 2),
      lineVat: moneyToString(vatMoney, 2),
      lineGross: moneyToString(gross, 2),
      caseQty: variant.caseQty,
      orderingMode: ordering.mode,
      priceSource: resolved.source,
      quantityBreakId: resolved.quantityBreakApplied?.id ?? null,
      promotionId: resolved.promotionApplied?.id ?? null,
      sortOrder: sortOrder++,
    });
  }
  return built;
}

function sellableFromStock(stock: VariantStock | undefined): number {
  return stock?.sellableQty ?? 0;
}

function totalsFromBuiltLines(
  lines: BuiltLine[],
  companyTaxStatus: string,
  deliveryOverride: string | null,
) {
  let goodsNet = moneyZero();
  let goodsVat = moneyZero();
  for (const line of lines) {
    goodsNet = addMoney(goodsNet, parseMoney(line.lineTotal)!);
    goodsVat = addMoney(goodsVat, parseMoney(line.lineVat)!);
  }

  if (deliveryOverride != null) {
    const deliveryNet = parseMoney(deliveryOverride) ?? moneyZero();
    const deliveryVatInfo = vatRateForCodes({ vatCode: "STANDARD", companyTaxStatus });
    const deliveryGross = applyVatInc(deliveryNet, deliveryVatInfo.rate);
    const deliveryVat = { minor: deliveryGross.minor - deliveryNet.minor };
    const vatTotal = addMoney(goodsVat, deliveryVat);
    const grand = addMoney(addMoney(goodsNet, deliveryNet), vatTotal);
    return {
      subtotal: moneyToString(goodsNet, 2),
      deliveryTotal: moneyToString(deliveryNet, 2),
      vatTotal: moneyToString(vatTotal, 2),
      grandTotal: moneyToString(grand, 2),
      deliveryOverridden: true,
    };
  }

  const breakdown = calculateTradeOrderTotals({
    goodsNet,
    goodsVat,
    companyTaxStatus,
  });
  const dto = tradeDeliveryTotalsDto(breakdown);
  return {
    subtotal: dto.subtotal,
    deliveryTotal: dto.deliveryTotal,
    vatTotal: dto.vatTotal,
    grandTotal: dto.grandTotal,
    deliveryOverridden: false,
  };
}

function serializeQuote(
  quote: {
    id: string;
    quoteNumber: string;
    companyId: string;
    status: string;
    currency: string;
    subtotal: { toString(): string } | string;
    deliveryTotal: { toString(): string } | string;
    vatTotal: { toString(): string } | string;
    grandTotal: { toString(): string } | string;
    expiresAt: Date | null;
    customerNotes: string | null;
    internalNotes: string | null;
    notes: string | null;
    poNumber: string | null;
    contactSnapshot: Prisma.JsonValue | null;
    deliveryAddress: Prisma.JsonValue | null;
    salesRepNameSnapshot: string | null;
    salesRepCodeSnapshot: string | null;
    paymentTermsSnapshot: string | null;
    sentAt: Date | null;
    firstViewedAt: Date | null;
    acceptedAt: Date | null;
    declinedAt: Date | null;
    declineReason: string | null;
    convertedAt: Date | null;
    convertedOrderId: string | null;
    deliveryOverridden: boolean;
    createdAt: Date;
    updatedAt: Date;
    company?: { id: string; name: string; status: string };
    items?: Array<{
      id: string;
      variantId: string | null;
      productId: string | null;
      sku: string;
      name: string;
      qty: number;
      unitPrice: { toString(): string } | string;
      normalUnitPrice: { toString(): string } | string | null;
      customerUnitPrice: { toString(): string } | string | null;
      normalCustomerUnitPrice: { toString(): string } | string | null;
      priceOverride: boolean;
      lineTotal: { toString(): string } | string;
      lineVat: { toString(): string } | string | null;
      lineGross: { toString(): string } | string | null;
      vatRate: { toString(): string } | string;
      caseQty: number | null;
      priceSource: string | null;
    }>;
    orders?: Array<{ id: string; orderNumber: string }>;
  },
  opts?: { customerView?: boolean },
) {
  const status = quote.status as QuoteStatusKey;
  const expired = isQuoteExpired(quote.expiresAt);
  const effectiveStatus =
    expired && (status === "SENT" || status === "VIEWED") ? ("EXPIRED" as const) : status;
  const convertedOrder =
    quote.orders?.[0] ??
    (quote.convertedOrderId
      ? { id: quote.convertedOrderId, orderNumber: "" }
      : null);

  const contactSnapshot =
    quote.contactSnapshot && typeof quote.contactSnapshot === "object"
      ? (quote.contactSnapshot as Record<string, string | null>)
      : null;
  const deliveryAddress =
    quote.deliveryAddress && typeof quote.deliveryAddress === "object"
      ? (quote.deliveryAddress as Record<string, string | null>)
      : null;

  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    companyId: quote.companyId,
    company: quote.company
      ? { id: quote.company.id, name: quote.company.name, status: quote.company.status }
      : null,
    status: effectiveStatus,
    statusLabel: opts?.customerView
      ? QUOTE_CUSTOMER_STATUS_LABEL[effectiveStatus]
      : QUOTE_STATUS_LABEL[effectiveStatus],
    currency: quote.currency,
    subtotal: money2(quote.subtotal),
    deliveryTotal: money2(quote.deliveryTotal),
    vatTotal: money2(quote.vatTotal),
    grandTotal: money2(quote.grandTotal),
    validUntil: quote.expiresAt ? dateOnlyFromValidUntil(quote.expiresAt) : null,
    expiresAt: quote.expiresAt?.toISOString() ?? null,
    customerNotes: quote.customerNotes ?? quote.notes,
    internalNotes: opts?.customerView ? null : quote.internalNotes,
    poNumber: quote.poNumber,
    contactSnapshot,
    deliveryAddress,
    salesRepName: quote.salesRepNameSnapshot,
    salesRepCode: quote.salesRepCodeSnapshot,
    paymentTerms: quote.paymentTermsSnapshot,
    sentAt: quote.sentAt?.toISOString() ?? null,
    firstViewedAt: quote.firstViewedAt?.toISOString() ?? null,
    acceptedAt: quote.acceptedAt?.toISOString() ?? null,
    declinedAt: quote.declinedAt?.toISOString() ?? null,
    declineReason: quote.declineReason,
    convertedAt: quote.convertedAt?.toISOString() ?? null,
    convertedOrderId: quote.convertedOrderId,
    convertedOrderNumber: convertedOrder?.orderNumber || null,
    deliveryOverridden: quote.deliveryOverridden,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    canCustomerAccept: customerCanRespond(effectiveStatus, quote.expiresAt),
    items: (quote.items ?? []).map((it) => ({
      id: it.id,
      variantId: opts?.customerView ? null : (it.variantId ?? null),
      productId: opts?.customerView ? null : (it.productId ?? null),
      sku: it.sku,
      name: it.name,
      qty: it.qty,
      unitPrice: money4(it.unitPrice),
      normalUnitPrice: money4(it.normalUnitPrice ?? it.unitPrice),
      customerUnitPrice: money2(it.customerUnitPrice ?? it.unitPrice),
      normalCustomerUnitPrice: money2(it.normalCustomerUnitPrice ?? it.customerUnitPrice ?? it.unitPrice),
      priceOverride: Boolean(it.priceOverride),
      lineTotal: money2(it.lineTotal),
      lineVat: money2(it.lineVat ?? 0),
      lineGross: money2(it.lineGross ?? it.lineTotal),
      vatRate: money2(it.vatRate),
      caseQty: it.caseQty ?? null,
      priceSource: opts?.customerView ? null : (it.priceSource ?? null),
    })),
  };
}

const quoteInclude = {
  company: { select: { id: true, name: true, status: true } },
  items: { orderBy: { sortOrder: "asc" as const } },
  orders: { select: { id: true, orderNumber: true }, take: 1 },
} satisfies Prisma.QuoteInclude;

export async function createQuote(actorUserId: string, raw: unknown) {
  await requireQuoteStaff(actorUserId, "quotes.create");
  const input = quoteCreateSchema.parse(raw);
  await assertCompanyInSalesScope(actorUserId, input.companyId);
  const company = await loadCompanyForQuote(input.companyId);
  const salesRep = await loadPrimarySalesRepSnapshot(company.id);

  let contactSnapshot: Prisma.InputJsonValue | null = null;
  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, companyId: company.id },
    });
    if (!contact) throw new AuthError("Contact not found", "NOT_FOUND", 404);
    contactSnapshot = {
      id: contact.id,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone,
    };
  } else {
    const primary = await prisma.contact.findFirst({
      where: { companyId: company.id, isPrimary: true },
    });
    if (primary) {
      contactSnapshot = {
        id: primary.id,
        name: `${primary.firstName} ${primary.lastName}`.trim(),
        email: primary.email,
        phone: primary.phone,
      };
    }
  }

  let deliveryAddress: Prisma.InputJsonValue | null = null;
  let deliveryAddressId: string | null = input.deliveryAddressId ?? null;
  if (deliveryAddressId) {
    const addr = await prisma.address.findFirst({
      where: { id: deliveryAddressId, companyId: company.id },
    });
    if (!addr) throw new AuthError("Delivery address not found", "NOT_FOUND", 404);
    deliveryAddress = {
      line1: addr.line1,
      line2: addr.line2,
      town: addr.town,
      county: addr.county,
      postcode: addr.postcode,
      country: addr.country,
      contactName: addr.contactName,
      contactPhone: addr.contactPhone,
    };
  } else {
    const addr = await prisma.address.findFirst({
      where: { companyId: company.id, isDefaultDelivery: true },
    });
    if (addr) {
      deliveryAddressId = addr.id;
      deliveryAddress = {
        line1: addr.line1,
        line2: addr.line2,
        town: addr.town,
        county: addr.county,
        postcode: addr.postcode,
        country: addr.country,
        contactName: addr.contactName,
        contactPhone: addr.contactPhone,
      };
    }
  }

  const validUntil = input.validUntil
    ? validUntilFromDateOnly(input.validUntil)
    : validUntilFromDateOnly(
        addCalendarDaysDateOnly(new Date(), input.validityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS),
      );

  const quote = await prisma.$transaction(async (tx) => {
    const quoteNumber = await allocateQuoteNumber(tx);
    return tx.quote.create({
      data: {
        quoteNumber,
        companyId: company.id,
        status: "DRAFT",
        subtotal: 0,
        deliveryTotal: 0,
        vatTotal: 0,
        grandTotal: 0,
        expiresAt: validUntil,
        customerNotes: input.customerNotes ?? null,
        internalNotes: input.internalNotes ?? null,
        poNumber: input.poNumber ?? null,
        contactId: input.contactId ?? null,
        ...(contactSnapshot ? { contactSnapshot } : {}),
        deliveryAddressId,
        ...(deliveryAddress ? { deliveryAddress } : {}),
        salesRepIdSnapshot: salesRep.salesRepIdSnapshot,
        salesRepCodeSnapshot: salesRep.salesRepCodeSnapshot,
        salesRepNameSnapshot: salesRep.salesRepNameSnapshot,
        paymentTermsSnapshot: company.paymentTerms,
        createdById: actorUserId,
      },
      include: quoteInclude,
    });
  });

  await recordAuditEvent({
    action: "quote.created",
    entityType: "Quote",
    entityId: quote.id,
    actorUserId,
    companyId: company.id,
    after: { quoteNumber: quote.quoteNumber, status: "DRAFT" },
  });

  return serializeQuote(quote);
}

export async function updateQuoteDraft(actorUserId: string, raw: unknown) {
  const profile = await requireQuoteStaff(actorUserId, "quotes.edit");
  const input = quoteUpdateDraftSchema.parse(raw);
  const existing = await prisma.quote.findUnique({ where: { id: input.id } });
  if (!existing) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  if (existing.status !== "DRAFT") {
    throw new AuthError("Only draft quotes can be edited — duplicate to revise", "CONFLICT", 409);
  }
  await assertCompanyInSalesScope(actorUserId, existing.companyId);
  const company = await loadCompanyForQuote(existing.companyId);

  const allowOverride = hasPermission(profile, "quotes.override_price");
  let builtLines: BuiltLine[] | null = null;
  if (input.lines) {
    builtLines = await buildQuoteLines(
      company.id,
      company.taxStatus,
      input.lines.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        quotedUnitPrice: l.quotedUnitPrice ?? null,
      })),
      {
        allowOverride,
        actorUserId,
      },
    );
  }

  const deliveryOverride =
    input.clearDeliveryOverride
      ? null
      : input.deliveryTotalOverride != null
        ? (() => {
            if (!allowOverride && !hasPermission(profile, "quotes.override_price")) {
              throw new AuthError("Delivery override not permitted", "FORBIDDEN", 403);
            }
            return money2(input.deliveryTotalOverride);
          })()
        : existing.deliveryOverridden
          ? money2(existing.deliveryTotal)
          : null;

  const linesForTotals =
    builtLines ??
    (
      await prisma.quoteItem.findMany({ where: { quoteId: existing.id }, orderBy: { sortOrder: "asc" } })
    ).map(
      (it, idx) =>
        ({
          variantId: it.variantId ?? "",
          productId: it.productId ?? "",
          sku: it.sku,
          name: it.name,
          qty: it.qty,
          unitPrice: money4(it.unitPrice),
          normalUnitPrice: money4(it.normalUnitPrice),
          customerUnitPrice: money2(it.customerUnitPrice),
          normalCustomerUnitPrice: money2(it.normalCustomerUnitPrice),
          priceOverride: it.priceOverride,
          vatRate: money2(it.vatRate),
          vatCode: it.vatCode,
          lineTotal: money2(it.lineTotal),
          lineVat: money2(it.lineVat),
          lineGross: money2(it.lineGross),
          caseQty: it.caseQty,
          orderingMode: it.orderingMode,
          priceSource: it.priceSource,
          quantityBreakId: it.quantityBreakId,
          promotionId: it.promotionId,
          sortOrder: idx,
        }) satisfies BuiltLine,
    );

  const totals = totalsFromBuiltLines(
    linesForTotals,
    company.taxStatus,
    input.clearDeliveryOverride ? null : deliveryOverride,
  );

  let expiresAt = existing.expiresAt;
  if (input.validUntil) expiresAt = validUntilFromDateOnly(input.validUntil);
  else if (input.validityDays)
    expiresAt = validUntilFromDateOnly(addCalendarDaysDateOnly(new Date(), input.validityDays));

  const updated = await prisma.$transaction(async (tx) => {
    if (builtLines) {
      await tx.quoteItem.deleteMany({ where: { quoteId: existing.id } });
      if (builtLines.length) {
        await tx.quoteItem.createMany({
          data: builtLines.map((l) => ({
            quoteId: existing.id,
            variantId: l.variantId,
            productId: l.productId,
            sku: l.sku,
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
            normalUnitPrice: l.normalUnitPrice,
            customerUnitPrice: l.customerUnitPrice,
            normalCustomerUnitPrice: l.normalCustomerUnitPrice,
            priceOverride: l.priceOverride,
            priceOverrideById: l.priceOverride ? actorUserId : null,
            vatRate: l.vatRate,
            vatCode: l.vatCode,
            lineTotal: l.lineTotal,
            lineVat: l.lineVat,
            lineGross: l.lineGross,
            caseQty: l.caseQty,
            orderingMode: l.orderingMode,
            priceSource: l.priceSource,
            quantityBreakId: l.quantityBreakId,
            promotionId: l.promotionId,
            sortOrder: l.sortOrder,
          })),
        });
        for (const l of builtLines.filter((x) => x.priceOverride)) {
          await recordAuditEvent({
            action: "quote.price_override",
            entityType: "Quote",
            entityId: existing.id,
            actorUserId,
            companyId: company.id,
            after: {
              sku: l.sku,
              normalUnitPrice: l.normalUnitPrice,
              quotedUnitPrice: l.unitPrice,
            },
          });
        }
      }
    }

    if (input.deliveryAddressId !== undefined && input.deliveryAddressId) {
      const addr = await tx.address.findFirst({
        where: { id: input.deliveryAddressId, companyId: company.id },
      });
      if (!addr) throw new AuthError("Delivery address not found", "NOT_FOUND", 404);
      await tx.quote.update({
        where: { id: existing.id },
        data: {
          deliveryAddressId: addr.id,
          deliveryAddress: {
            line1: addr.line1,
            line2: addr.line2,
            town: addr.town,
            county: addr.county,
            postcode: addr.postcode,
            country: addr.country,
            contactName: addr.contactName,
            contactPhone: addr.contactPhone,
          },
        },
      });
    }

    return tx.quote.update({
      where: { id: existing.id },
      data: {
        subtotal: totals.subtotal,
        deliveryTotal: totals.deliveryTotal,
        vatTotal: totals.vatTotal,
        grandTotal: totals.grandTotal,
        deliveryOverridden: totals.deliveryOverridden,
        deliveryOverrideById: totals.deliveryOverridden ? actorUserId : null,
        expiresAt,
        ...(input.customerNotes !== undefined ? { customerNotes: input.customerNotes } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
        ...(input.poNumber !== undefined ? { poNumber: input.poNumber } : {}),
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      },
      include: quoteInclude,
    });
  });

  await recordAuditEvent({
    action: "quote.edited",
    entityType: "Quote",
    entityId: updated.id,
    actorUserId,
    companyId: company.id,
    after: { grandTotal: money2(updated.grandTotal), lineCount: updated.items.length },
  });

  return serializeQuote(updated);
}

export async function getQuoteForStaff(actorUserId: string, quoteId: string) {
  await requireQuoteStaff(actorUserId, "quotes.view");
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: quoteInclude,
  });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await assertCompanyInSalesScope(actorUserId, quote.companyId);
  return serializeQuote(quote);
}

export async function listQuotesForStaff(actorUserId: string, raw?: unknown) {
  await requireQuoteStaff(actorUserId, "quotes.view");
  const query = quoteListQuerySchema.parse(raw ?? {});
  const profile = await loadAccessProfile(actorUserId);
  if (!profile) throw new AuthError("Not authenticated", "UNAUTHORIZED", 401);

  const scope = await getAccessibleCompanyIdsForSales(profile);
  const where: Prisma.QuoteWhereInput = {};
  if (scope !== "all") {
    where.companyId = { in: scope };
  }
  if (query.companyId) {
    if (scope !== "all" && !scope.includes(query.companyId)) {
      throw new AuthError("Company is outside your sales scope", "FORBIDDEN", 403);
    }
    where.companyId = query.companyId;
  }
  if (query.status) where.status = query.status;
  if (query.q?.trim()) {
    const q = query.q.trim();
    where.OR = [
      { quoteNumber: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
      { poNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  if (query.expiringSoon) {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 7);
    where.status = { in: ["SENT", "VIEWED"] };
    where.expiresAt = { lte: soon, gte: new Date() };
  }

  const [total, rows] = await prisma.$transaction([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: quoteInclude,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((r) => serializeQuote(r)),
  };
}

export async function sendQuote(actorUserId: string, raw: unknown) {
  await requireQuoteStaff(actorUserId, "quotes.send");
  const input = quoteSendSchema.parse(raw);
  const quote = await prisma.quote.findUnique({
    where: { id: input.id },
    include: { items: true, company: true },
  });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await assertCompanyInSalesScope(actorUserId, quote.companyId);
  if (quote.status !== "DRAFT" && quote.status !== "SENT") {
    throw new AuthError("Only draft or sent quotes can be (re)sent", "CONFLICT", 409);
  }
  if (!quote.items.length) {
    throw new AuthError("Add at least one product before sending", "VALIDATION", 400);
  }
  if (!quote.expiresAt) {
    throw new AuthError("Set a validity date before sending", "VALIDATION", 400);
  }

  const contact = (quote.contactSnapshot ?? {}) as { email?: string | null; name?: string | null };
  const toEmail =
    input.toEmail?.toLowerCase() ||
    contact.email?.toLowerCase() ||
    quote.company.primaryEmail?.toLowerCase();
  if (!toEmail) {
    throw new AuthError("No recipient email on quote contact or company", "VALIDATION", 400);
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: quote.status === "DRAFT" ? "SENT" : quote.status,
      sentAt: quote.sentAt ?? new Date(),
      sentById: actorUserId,
    },
    include: quoteInclude,
  });

  await recordAuditEvent({
    action: quote.status === "DRAFT" ? "quote.sent" : "quote.resent",
    entityType: "Quote",
    entityId: quote.id,
    actorUserId,
    companyId: quote.companyId,
    after: { toEmail, status: updated.status },
  });

  let emailSent = false;
  try {
    const { sendQuoteSentEmail } = await import("@/server/quotes/quote-email");
    emailSent = await sendQuoteSentEmail(quote.id, toEmail);
  } catch {
    emailSent = false;
  }

  return { quote: serializeQuote(updated), emailSent, toEmail };
}

export async function markQuoteViewedByCustomer(userId: string, quoteId: string) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await requireCompanyPermission(userId, quote.companyId, "quotes.view");

  if (quote.status === "SENT" && !quote.firstViewedAt) {
    const updated = await prisma.quote.updateMany({
      where: { id: quoteId, status: "SENT", firstViewedAt: null },
      data: { status: "VIEWED", firstViewedAt: new Date() },
    });
    if (updated.count > 0) {
      await recordAuditEvent({
        action: "quote.viewed",
        entityType: "Quote",
        entityId: quoteId,
        actorUserId: userId,
        companyId: quote.companyId,
      });
    }
  }

  const fresh = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: quoteInclude,
  });
  return serializeQuote(fresh, { customerView: true });
}

export async function listQuotesForPortal(userId: string) {
  const profile = await loadAccessProfile(userId);
  if (!profile) throw new AuthError("Not authenticated", "UNAUTHORIZED", 401);
  const membership =
    profile.companyMemberships.find((m) => m.isDefault && m.status === "ACTIVE") ??
    profile.companyMemberships.find((m) => m.status === "ACTIVE");
  if (!membership) throw new AuthError("No active company membership", "FORBIDDEN", 403);
  await requireCompanyPermission(userId, membership.companyId, "quotes.view");

  const rows = await prisma.quote.findMany({
    where: {
      companyId: membership.companyId,
      status: { in: ["SENT", "VIEWED", "ACCEPTED", "DECLINED", "REJECTED", "EXPIRED", "CONVERTED"] },
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    include: quoteInclude,
  });
  return rows.map((r) => serializeQuote(r, { customerView: true }));
}

export async function getQuoteForPortal(userId: string, quoteId: string) {
  const quote = await markQuoteViewedByCustomer(userId, quoteId);
  const { resolveAccountManagerForCompany, resolveAccountManagerForSalesRep } = await import(
    "@/server/sales/account-manager"
  );
  // Prefer live company assignment; fall back to snapshotted sales rep id.
  let accountManager = await resolveAccountManagerForCompany(quote.companyId);
  if (!accountManager) {
    const raw = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: { salesRepIdSnapshot: true },
    });
    if (raw?.salesRepIdSnapshot) {
      accountManager = await resolveAccountManagerForSalesRep(raw.salesRepIdSnapshot);
    }
  }
  return { ...quote, accountManager };
}

export async function declineQuote(userId: string, raw: unknown) {
  const input = quoteDeclineSchema.parse(raw);
  const quote = await prisma.quote.findUnique({ where: { id: input.id } });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await requireCompanyPermission(userId, quote.companyId, "quotes.accept");
  if (!customerCanRespond(quote.status, quote.expiresAt)) {
    throw new AuthError("This quotation cannot be declined", "CONFLICT", 409);
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "DECLINED",
      declinedAt: new Date(),
      declineReason: input.reason ?? null,
    },
    include: quoteInclude,
  });

  await recordAuditEvent({
    action: "quote.declined",
    entityType: "Quote",
    entityId: quote.id,
    actorUserId: userId,
    companyId: quote.companyId,
    after: { reason: input.reason ?? null },
  });

  try {
    const { sendQuoteDeclinedInternalEmail } = await import("@/server/quotes/quote-email");
    await sendQuoteDeclinedInternalEmail(quote.id);
  } catch {
    /* non-fatal */
  }

  return serializeQuote(updated, { customerView: true });
}

async function convertQuoteToOrder(input: {
  quoteId: string;
  actorUserId: string;
  idempotencyKey: string;
  staffAcceptance: boolean;
  acceptanceNote?: string | null;
}) {
  const quote = await prisma.quote.findUnique({
    where: { id: input.quoteId },
    include: { items: { orderBy: { sortOrder: "asc" } }, company: true },
  });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);

  if (quote.status === "CONVERTED" && quote.convertedOrderId) {
    const order = await prisma.order.findUnique({
      where: { id: quote.convertedOrderId },
      select: { id: true, orderNumber: true },
    });
    if (order) {
      return { alreadyConverted: true as const, orderId: order.id, orderNumber: order.orderNumber };
    }
  }

  if (quote.acceptIdempotencyKey === input.idempotencyKey && quote.convertedOrderId) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: quote.convertedOrderId },
      select: { id: true, orderNumber: true },
    });
    return { alreadyConverted: true as const, orderId: order.id, orderNumber: order.orderNumber };
  }

  const effectiveStatus = isQuoteExpired(quote.expiresAt) ? "EXPIRED" : quote.status;
  if (effectiveStatus === "EXPIRED") {
    if (quote.status !== "EXPIRED") {
      await prisma.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
    }
    throw new AuthError("This quotation has expired", "QUOTE_EXPIRED", 409);
  }
  if (quote.status === "DECLINED" || quote.status === "REJECTED") {
    throw new AuthError("This quotation was declined", "QUOTE_DECLINED", 409);
  }
  if (quote.status !== "SENT" && quote.status !== "VIEWED" && quote.status !== "ACCEPTED") {
    throw new AuthError("This quotation cannot be accepted", "CONFLICT", 409);
  }
  if (quote.company.status !== "ACTIVE") {
    throw new AuthError("Company is not eligible to order", "COMPANY_NOT_ACTIVE", 400);
  }
  if (!quote.items.length) {
    throw new AuthError("Quote has no lines", "VALIDATION", 400);
  }

  // Revalidate stock + case rules (prices stay from quote snapshots).
  const variantIds = quote.items.map((i) => i.variantId).filter(Boolean) as string[];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: { select: { isActive: true, status: true, name: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const stockMap = await loadStockByVariantIds(variantIds);
  const stockIssues: Array<{ sku: string; name: string; qty: number; available: number }> = [];

  for (const item of quote.items) {
    if (!item.variantId) {
      stockIssues.push({ sku: item.sku, name: item.name, qty: item.qty, available: 0 });
      continue;
    }
    const variant = byId.get(item.variantId);
    if (!variant || !variant.product.isActive || variant.product.status !== "ACTIVE") {
      stockIssues.push({ sku: item.sku, name: item.name, qty: item.qty, available: 0 });
      continue;
    }
    const stock = stockMap.get(item.variantId);
    const sellable = sellableFromStock(stock);
    const orderableByStock = stock ? isOrderableByStockPolicy(stock) : false;
    const qtyIssue = assessBasketLineQuantity({
      quantity: item.qty,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty: sellable,
      productActive: variant.product.isActive && variant.product.status === "ACTIVE",
      tradeVisible: true,
      orderableByStockPolicy: orderableByStock,
      hasTradePrice: true,
    });
    if (qtyIssue !== "VALID" || sellable < item.qty) {
      stockIssues.push({
        sku: item.sku,
        name: item.name,
        qty: item.qty,
        available: sellable,
      });
    }
  }

  if (stockIssues.length) {
    const detail = stockIssues.map((i) => `${i.sku} (need ${i.qty}, available ${i.available})`).join("; ");
    throw new AuthError(
      `Some items on this quotation are no longer available in the quoted quantity. Please contact your account manager so we can update the quotation. Affected: ${detail}`,
      "QUOTE_STOCK_UNAVAILABLE",
      409,
    );
  }

  const verifiedCode =
    quote.company.autopartCustomerCodeVerifiedAt && quote.company.autopartCustomerCode
      ? quote.company.autopartCustomerCode
      : null;

  const created = await prisma.$transaction(async (tx) => {
    // Claim the quote atomically so concurrent accepts cannot both convert.
    const claim = await tx.quote.updateMany({
      where: {
        id: quote.id,
        status: { in: ["SENT", "VIEWED", "ACCEPTED"] },
        convertedOrderId: null,
      },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedByUserId: input.staffAcceptance ? null : input.actorUserId,
        acceptedByStaffId: input.staffAcceptance ? input.actorUserId : null,
        acceptanceNote: input.acceptanceNote ?? null,
        acceptIdempotencyKey: input.idempotencyKey,
      },
    });

    if (claim.count === 0) {
      const locked = await tx.quote.findUnique({ where: { id: quote.id } });
      if (!locked) throw new AuthError("Quote not found", "NOT_FOUND", 404);
      if (locked.convertedOrderId) {
        const order = await tx.order.findUnique({
          where: { id: locked.convertedOrderId },
          select: { id: true, orderNumber: true },
        });
        if (order) return { kind: "existing" as const, order };
      }
      if (locked.acceptIdempotencyKey === input.idempotencyKey) {
        // Same idempotency key raced — wait for converted order via unique order key.
        const order = await tx.order.findUnique({
          where: { idempotencyKey: `quote-accept:${input.idempotencyKey}` },
          select: { id: true, orderNumber: true },
        });
        if (order) return { kind: "existing" as const, order };
      }
      throw new AuthError("This quotation cannot be accepted", "CONFLICT", 409);
    }

    const existingOrder = await tx.order.findUnique({
      where: { idempotencyKey: `quote-accept:${input.idempotencyKey}` },
      select: { id: true, orderNumber: true },
    });
    if (existingOrder) {
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
          convertedOrderId: existingOrder.id,
        },
      });
      return { kind: "existing" as const, order: existingOrder };
    }

    const orderNumber = await allocateOrderNumber(tx);
    const placedAt = new Date();
    const order = await tx.order.create({
      data: {
        orderNumber,
        companyId: quote.companyId,
        status: "SUBMITTED",
        poNumber: quote.poNumber,
        orderedByUserId: input.actorUserId,
        onBehalfOfUserId: input.staffAcceptance ? input.actorUserId : null,
        currency: quote.currency,
        subtotal: quote.subtotal,
        vatTotal: quote.vatTotal,
        deliveryTotal: quote.deliveryTotal,
        grandTotal: quote.grandTotal,
        deliveryAddress: quote.deliveryAddress as Prisma.InputJsonValue,
        contactSnapshot: quote.contactSnapshot as Prisma.InputJsonValue,
        paymentTermsSnapshot: quote.paymentTermsSnapshot,
        autopartCustomerCodeSnapshot: verifiedCode,
        autopartAccountLinked: Boolean(verifiedCode),
        salesRepIdSnapshot: quote.salesRepIdSnapshot,
        salesRepCodeSnapshot: quote.salesRepCodeSnapshot,
        salesRepNameSnapshot: quote.salesRepNameSnapshot,
        deliveryMethodLabel: "Standard delivery",
        sourceQuoteId: quote.id,
        sourceQuoteNumber: quote.quoteNumber,
        idempotencyKey: `quote-accept:${input.idempotencyKey}`,
        placedAt,
        items: {
          create: quote.items.map((item) => ({
            variantId: item.variantId,
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            qty: item.qty,
            unitPrice: item.unitPrice,
            customerUnitPrice: item.customerUnitPrice,
            discountPct: item.discountPct,
            vatRate: item.vatRate,
            vatCode: item.vatCode,
            lineTotal: item.lineTotal,
            lineVat: item.lineVat,
            lineGross: item.lineGross,
            caseQty: item.caseQty,
            orderingMode: item.orderingMode,
            priceSource: item.priceSource ?? "QUOTE",
            quantityBreakId: item.quantityBreakId,
            promotionId: item.promotionId,
          })),
        },
      },
      include: { items: true },
    });

    await reserveStockForOrder(tx, {
      orderId: order.id,
      lines: order.items
        .filter((i) => i.variantId)
        .map((item) => ({
          orderItemId: item.id,
          variantId: item.variantId!,
          quantity: item.qty,
        })),
    });

    await tx.quote.update({
      where: { id: quote.id },
      data: {
        status: "CONVERTED",
        convertedAt: placedAt,
        convertedOrderId: order.id,
      },
    });

    return { kind: "created" as const, order };
  });

  if (created.kind === "existing") {
    return {
      alreadyConverted: true as const,
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
    };
  }

  await recordAuditEvent({
    action: "quote.converted",
    entityType: "Quote",
    entityId: quote.id,
    actorUserId: input.actorUserId,
    companyId: quote.companyId,
    after: {
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
      staffAcceptance: input.staffAcceptance,
    },
  });
  await recordAuditEvent({
    action: "order.created",
    entityType: "Order",
    entityId: created.order.id,
    actorUserId: input.actorUserId,
    companyId: quote.companyId,
    after: {
      orderNumber: created.order.orderNumber,
      status: "SUBMITTED",
      sourceQuoteNumber: quote.quoteNumber,
      autopartSideEffects: false,
      abReservation: true,
    },
  });

  try {
    await sendOrderEmailsAfterCommit(created.order.id);
  } catch {
    /* non-fatal */
  }

  return {
    alreadyConverted: false as const,
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
  };
}

export async function acceptQuoteAsCustomer(userId: string, raw: unknown) {
  const input = quoteAcceptSchema.parse(raw);
  const quote = await prisma.quote.findUnique({ where: { id: input.id } });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await requireCompanyPermission(userId, quote.companyId, "quotes.accept");

  try {
    const result = await convertQuoteToOrder({
      quoteId: input.id,
      actorUserId: userId,
      idempotencyKey: input.idempotencyKey,
      staffAcceptance: false,
      acceptanceNote: input.note ?? null,
    });
    const fresh = await prisma.quote.findUniqueOrThrow({
      where: { id: input.id },
      include: quoteInclude,
    });
    return { quote: serializeQuote(fresh, { customerView: true }), ...result };
  } catch (error) {
    if (error instanceof AuthError && error.code === "QUOTE_STOCK_UNAVAILABLE") {
      throw error;
    }
    throw error;
  }
}

export async function acceptQuoteOnBehalf(actorUserId: string, raw: unknown) {
  await requireQuoteStaff(actorUserId, "quotes.accept_on_behalf");
  const input = quoteAcceptOnBehalfSchema.parse(raw);
  const quote = await prisma.quote.findUnique({ where: { id: input.id } });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await assertCompanyInSalesScope(actorUserId, quote.companyId);

  const result = await convertQuoteToOrder({
    quoteId: input.id,
    actorUserId,
    idempotencyKey: input.idempotencyKey,
    staffAcceptance: true,
    acceptanceNote: input.note,
  });
  const fresh = await prisma.quote.findUniqueOrThrow({
    where: { id: input.id },
    include: quoteInclude,
  });
  return { quote: serializeQuote(fresh), ...result };
}

export async function duplicateQuote(actorUserId: string, raw: unknown) {
  await requireQuoteStaff(actorUserId, "quotes.create");
  const input = quoteIdSchema.parse(raw);
  const source = await prisma.quote.findUnique({
    where: { id: input.id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await assertCompanyInSalesScope(actorUserId, source.companyId);

  const draft = await createQuote(actorUserId, {
    companyId: source.companyId,
    contactId: source.contactId,
    deliveryAddressId: source.deliveryAddressId,
    poNumber: source.poNumber,
    customerNotes: source.customerNotes,
    internalNotes: source.internalNotes
      ? `${source.internalNotes}\n\nDuplicated from ${source.quoteNumber}`
      : `Duplicated from ${source.quoteNumber}`,
    validityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
  });

  if (source.items.length) {
    await updateQuoteDraft(actorUserId, {
      id: draft.id,
      lines: source.items
        .filter((i) => i.variantId)
        .map((i) => ({
          variantId: i.variantId!,
          qty: i.qty,
          // Re-resolve pricing — do not carry old negotiated prices automatically
          quotedUnitPrice: null,
        })),
    });
  }

  await prisma.quote.update({
    where: { id: draft.id },
    data: { revisionOfQuoteId: source.id },
  });

  await recordAuditEvent({
    action: "quote.duplicated",
    entityType: "Quote",
    entityId: draft.id,
    actorUserId,
    companyId: source.companyId,
    after: { fromQuoteNumber: source.quoteNumber, newQuoteNumber: draft.quoteNumber },
  });

  return getQuoteForStaff(actorUserId, draft.id);
}

export async function searchQuoteProducts(
  actorUserId: string,
  raw: { companyId: string; q: string },
) {
  await requireQuoteStaff(actorUserId, "quotes.create");
  await assertCompanyInSalesScope(actorUserId, raw.companyId);
  const q = raw.q.trim();
  if (q.length < 1) return [];

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: { isActive: true, status: "ACTIVE", isTradeVisible: true },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { brand: { name: { contains: q, mode: "insensitive" } } } },
      ],
    },
    take: 20,
    include: {
      product: {
        select: {
          id: true,
          name: true,
          brand: { select: { name: true } },
        },
      },
    },
    orderBy: { sku: "asc" },
  });

  const prices = await resolveVariantTradePrices({
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      tradePrice: String(v.tradePrice),
      vatCode: v.vatCode,
    })),
    companyId: raw.companyId,
    quantity: 1,
  });
  const stockMap = await loadStockByVariantIds(variants.map((v) => v.id));

  return variants.map((v) => {
    const price = prices.get(v.id);
    const stock = stockMap.get(v.id);
    const sellable = sellableFromStock(stock);
    return {
      variantId: v.id,
      productId: v.productId,
      sku: v.sku,
      name: v.product.name,
      brand: v.product.brand?.name ?? null,
      caseQty: v.caseQty,
      unitPrice: price?.unitPriceExVat ?? null,
      customerUnitPrice: price
        ? moneyToString(toCustomerSellUnitPrice(parseMoney(price.unitPriceExVat)!), 2)
        : null,
      priceSource: price?.source ?? null,
      sellableQty: sellable,
      availability: stock?.availability ?? (sellable > 0 ? "IN_STOCK" : "OUT_OF_STOCK"),
    };
  });
}

export async function getCompanyQuoteContext(actorUserId: string, companyId: string) {
  await requireQuoteStaff(actorUserId, "quotes.view");
  await assertCompanyInSalesScope(actorUserId, companyId);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      taxStatus: true,
      paymentTerms: true,
      priceListId: true,
      primaryEmail: true,
      autopartCustomerCodeVerifiedAt: true,
      priceList: { select: { id: true, code: true, name: true } },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const [contacts, addresses, salesRep] = await Promise.all([
    prisma.contact.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isPrimary: true,
      },
    }),
    prisma.address.findMany({
      where: { companyId },
      orderBy: [{ isDefaultDelivery: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        label: true,
        line1: true,
        line2: true,
        town: true,
        county: true,
        postcode: true,
        country: true,
        contactName: true,
        contactPhone: true,
        isDefaultDelivery: true,
      },
    }),
    loadPrimarySalesRepSnapshot(companyId),
  ]);

  return {
    id: company.id,
    name: company.name,
    status: company.status,
    taxStatus: company.taxStatus,
    paymentTerms: company.paymentTerms,
    primaryEmail: company.primaryEmail,
    priceList: company.priceList,
    autopartAccountLinked: Boolean(company.autopartCustomerCodeVerifiedAt),
    salesRep: {
      id: salesRep.salesRepIdSnapshot,
      code: salesRep.salesRepCodeSnapshot,
      name: salesRep.salesRepNameSnapshot,
    },
    contacts: contacts.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
    })),
    addresses,
  };
}

export async function listQuoteEmailsForStaff(actorUserId: string, quoteId: string) {
  await requireQuoteStaff(actorUserId, "quotes.view");
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { id: true, companyId: true } });
  if (!quote) throw new AuthError("Quote not found", "NOT_FOUND", 404);
  await assertCompanyInSalesScope(actorUserId, quote.companyId);

  const rows = await prisma.transactionalEmail.findMany({
    where: { entityType: "Quote", entityId: quoteId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      purpose: true,
      status: true,
      toEmail: true,
      subject: true,
      sentAt: true,
      lastError: true,
      createdAt: true,
      attemptCount: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    purpose: r.purpose,
    status: r.status,
    toEmail: r.toEmail,
    subject: r.subject,
    sentAt: r.sentAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
    attemptCount: r.attemptCount,
  }));
}
