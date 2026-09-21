import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, loadAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import {
  customerPriceWriteSchema,
  priceAsCustomerSchema,
  priceListCodeFromName,
  priceListItemWriteSchema,
  priceListWriteSchema,
  promotionWriteSchema,
  quantityBreakWriteSchema,
} from "@/domain/pricing-admin";
import { moneyNumber } from "@/server/pricing/trade-price";
import { loadTradePriceFactsForVariants } from "@/server/pricing/resolve-trade-price";
import { resolveTradePriceFromFacts } from "@/domain/trade-price-resolution";

function moneyInput(n: number) {
  return n.toFixed(4);
}

export async function listPriceLists(actorUserId: string) {
  await requireSystemPermission(actorUserId, "pricing.view");
  const rows = await prisma.priceList.findMany({
    orderBy: [{ isDefault: "desc" }, { code: "asc" }],
    include: { _count: { select: { items: true, companies: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    isDefault: row.isDefault,
    itemCount: row._count.items,
    companyCount: row._count.companies,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertPriceList(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const input = priceListWriteSchema.parse(raw);
  const code = priceListCodeFromName(input.name, input.code);
  const existing = input.id
    ? await prisma.priceList.findUnique({ where: { id: input.id } })
    : await prisma.priceList.findUnique({ where: { code } });

  if (input.isDefault) {
    await prisma.priceList.updateMany({ data: { isDefault: false }, where: { isDefault: true } });
  }

  const row = existing
    ? await prisma.priceList.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          code,
          currency: input.currency ?? "GBP",
          isDefault: input.isDefault ?? existing.isDefault,
        },
      })
    : await prisma.priceList.create({
        data: { name: input.name, code, currency: input.currency ?? "GBP", isDefault: input.isDefault ?? false },
      });

  await recordAuditEvent({
    action: existing ? "pricing.price_list.updated" : "pricing.price_list.created",
    entityType: "PriceList",
    entityId: row.id,
    actorUserId,
    after: { code: row.code, name: row.name, isDefault: row.isDefault },
    before: existing ? { code: existing.code, name: existing.name, isDefault: existing.isDefault } : null,
  });
  return { id: row.id, code: row.code, name: row.name, currency: row.currency, isDefault: row.isDefault };
}

export async function listPriceListItems(actorUserId: string, priceListId: string) {
  await requireSystemPermission(actorUserId, "pricing.view");
  const items = await prisma.priceListItem.findMany({
    where: { priceListId },
    include: { variant: { select: { sku: true, product: { select: { name: true } } } } },
    orderBy: { variant: { sku: "asc" } },
  });
  return items.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.variant.sku,
    productName: row.variant.product.name,
    unitPrice: moneyNumber(row.unitPrice),
  }));
}

export async function upsertPriceListItem(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const input = priceListItemWriteSchema.parse(raw);
  const before = await prisma.priceListItem.findUnique({
    where: { priceListId_variantId: { priceListId: input.priceListId, variantId: input.variantId } },
  });
  const row = await prisma.priceListItem.upsert({
    where: { priceListId_variantId: { priceListId: input.priceListId, variantId: input.variantId } },
    create: { priceListId: input.priceListId, variantId: input.variantId, unitPrice: moneyInput(input.unitPrice) },
    update: { unitPrice: moneyInput(input.unitPrice) },
  });
  await recordAuditEvent({
    action: before ? "pricing.price_list_item.updated" : "pricing.price_list_item.created",
    entityType: "PriceListItem",
    entityId: row.id,
    actorUserId,
    before: before ? { unitPrice: moneyNumber(before.unitPrice) } : null,
    after: { unitPrice: moneyNumber(row.unitPrice), variantId: row.variantId, priceListId: row.priceListId },
  });
  return { id: row.id, unitPrice: moneyNumber(row.unitPrice) };
}

