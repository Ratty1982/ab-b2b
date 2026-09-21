import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, loadAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { updateCompany } from "@/server/companies/service";
import {
  assignCompanyPriceListSchema,
  customerPriceWriteSchema,
  priceAsCustomerSchema,
  priceListCodeFromName,
  priceListCsvApplySchema,
  priceListCsvPreviewSchema,
  priceListItemQuerySchema,
  priceListItemsBulkWriteSchema,
  priceListItemWriteSchema,
  priceListWriteSchema,
  promotionPreviewSchema,
  promotionWriteSchema,
  quantityBreakWriteSchema,
} from "@/domain/pricing-admin";
import {
  caseBreakNote,
  commercialAuditLabel,
  commercialWindowStatus,
  formatGbpFromUnknown,
  parsePriceListImportCsv,
  parsePromotionMetadata,
  priceDifferenceFromUnknown,
  priceListExportCsv,
  previewPromotionUnit,
  promotionDisplayState,
  winningRuleLabel,
} from "@/domain/pricing-management";
import { moneyNumber } from "@/server/pricing/trade-price";
import { loadTradePriceFactsForVariants } from "@/server/pricing/resolve-trade-price";
import { resolveTradePriceFromFacts } from "@/domain/trade-price-resolution";

async function requireInternalPricing(actorUserId: string, permission: "pricing.view" | "pricing.edit") {
  const profile = await requireSystemPermission(actorUserId, permission);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access internal pricing administration", "FORBIDDEN", 403);
  }
  return profile;
}