export async function deletePriceListItem(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const before = await prisma.priceListItem.findUnique({ where: { id } });
  if (!before) throw new AuthError("Price list item not found", "NOT_FOUND", 404);
  await prisma.priceListItem.delete({ where: { id } });
  await recordAuditEvent({
    action: "pricing.price_list_item.removed",
    entityType: "PriceListItem",
    entityId: id,
    actorUserId,
    before: { variantId: before.variantId, priceListId: before.priceListId, unitPrice: moneyNumber(before.unitPrice) },
  });
  return { ok: true as const };
}

export async function listCustomerPrices(actorUserId: string, companyId: string) {
  await requireAnySystemPermission(actorUserId, ["pricing.view", "companies.view"]);
  const rows = await prisma.customerPrice.findMany({
    where: { companyId },
    include: { variant: { select: { sku: true, product: { select: { name: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    sku: row.variant.sku,
    productName: row.variant.product.name,
    unitPrice: moneyNumber(row.unitPrice),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  }));
}

export async function upsertCustomerPrice(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const input = customerPriceWriteSchema.parse(raw);
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  const before = await prisma.customerPrice.findUnique({
    where: { companyId_variantId: { companyId: input.companyId, variantId: input.variantId } },
  });
  const row = await prisma.customerPrice.upsert({
    where: { companyId_variantId: { companyId: input.companyId, variantId: input.variantId } },
    create: {
      companyId: input.companyId,
      variantId: input.variantId,
      unitPrice: moneyInput(input.unitPrice),
      startsAt,
      endsAt,
    },
    update: { unitPrice: moneyInput(input.unitPrice), startsAt, endsAt },
  });
  await recordAuditEvent({
    action: before ? "pricing.customer_price.updated" : "pricing.customer_price.created",
    entityType: "CustomerPrice",
    entityId: row.id,
    actorUserId,
    companyId: input.companyId,
    after: { unitPrice: moneyNumber(row.unitPrice), variantId: row.variantId },
  });
  return { id: row.id, unitPrice: moneyNumber(row.unitPrice) };
}

export async function deleteCustomerPrice(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const before = await prisma.customerPrice.findUnique({ where: { id } });
  if (!before) throw new AuthError("Customer price not found", "NOT_FOUND", 404);
  await prisma.customerPrice.delete({ where: { id } });
  await recordAuditEvent({
    action: "pricing.customer_price.removed",
    entityType: "CustomerPrice",
    entityId: id,
    actorUserId,
    companyId: before.companyId,
    before: { variantId: before.variantId, unitPrice: moneyNumber(before.unitPrice) },
  });
  return { ok: true as const };
}

export async function listPromotions(actorUserId: string) {
  await requireSystemPermission(actorUserId, "pricing.view");
  const rows = await prisma.promotion.findMany({ orderBy: { code: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    value: moneyNumber(row.value),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isActive: row.isActive,
    metadata: row.metadata,
  }));
}

export async function upsertPromotion(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const input = promotionWriteSchema.parse(raw);
  const metadata = {
    ...(input.variantIds?.length ? { variantIds: input.variantIds } : {}),
    ...(input.skus?.length ? { skus: input.skus } : {}),
  };
  const existing = input.id
    ? await prisma.promotion.findUnique({ where: { id: input.id } })
    : await prisma.promotion.findUnique({ where: { code: input.code.toUpperCase() } });
  const data = {
    code: input.code.toUpperCase(),
    name: input.name,
    type: input.type,
    value: moneyInput(input.value),
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    isActive: input.isActive ?? true,
    metadata,
  };
  const row = existing
    ? await prisma.promotion.update({ where: { id: existing.id }, data })
    : await prisma.promotion.create({ data });
  await recordAuditEvent({
    action: existing ? "pricing.promotion.updated" : "pricing.promotion.created",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: { code: row.code, type: row.type, isActive: row.isActive },
  });
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    value: moneyNumber(row.value),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isActive: row.isActive,
  };
}

export async function listQuantityBreaks(actorUserId: string, variantId: string) {
  await requireSystemPermission(actorUserId, "pricing.view");
  const rows = await prisma.quantityBreak.findMany({
    where: { variantId },
    orderBy: { minQty: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    minQty: row.minQty,
    unitPrice: moneyNumber(row.unitPrice),
    isBaseMirror: row.minQty <= 1,
  }));
}

export async function upsertQuantityBreak(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const input = quantityBreakWriteSchema.parse(raw);
  const before = await prisma.quantityBreak.findUnique({
    where: { variantId_minQty: { variantId: input.variantId, minQty: input.minQty } },
  });
  const row = await prisma.quantityBreak.upsert({
    where: { variantId_minQty: { variantId: input.variantId, minQty: input.minQty } },
    create: { variantId: input.variantId, minQty: input.minQty, unitPrice: moneyInput(input.unitPrice) },
    update: { unitPrice: moneyInput(input.unitPrice) },
  });
  await recordAuditEvent({
    action: before ? "pricing.quantity_break.updated" : "pricing.quantity_break.created",
    entityType: "QuantityBreak",
    entityId: row.id,
    actorUserId,
    after: { minQty: row.minQty, unitPrice: moneyNumber(row.unitPrice), variantId: row.variantId },
  });
  return { id: row.id, minQty: row.minQty, unitPrice: moneyNumber(row.unitPrice) };
}

export async function deleteQuantityBreak(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "pricing.edit");
  const before = await prisma.quantityBreak.findUnique({ where: { id } });
  if (!before) throw new AuthError("Quantity break not found", "NOT_FOUND", 404);
  if (before.minQty <= 1) {
    throw new AuthError("The minQty=1 break mirrors base trade price and cannot be removed here", "VALIDATION", 400);
  }
  await prisma.quantityBreak.delete({ where: { id } });
  await recordAuditEvent({
    action: "pricing.quantity_break.removed",
    entityType: "QuantityBreak",
    entityId: id,
    actorUserId,
    before: { minQty: before.minQty, variantId: before.variantId },
  });
  return { ok: true as const };
}

export async function searchVariantsForPricing(actorUserId: string, q: string) {
  await requireSystemPermission(actorUserId, "pricing.view");
  const needle = q.trim();
  if (needle.length < 1) return [];
  const rows = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      OR: [
        { sku: { contains: needle, mode: "insensitive" } },
        { product: { name: { contains: needle, mode: "insensitive" } } },
      ],
    },
    take: 20,
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, sku: row.sku, name: row.product.name }));
}

export async function previewTradePriceAsCustomer(actorUserId: string, raw: unknown) {
  const profile = await loadAccessProfile(actorUserId);
  if (!profile) throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  if (!hasPermission(profile, "pricing.view") && !hasPermission(profile, "admin.access")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  const input = priceAsCustomerSchema.parse(raw);
  if (profile.actorType === "TRADE") {
    const member = profile.companyMemberships.some((m) => m.companyId === input.companyId);
    if (!member) throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  } else {
    const companyOk =
      hasPermission(profile, "admin.access") ||
      hasPermission(profile, "pricing.edit") ||
      (await canAccessCompanyAsSales(profile, input.companyId));
    if (!companyOk) {
      throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
    }
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, sku: true, tradePrice: true, vatCode: true, rrp: true },
  });
  if (!variant) throw new AuthError("Variant not found", "NOT_FOUND", 404);

  const factsMap = await loadTradePriceFactsForVariants({
    companyId: input.companyId,
    quantity: input.quantity ?? 1,
    variants: [{ id: variant.id, sku: variant.sku, tradePrice: variant.tradePrice, vatCode: variant.vatCode }],
  });
  const facts = factsMap.get(variant.id);
  if (!facts) throw new AuthError("Unable to resolve price", "INTERNAL", 500);
  return {
    resolved: resolveTradePriceFromFacts(facts),
    rrp: moneyNumber(variant.rrp),
    sku: variant.sku,
  };
}