function moneyInput(n: number) {
  return n.toFixed(4);
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function listPriceLists(actorUserId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
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
    status: row.isDefault ? "Default" : "Live",
    itemCount: row._count.items,
    companyCount: row._count.companies,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function pricingOverview(actorUserId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const at = new Date();
  const [priceLists, customerOverrides, promotions, breakGroups] = await Promise.all([
    prisma.priceList.count(),
    prisma.customerPrice.count(),
    prisma.promotion.findMany({ select: { isActive: true, startsAt: true, endsAt: true } }),
    prisma.quantityBreak.groupBy({
      by: ["variantId"],
      where: { minQty: { gt: 1 } },
    }),
  ]);
  const activePromotions = promotions.filter(
    (row) => promotionDisplayState(at, row.isActive, row.startsAt, row.endsAt) === "active",
  ).length;
  return {
    priceLists,
    customerOverrides,
    activePromotions,
    productsWithQuantityBreaks: breakGroups.length,
  };
}

export async function getPriceList(actorUserId: string, priceListId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const row = await prisma.priceList.findUnique({
    where: { id: priceListId },
    include: { _count: { select: { items: true, companies: true } } },
  });
  if (!row) throw new AuthError("Price list not found", "NOT_FOUND", 404);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    isDefault: row.isDefault,
    status: row.isDefault ? "Default" : "Live",
    itemCount: row._count.items,
    companyCount: row._count.companies,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertPriceList(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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

export async function listPriceListItems(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const query =
    typeof raw === "string"
      ? priceListItemQuerySchema.parse({ priceListId: raw })
      : priceListItemQuerySchema.parse(raw);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const where = {
    AND: [
      { priceListId: query.priceListId },
      ...(query.q
        ? [
            {
              variant: {
                OR: [
                  { sku: { contains: query.q, mode: "insensitive" as const } },
                  { product: { name: { contains: query.q, mode: "insensitive" as const } } },
                ],
              },
            },
          ]
        : []),
      ...(query.brand
        ? [
            {
              variant: {
                product: { brand: { name: { contains: query.brand, mode: "insensitive" as const } } },
              },
            },
          ]
        : []),
    ],
  };
  const [total, items] = await Promise.all([
    prisma.priceListItem.count({ where }),
    prisma.priceListItem.findMany({
      where,
      include: {
        variant: {
          select: {
            sku: true,
            tradePrice: true,
            product: { select: { name: true, status: true, brand: { select: { name: true } } } },
          },
        },
      },
      orderBy: { variant: { sku: "asc" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: items.map((row) => {
      const base = moneyNumber(row.variant.tradePrice);
      const list = moneyNumber(row.unitPrice);
      const diff = priceDifferenceFromUnknown(row.variant.tradePrice, row.unitPrice);
      return {
        id: row.id,
        variantId: row.variantId,
        sku: row.variant.sku,
        productName: row.variant.product.name,
        brand: row.variant.product.brand.name,
        productStatus: row.variant.product.status,
        baseTradePrice: base,
        baseTradePriceDisplay: formatGbpFromUnknown(row.variant.tradePrice),
        unitPrice: list,
        unitPriceDisplay: formatGbpFromUnknown(row.unitPrice),
        differenceAbsolute: diff?.absoluteDisplay ?? null,
        differencePercent: diff?.percentLabel ?? null,
        differenceLabel: diff?.signedDisplay ?? null,
        status: row.variant.product.status === "ACTIVE" ? "Active" : row.variant.product.status,
      };
    }),
  };
}

export async function upsertPriceListItem(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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
  return { id: row.id, unitPrice: moneyNumber(row.unitPrice), created: !before };
}

export async function addPriceListItems(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
  const input = priceListItemsBulkWriteSchema.parse(raw);
  const existing = await prisma.priceListItem.findMany({
    where: { priceListId: input.priceListId, variantId: { in: input.items.map((item) => item.variantId) } },
    select: { variantId: true },
  });
  const existingIds = new Set(existing.map((row) => row.variantId));
  const toCreate = input.items.filter((item) => !existingIds.has(item.variantId));
  const duplicates = input.items.filter((item) => existingIds.has(item.variantId));
  const created = [];
  for (const item of toCreate) {
    created.push(await upsertPriceListItem(actorUserId, { ...item, priceListId: input.priceListId }));
  }
  return {
    created: created.length,
    skippedDuplicates: duplicates.map((item) => item.variantId),
  };
}

export async function bulkUpdatePriceListItems(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
  const input = priceListItemsBulkWriteSchema.parse(raw);
  const updated = [];
  for (const item of input.items) {
    const row = await prisma.priceListItem.findUnique({
      where: { priceListId_variantId: { priceListId: input.priceListId, variantId: item.variantId } },
    });
    if (!row) throw new AuthError("Price list item not found", "NOT_FOUND", 404);
    updated.push(await upsertPriceListItem(actorUserId, { ...item, priceListId: input.priceListId }));
  }
  return { updated: updated.length };
}

export async function deletePriceListItem(actorUserId: string, id: string) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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

export async function listPriceListCompanies(actorUserId: string, priceListId: string, q?: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const needle = q?.trim();
  const rows = await prisma.company.findMany({
    where: {
      priceListId,
      ...(needle
        ? {
            OR: [
              { name: { contains: needle, mode: "insensitive" as const } },
              { accountNumber: { contains: needle, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 100,
    select: {
      id: true,
      name: true,
      accountNumber: true,
      priceListId: true,
      priceList: { select: { id: true, name: true, code: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    accountNumber: row.accountNumber,
    priceListId: row.priceListId,
    priceListName: row.priceList?.name ?? null,
    priceListCode: row.priceList?.code ?? null,
  }));
}

export async function searchCompaniesForPricing(actorUserId: string, q: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const needle = q.trim();
  if (needle.length < 1) return [];
  const rows = await prisma.company.findMany({
    where: {
      OR: [
        { name: { contains: needle, mode: "insensitive" } },
        { accountNumber: { contains: needle, mode: "insensitive" } },
        { tradingName: { contains: needle, mode: "insensitive" } },
      ],
    },
    take: 12,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      accountNumber: true,
      priceListId: true,
      priceList: { select: { name: true, code: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    accountNumber: row.accountNumber,
    priceListId: row.priceListId,
    currentPriceList: row.priceList ? `${row.priceList.code} — ${row.priceList.name}` : "None",
  }));
}

export async function assignCompanyToPriceList(actorUserId: string, raw: unknown) {
  const profile = await requireInternalPricing(actorUserId, "pricing.edit");
  const input = assignCompanyPriceListSchema.parse(raw);
  if (hasPermission(profile, "companies.edit") || hasPermission(profile, "admin.access")) {
    return updateCompany(actorUserId, { id: input.companyId, priceListId: input.priceListId });
  }
  const before = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!before) throw new AuthError("Company not found", "NOT_FOUND", 404);
  const updated = await prisma.company.update({
    where: { id: input.companyId },
    data: input.priceListId
      ? { priceList: { connect: { id: input.priceListId } } }
      : { priceList: { disconnect: true } },
    select: { id: true, priceListId: true, name: true },
  });
  await recordAuditEvent({
    action: "company.updated",
    entityType: "Company",
    entityId: input.companyId,
    actorUserId,
    companyId: input.companyId,
    before: { priceListId: before.priceListId },
    after: { priceListId: updated.priceListId },
  });
  return updated;
}

export async function exportPriceListCsv(actorUserId: string, priceListId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const items = await prisma.priceListItem.findMany({
    where: { priceListId },
    include: {
      variant: {
        select: { sku: true, tradePrice: true, product: { select: { name: true } } },
      },
    },
    orderBy: { variant: { sku: "asc" } },
  });
  const csv = priceListExportCsv(
    items.map((row) => ({
      sku: row.variant.sku,
      productName: row.variant.product.name,
      baseTradePrice: moneyNumber(row.variant.tradePrice)?.toFixed(4) ?? "",
      priceListPrice: moneyNumber(row.unitPrice)?.toFixed(4) ?? "",
    })),
  );
  return { filename: `price-list-${priceListId}.csv`, csv };
}

export async function previewPriceListCsv(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
  const input = priceListCsvPreviewSchema.parse(raw);
  const parsed = parsePriceListImportCsv(input.csv);
  const skus = parsed.rows.map((row) => row.sku);
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: { OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
        select: { id: true, sku: true, tradePrice: true, product: { select: { name: true } } },
      })
    : [];
  const bySku = new Map(variants.map((row) => [row.sku.toUpperCase(), row]));
  const ready = [];
  const issues = [...parsed.issues];
  for (const row of parsed.rows) {
    const variant = bySku.get(row.sku.toUpperCase());
    if (!variant) {
      issues.push({ line: row.line, sku: row.sku, message: "Unknown SKU — products are not created from import", kind: "unknown_sku" });
      continue;
    }
    ready.push({
      line: row.line,
      sku: variant.sku,
      productName: variant.product.name,
      variantId: variant.id,
      price: Number(row.price),
      baseTradePriceDisplay: formatGbpFromUnknown(variant.tradePrice),
    });
  }
  return { ready, issues, canApply: ready.length > 0 };
}

export async function applyPriceListCsv(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
  const input = priceListCsvApplySchema.parse(raw);
  const variants = await prisma.productVariant.findMany({
    where: {
      OR: input.items.map((item) => ({ sku: { equals: item.sku, mode: "insensitive" as const } })),
    },
    select: { id: true, sku: true },
  });
  const bySku = new Map(variants.map((row) => [row.sku.toUpperCase(), row]));
  let applied = 0;
  const errors: Array<{ sku: string; message: string }> = [];
  for (const item of input.items) {
    const variant = bySku.get(item.sku.toUpperCase());
    if (!variant) {
      errors.push({ sku: item.sku, message: "Unknown SKU" });
      continue;
    }
    await upsertPriceListItem(actorUserId, {
      priceListId: input.priceListId,
      variantId: variant.id,
      unitPrice: item.price,
    });
    applied += 1;
  }
  return { applied, errors };
}

export async function listCustomerPrices(actorUserId: string, companyId: string) {
  const profile = await requireAnySystemPermission(actorUserId, ["pricing.view", "companies.view"]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access internal pricing administration", "FORBIDDEN", 403);
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { priceListId: true, priceList: { select: { name: true, code: true } } },
  });
  const at = new Date();
  const rows = await prisma.customerPrice.findMany({
    where: { companyId },
    include: {
      variant: {
        select: {
          sku: true,
          tradePrice: true,
          product: { select: { name: true, brand: { select: { name: true } } } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const listItems =
    company?.priceListId && rows.length
      ? await prisma.priceListItem.findMany({
          where: { priceListId: company.priceListId, variantId: { in: rows.map((row) => row.variantId) } },
        })
      : [];
  const listByVariant = new Map(listItems.map((row) => [row.variantId, row]));
  return {
    assignedPriceList: company?.priceList
      ? { code: company.priceList.code, name: company.priceList.name, id: company.priceListId }
      : null,
    count: rows.length,
    items: rows.map((row) => {
      const list = listByVariant.get(row.variantId);
      return {
        id: row.id,
        variantId: row.variantId,
        sku: row.variant.sku,
        productName: row.variant.product.name,
        brand: row.variant.product.brand.name,
        baseTradePrice: moneyNumber(row.variant.tradePrice),
        baseTradePriceDisplay: formatGbpFromUnknown(row.variant.tradePrice),
        priceListPrice: list ? moneyNumber(list.unitPrice) : null,
        priceListPriceDisplay: list ? formatGbpFromUnknown(list.unitPrice) : null,
        unitPrice: moneyNumber(row.unitPrice),
        unitPriceDisplay: formatGbpFromUnknown(row.unitPrice),
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
        status: commercialWindowStatus(at, row.startsAt, row.endsAt),
      };
    }),
  };
}

export async function upsertCustomerPrice(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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
    after: {
      unitPrice: moneyNumber(row.unitPrice),
      variantId: row.variantId,
      startsAt: iso(row.startsAt),
      endsAt: iso(row.endsAt),
    },
  });
  return {
    id: row.id,
    unitPrice: moneyNumber(row.unitPrice),
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    status: commercialWindowStatus(new Date(), row.startsAt, row.endsAt),
  };
}

export async function deleteCustomerPrice(actorUserId: string, id: string) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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

function serializePromotion(row: {
  id: string;
  code: string;
  name: string;
  type: "PERCENT" | "FIXED" | "QUANTITY_DEAL";
  value: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  metadata: unknown;
}) {
  const at = new Date();
  const scope = parsePromotionMetadata(row.metadata);
  const engineApplies = row.type !== "QUANTITY_DEAL";
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    typeLabel:
      row.type === "PERCENT"
        ? "Percent off"
        : row.type === "FIXED"
          ? "Fixed amount off per unit"
          : "Quantity deal (not applied)",
    value: moneyNumber(row.value),
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    isActive: row.isActive,
    status: promotionDisplayState(at, row.isActive, row.startsAt, row.endsAt),
    engineApplies,
    engineNote: engineApplies ? null : "Not currently applied by the pricing engine",
    catalogueWide: scope.catalogueWide,
    variantIds: scope.variantIds,
    skus: scope.skus,
  };
}

export async function listPromotions(actorUserId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const rows = await prisma.promotion.findMany({ orderBy: { code: "asc" } });
  return rows.map((row) => serializePromotion(row));
}

export async function upsertPromotion(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
  const input = promotionWriteSchema.parse(raw);
  const existing = input.id
    ? await prisma.promotion.findUnique({ where: { id: input.id } })
    : await prisma.promotion.findUnique({ where: { code: input.code.toUpperCase() } });

  if (input.type === "QUANTITY_DEAL" && !existing) {
    throw new AuthError(
      "QUANTITY_DEAL cannot be created until the pricing engine applies it",
      "VALIDATION",
      400,
    );
  }
  if (input.type === "QUANTITY_DEAL" && existing && existing.type !== "QUANTITY_DEAL") {
    throw new AuthError("Cannot change a live promotion to QUANTITY_DEAL", "VALIDATION", 400);
  }

  const scoped =
    input.catalogueWide === true
      ? { variantIds: [] as string[], skus: [] as string[] }
      : {
          variantIds: input.variantIds ?? [],
          skus: input.skus ?? [],
        };
  const metadata =
    scoped.variantIds.length || scoped.skus.length
      ? {
          ...(scoped.variantIds.length ? { variantIds: scoped.variantIds } : {}),
          ...(scoped.skus.length ? { skus: scoped.skus } : {}),
        }
      : {};

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
    after: { code: row.code, type: row.type, isActive: row.isActive, metadata },
  });
  return serializePromotion(row);
}

export async function previewPromotion(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const input = promotionPreviewSchema.parse(raw);
  return previewPromotionUnit({
    unitPrice: input.unitPrice,
    type: input.type,
    value: input.value,
  });
}

export async function listQuantityBreaks(actorUserId: string, variantId: string) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { caseQty: true },
  });
  const rows = await prisma.quantityBreak.findMany({
    where: { variantId },
    orderBy: { minQty: "asc" },
  });
  const caseQty = variant?.caseQty ?? null;
  return {
    caseQty,
    items: rows.map((row) => ({
      id: row.id,
      minQty: row.minQty,
      unitPrice: moneyNumber(row.unitPrice),
      unitPriceDisplay: formatGbpFromUnknown(row.unitPrice),
      isBaseMirror: row.minQty <= 1,
      firstOrderableQty: row.minQty <= 1 ? null : firstOrderableFor(row.minQty, caseQty),
      caseNote: row.minQty <= 1 ? null : caseBreakNote(row.minQty, caseQty),
    })),
  };
}

function firstOrderableFor(minQty: number, caseQty: number | null) {
  const pack = caseQty && caseQty > 1 ? caseQty : 1;
  return Math.ceil(minQty / pack) * pack;
}

export async function upsertQuantityBreak(actorUserId: string, raw: unknown) {
  await requireInternalPricing(actorUserId, "pricing.edit");
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
  await requireInternalPricing(actorUserId, "pricing.edit");
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
  await requireInternalPricing(actorUserId, "pricing.view");
  const needle = q.trim();
  if (needle.length < 1) return [];
  const rows = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      OR: [
        { sku: { contains: needle, mode: "insensitive" } },
        { product: { name: { contains: needle, mode: "insensitive" } } },
        { product: { brand: { name: { contains: needle, mode: "insensitive" } } } },
      ],
    },
    take: 20,
    orderBy: { sku: "asc" },
    select: {
      id: true,
      sku: true,
      tradePrice: true,
      product: { select: { name: true, brand: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.product.name,
    brand: row.product.brand.name,
    baseTradePrice: moneyNumber(row.tradePrice),
    baseTradePriceDisplay: formatGbpFromUnknown(row.tradePrice),
  }));
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
    select: { id: true, sku: true, tradePrice: true, vatCode: true, rrp: true, caseQty: true },
  });
  if (!variant) throw new AuthError("Variant not found", "NOT_FOUND", 404);

  const quantity = input.quantity ?? 1;
  const factsMap = await loadTradePriceFactsForVariants({
    companyId: input.companyId,
    quantity,
    variants: [{ id: variant.id, sku: variant.sku, tradePrice: variant.tradePrice, vatCode: variant.vatCode }],
  });
  const facts = factsMap.get(variant.id);
  if (!facts) throw new AuthError("Unable to resolve price", "INTERNAL", 500);
  const resolved = resolveTradePriceFromFacts(facts);
  const caseQty = variant.caseQty ?? null;
  const notCaseMultiple = caseQty != null && caseQty > 1 && quantity % caseQty !== 0;
  return {
    resolved,
    rrp: moneyNumber(variant.rrp),
    sku: variant.sku,
    caseQty,
    winningRule: winningRuleLabel(resolved.source),
    orderableNote: notCaseMultiple
      ? `Ordering is restricted to multiples of ${caseQty} for this product.`
      : null,
  };
}

export async function listCommercialAudit(
  actorUserId: string,
  filter: { priceListId?: string; companyId?: string; variantId?: string },
) {
  await requireInternalPricing(actorUserId, "pricing.view");
  const rows = await prisma.auditEvent.findMany({
    where: filter.companyId
      ? {
          companyId: filter.companyId,
          OR: [{ action: { startsWith: "pricing." } }, { action: "company.updated" }],
        }
      : {
          action: { startsWith: "pricing." },
        },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      actorUserId: true,
      after: true,
      before: true,
      companyId: true,
    },
  });
  let filtered = rows;
  if (filter.priceListId) {
    const all = await prisma.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "PriceList", entityId: filter.priceListId },
          { entityType: "PriceListItem", action: { startsWith: "pricing.price_list_item" } },
          { action: "company.updated" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actorUserId: true,
        after: true,
        before: true,
        companyId: true,
      },
    });
    filtered = all.filter((row) => {
      if (row.entityType === "PriceList" && row.entityId === filter.priceListId) return true;
      const after = row.after as Record<string, unknown> | null;
      const before = row.before as Record<string, unknown> | null;
      if (after?.["priceListId"] === filter.priceListId || before?.["priceListId"] === filter.priceListId) return true;
      return false;
    }).slice(0, 30);
  }
  if (filter.variantId) {
    const all = await prisma.auditEvent.findMany({
      where: { action: { startsWith: "pricing." } },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actorUserId: true,
        after: true,
        before: true,
        companyId: true,
      },
    });
    filtered = all
      .filter((row) => {
        if (row.entityId === filter.variantId) return true;
        const after = row.after as Record<string, unknown> | null;
        const before = row.before as Record<string, unknown> | null;
        return after?.["variantId"] === filter.variantId || before?.["variantId"] === filter.variantId;
      })
      .slice(0, 30);
  }
  const actorIds = [...new Set(filtered.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const names = new Map(actors.map((user) => [user.id, user.name || user.email]));
  return filtered.map((row) => ({
    id: row.id,
    action: row.action,
    title: commercialAuditLabel(row.action),
    at: row.createdAt.toISOString(),
    actor: row.actorUserId ? names.get(row.actorUserId) ?? null : null,
  }));
}
