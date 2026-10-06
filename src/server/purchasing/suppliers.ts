/**
 * Purchasing supplier master + product ↔ supplier relationships.
 * Internal only. Relationships are assigned manually — never inferred from brand, group,
 * SKU prefix or description. Never creates purchase orders or touches Autopart stock.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { skuMatchKey } from "@/domain/stock";
import {
  AUTOPART_PRODUCT_KIND_LABEL,
  classifyAutopartProduct,
  type AutopartProductKind,
} from "@/domain/autopart-product";
import {
  normalizeSupplierCode,
  productSupplierConstraintsSchema,
  supplierInputSchema,
} from "@/domain/purchasing-supplier";
import { resolvePlanningSupplier } from "@/domain/purchasing-planner";
import { outstandingBackorderUnitsBySku } from "@/server/purchasing/backorders";

export async function requirePurchasingManage(actorUserId: string) {
  const profile = await requirePurchasingAccess(actorUserId);
  if (!hasPermission(profile, "purchasing.manage")) {
    throw new AuthError("purchasing.manage is required", "FORBIDDEN", 403);
  }
  return profile;
}

function money(value: { toString(): string } | null | undefined, places: number): string | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(places) : null;
}

function supplierView(s: {
  id: string;
  name: string;
  code: string | null;
  accountNumber: string | null;
  contactName: string | null;
  email: string | null;
  telephone: string | null;
  website: string | null;
  notes: string | null;
  defaultLeadTimeDays: number | null;
  defaultMinimumOrderValue: { toString(): string } | null;
  currency: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    accountNumber: s.accountNumber,
    contactName: s.contactName,
    email: s.email,
    telephone: s.telephone,
    website: s.website,
    notes: s.notes,
    defaultLeadTimeDays: s.defaultLeadTimeDays,
    defaultMinimumOrderValue: money(s.defaultMinimumOrderValue, 2),
    currency: s.currency,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type SupplierView = ReturnType<typeof supplierView>;

function uniqueCodeError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AuthError("A supplier with this code already exists", "VALIDATION", 400);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Planner support
// ---------------------------------------------------------------------------

export type SupplierAssignment = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string | null;
  supplierActive: boolean;
  supplierDefaultLeadTimeDays: number | null;
  supplierMinimumOrderValue: string | null;
  supplierCurrency: string;
  active: boolean;
  isPreferred: boolean;
  supplierSku: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
  unitCost: string | null;
};

/** Active relationships grouped by SKU matchKey. One query, no per-row lookups. */
export async function loadSupplierAssignments(): Promise<Map<string, SupplierAssignment[]>> {
  const rows = await prisma.productSupplier.findMany({
    where: { active: true },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          code: true,
          active: true,
          defaultLeadTimeDays: true,
          defaultMinimumOrderValue: true,
          currency: true,
        },
      },
    },
  });
  const map = new Map<string, SupplierAssignment[]>();
  for (const r of rows) {
    const list = map.get(r.matchKey) ?? [];
    list.push({
      id: r.id,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      supplierCode: r.supplier.code,
      supplierActive: r.supplier.active,
      supplierDefaultLeadTimeDays: r.supplier.defaultLeadTimeDays,
      supplierMinimumOrderValue: money(r.supplier.defaultMinimumOrderValue, 2),
      supplierCurrency: r.supplier.currency,
      active: r.active,
      isPreferred: r.isPreferred,
      supplierSku: r.supplierSku,
      leadTimeDays: r.leadTimeDays,
      minimumOrderQty: r.minimumOrderQty,
      orderMultiple: r.orderMultiple,
      unitCost: money(r.unitCost, 4),
    });
    map.set(r.matchKey, list);
  }
  return map;
}

export async function listActiveSupplierOptions() {
  const rows = await prisma.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, defaultMinimumOrderValue: true, currency: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    minimumOrderValue: money(r.defaultMinimumOrderValue, 2),
    currency: r.currency,
  }));
}

// ---------------------------------------------------------------------------
// Supplier CRUD
// ---------------------------------------------------------------------------

const listInput = z.object({
  q: z.string().optional().nullable(),
  includeInactive: z.boolean().optional().nullable(),
});

export async function listSuppliers(actorUserId: string, raw: unknown = {}) {
  const profile = await requirePurchasingAccess(actorUserId);
  const input = listInput.parse(raw ?? {});
  const q = input.q?.trim();
  const suppliers = await prisma.supplier.findMany({
    where: {
      ...(input.includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
              { accountNumber: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const counts = await prisma.productSupplier.groupBy({
    by: ["supplierId", "isPreferred"],
    where: { active: true, supplierId: { in: suppliers.map((s) => s.id) } },
    _count: { _all: true },
  });
  const productCount = new Map<string, number>();
  const preferredCount = new Map<string, number>();
  for (const c of counts) {
    productCount.set(c.supplierId, (productCount.get(c.supplierId) ?? 0) + c._count._all);
    if (c.isPreferred) preferredCount.set(c.supplierId, c._count._all);
  }
  return {
    canManage: hasPermission(profile, "purchasing.manage"),
    suppliers: suppliers.map((s) => ({
      ...supplierView(s),
      productCount: productCount.get(s.id) ?? 0,
      preferredCount: preferredCount.get(s.id) ?? 0,
    })),
  };
}

function supplierData(input: z.infer<typeof supplierInputSchema>) {
  return {
    name: input.name,
    code: normalizeSupplierCode(input.code ?? null),
    accountNumber: input.accountNumber ?? null,
    contactName: input.contactName ?? null,
    email: input.email ?? null,
    telephone: input.telephone ?? null,
    website: input.website ?? null,
    notes: input.notes ?? null,
    defaultLeadTimeDays: input.defaultLeadTimeDays ?? null,
    defaultMinimumOrderValue: input.defaultMinimumOrderValue ?? null,
    currency: input.currency ?? "GBP",
  };
}

export async function createSupplier(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = supplierInputSchema.parse(raw);
  const data = supplierData(input);
  const created = await prisma.supplier
    .create({ data: { ...data, createdByUserId: actorUserId, updatedByUserId: actorUserId } })
    .catch(uniqueCodeError);
  const view = supplierView(created);
  await recordAuditEvent({
    action: "purchasing.supplier.create",
    entityType: "Supplier",
    entityId: created.id,
    actorUserId,
    after: view,
  });
  return view;
}

export async function updateSupplier(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const parsed = z.object({ id: z.string().min(1) }).passthrough().parse(raw);
  const input = supplierInputSchema.parse(raw);
  const before = await prisma.supplier.findUnique({ where: { id: parsed.id } });
  if (!before) throw new AuthError("Supplier not found", "NOT_FOUND", 404);
  const updated = await prisma.supplier
    .update({ where: { id: parsed.id }, data: { ...supplierData(input), updatedByUserId: actorUserId } })
    .catch(uniqueCodeError);
  const view = supplierView(updated);
  await recordAuditEvent({
    action: "purchasing.supplier.update",
    entityType: "Supplier",
    entityId: updated.id,
    actorUserId,
    before: supplierView(before),
    after: view,
  });
  return view;
}

export async function setSupplierActive(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = z.object({ id: z.string().min(1), active: z.boolean() }).parse(raw);
  const before = await prisma.supplier.findUnique({ where: { id: input.id } });
  if (!before) throw new AuthError("Supplier not found", "NOT_FOUND", 404);
  if (before.active === input.active) return supplierView(before);
  const updated = await prisma.supplier.update({
    where: { id: input.id },
    data: { active: input.active, updatedByUserId: actorUserId },
  });
  await recordAuditEvent({
    action: input.active ? "purchasing.supplier.reactivate" : "purchasing.supplier.deactivate",
    entityType: "Supplier",
    entityId: updated.id,
    actorUserId,
    metadata: { name: updated.name },
    before: { active: before.active },
    after: { active: updated.active },
  });
  return supplierView(updated);
}

// ---------------------------------------------------------------------------
// Product resolution (catalogue + external Autopart products)
// ---------------------------------------------------------------------------

type ProductInfo = {
  matchKey: string;
  sku: string;
  name: string;
  productKind: AutopartProductKind;
  productKindLabel: string;
  variantId: string | null;
  autopartProductId: string | null;
  availQty: number | null;
  incomingQty: number | null;
  latestCost: string | null;
};

async function productInfoForKeys(keys: string[]): Promise<Map<string, ProductInfo>> {
  const unique = [...new Set(keys)];
  const out = new Map<string, ProductInfo>();
  if (!unique.length) return out;
  const autopart = await prisma.autopartProduct.findMany({
    where: { matchKey: { in: unique } },
    select: {
      id: true,
      sku: true,
      matchKey: true,
      description: true,
      availQty: true,
      incomingQty: true,
      latestCost: true,
      presentInLatestFeed: true,
      catalogueVariantId: true,
      catalogueVariant: { select: { id: true, sku: true, name: true, product: { select: { name: true } } } },
    },
  });
  for (const p of autopart) {
    const kind = classifyAutopartProduct({
      hasCatalogueVariant: Boolean(p.catalogueVariantId),
      presentInLatestFeed: p.presentInLatestFeed,
    });
    const variant = p.catalogueVariant;
    out.set(p.matchKey, {
      matchKey: p.matchKey,
      sku: variant?.sku ?? p.sku,
      name: variant
        ? variant.name
          ? `${variant.product.name} — ${variant.name}`
          : variant.product.name
        : p.description?.trim() || p.sku,
      productKind: kind,
      productKindLabel: AUTOPART_PRODUCT_KIND_LABEL[kind],
      variantId: variant?.id ?? null,
      autopartProductId: p.id,
      availQty: p.availQty,
      incomingQty: p.incomingQty,
      latestCost: money(p.latestCost, 4),
    });
  }
  const missing = unique.filter((k) => !out.has(k));
  if (missing.length) {
    const variants = await prisma.productVariant.findMany({
      where: { OR: missing.map((k) => ({ sku: { equals: k, mode: "insensitive" as const } })) },
      select: {
        id: true,
        sku: true,
        name: true,
        product: { select: { name: true } },
        autopartCostPosition: { select: { latestCost: true } },
      },
    });
    for (const v of variants) {
      const key = skuMatchKey(v.sku);
      if (out.has(key)) continue;
      out.set(key, {
        matchKey: key,
        sku: v.sku,
        name: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
        productKind: "CATALOGUE",
        productKindLabel: AUTOPART_PRODUCT_KIND_LABEL.CATALOGUE,
        variantId: v.id,
        autopartProductId: null,
        availQty: null,
        incomingQty: null,
        latestCost: money(v.autopartCostPosition?.latestCost, 4),
      });
    }
  }
  return out;
}

export async function searchPurchasingProducts(actorUserId: string, raw: unknown) {
  await requirePurchasingAccess(actorUserId);
  const input = z.object({ q: z.string().trim().min(1).max(80) }).parse(raw);
  const q = input.q;
  const [variants, autopart] = await Promise.all([
    prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { product: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: { sku: true },
      take: 15,
      orderBy: { sku: "asc" },
    }),
    prisma.autopartProduct.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { matchKey: true },
      take: 15,
      orderBy: { sku: "asc" },
    }),
  ]);
  const keys = [...variants.map((v) => skuMatchKey(v.sku)), ...autopart.map((a) => a.matchKey)];
  const info = await productInfoForKeys(keys);
  return [...info.values()]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .slice(0, 20)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      productKind: p.productKind,
      productKindLabel: p.productKindLabel,
    }));
}

// ---------------------------------------------------------------------------
// Supplier detail
// ---------------------------------------------------------------------------

export async function getSupplierDetail(actorUserId: string, raw: unknown) {
  const profile = await requirePurchasingAccess(actorUserId);
  const input = z.object({ id: z.string().min(1) }).parse(raw);
  const supplier = await prisma.supplier.findUnique({
    where: { id: input.id },
    include: { products: { orderBy: [{ active: "desc" }, { sku: "asc" }] } },
  });
  if (!supplier) throw new AuthError("Supplier not found", "NOT_FOUND", 404);
  const keys = supplier.products.map((p) => p.matchKey);
  const [info, backorders, siblings] = await Promise.all([
    productInfoForKeys(keys),
    outstandingBackorderUnitsBySku(),
    prisma.productSupplier.findMany({
      where: { matchKey: { in: keys }, active: true },
      select: { matchKey: true, supplierId: true, isPreferred: true, supplier: { select: { name: true } } },
    }),
  ]);
  return {
    canManage: hasPermission(profile, "purchasing.manage"),
    supplier: supplierView(supplier),
    products: supplier.products.map((p) => {
      const product = info.get(p.matchKey);
      const others = siblings.filter((s) => s.matchKey === p.matchKey && s.supplierId !== supplier.id);
      return {
        id: p.id,
        matchKey: p.matchKey,
        sku: product?.sku ?? p.sku,
        name: product?.name ?? p.sku,
        productKind: product?.productKind ?? ("HISTORIC_ONLY" as AutopartProductKind),
        productKindLabel: product?.productKindLabel ?? AUTOPART_PRODUCT_KIND_LABEL.HISTORIC_ONLY,
        supplierSku: p.supplierSku,
        isPreferred: p.isPreferred,
        active: p.active,
        leadTimeDays: p.leadTimeDays,
        minimumOrderQty: p.minimumOrderQty,
        orderMultiple: p.orderMultiple,
        unitCost: money(p.unitCost, 4),
        latestCost: product?.latestCost ?? null,
        availQty: product?.availQty ?? null,
        incomingQty: product?.incomingQty ?? null,
        backorderUnits: backorders.get(p.matchKey) ?? 0,
        preferredElsewhere: others.find((o) => o.isPreferred)?.supplier.name ?? null,
        otherSupplierCount: others.length,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

const addInput = productSupplierConstraintsSchema.extend({
  supplierId: z.string().min(1),
  sku: z.string().trim().min(1).max(80),
  isPreferred: z.boolean().optional().nullable(),
});

function constraintData(input: z.infer<typeof productSupplierConstraintsSchema>) {
  return {
    supplierSku: input.supplierSku ?? null,
    leadTimeDays: input.leadTimeDays ?? null,
    minimumOrderQty: input.minimumOrderQty ?? null,
    orderMultiple: input.orderMultiple ?? null,
    unitCost: input.unitCost ?? null,
  };
}

function relationAudit(r: {
  supplierSku: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  orderMultiple: number | null;
  unitCost: { toString(): string } | string | null;
  isPreferred: boolean;
  active: boolean;
}) {
  return {
    supplierSku: r.supplierSku,
    leadTimeDays: r.leadTimeDays,
    minimumOrderQty: r.minimumOrderQty,
    orderMultiple: r.orderMultiple,
    unitCost: r.unitCost == null ? null : String(r.unitCost),
    isPreferred: r.isPreferred,
    active: r.active,
  };
}

/** Demote other preferred rows for the same product, inside the caller's transaction. */
async function clearOtherPreferred(tx: Prisma.TransactionClient, matchKey: string, keepId: string) {
  await tx.productSupplier.updateMany({
    where: { matchKey, isPreferred: true, id: { not: keepId } },
    data: { isPreferred: false },
  });
}

export async function addProductSupplier(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = addInput.parse(raw);
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new AuthError("Supplier not found", "NOT_FOUND", 404);
  if (!supplier.active) throw new AuthError("Supplier is inactive", "VALIDATION", 400);
  const matchKey = skuMatchKey(input.sku);
  const product = (await productInfoForKeys([matchKey])).get(matchKey);
  if (!product) {
    throw new AuthError("SKU not found in the catalogue or Autopart product master", "NOT_FOUND", 404);
  }
  const data = constraintData(input);
  const preferred = Boolean(input.isPreferred);
  const existing = await prisma.productSupplier.findUnique({
    where: { supplierId_matchKey: { supplierId: supplier.id, matchKey } },
  });
  const saved = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.productSupplier.update({
          where: { id: existing.id },
          data: {
            ...data,
            sku: product.sku,
            autopartProductId: product.autopartProductId,
            variantId: product.variantId,
            active: true,
            isPreferred: false,
            updatedByUserId: actorUserId,
          },
        })
      : await tx.productSupplier.create({
          data: {
            ...data,
            supplierId: supplier.id,
            matchKey,
            sku: product.sku,
            autopartProductId: product.autopartProductId,
            variantId: product.variantId,
            isPreferred: false,
            updatedByUserId: actorUserId,
          },
        });
    if (!preferred) return row;
    await clearOtherPreferred(tx, matchKey, row.id);
    return tx.productSupplier.update({ where: { id: row.id }, data: { isPreferred: true } });
  });
  await recordAuditEvent({
    action: "purchasing.product_supplier.add",
    entityType: "ProductSupplier",
    entityId: saved.id,
    actorUserId,
    metadata: { supplierId: supplier.id, supplierName: supplier.name, sku: product.sku, productKind: product.productKind },
    before: existing ? relationAudit(existing) : null,
    after: relationAudit(saved),
  });
  if (preferred) {
    await recordAuditEvent({
      action: "purchasing.product_supplier.preferred",
      entityType: "ProductSupplier",
      entityId: saved.id,
      actorUserId,
      metadata: { supplierId: supplier.id, supplierName: supplier.name, sku: product.sku },
    });
  }
  return { id: saved.id };
}

export async function updateProductSupplier(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = productSupplierConstraintsSchema.extend({ id: z.string().min(1) }).parse(raw);
  const before = await prisma.productSupplier.findUnique({ where: { id: input.id } });
  if (!before) throw new AuthError("Supplier relationship not found", "NOT_FOUND", 404);
  const updated = await prisma.productSupplier.update({
    where: { id: input.id },
    data: { ...constraintData(input), updatedByUserId: actorUserId },
  });
  await recordAuditEvent({
    action: "purchasing.product_supplier.constraints",
    entityType: "ProductSupplier",
    entityId: updated.id,
    actorUserId,
    metadata: { supplierId: updated.supplierId, sku: updated.sku },
    before: relationAudit(before),
    after: relationAudit(updated),
  });
  return { id: updated.id };
}

export async function setPreferredProductSupplier(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = z.object({ id: z.string().min(1) }).parse(raw);
  const row = await prisma.productSupplier.findUnique({ where: { id: input.id }, include: { supplier: true } });
  if (!row) throw new AuthError("Supplier relationship not found", "NOT_FOUND", 404);
  if (!row.active) throw new AuthError("Reactivate the relationship before making it preferred", "VALIDATION", 400);
  if (!row.supplier.active) throw new AuthError("Supplier is inactive", "VALIDATION", 400);
  const previous = await prisma.productSupplier.findFirst({
    where: { matchKey: row.matchKey, isPreferred: true, active: true, id: { not: row.id } },
    include: { supplier: { select: { name: true } } },
  });
  await prisma.$transaction(async (tx) => {
    await clearOtherPreferred(tx, row.matchKey, row.id);
    await tx.productSupplier.update({
      where: { id: row.id },
      data: { isPreferred: true, updatedByUserId: actorUserId },
    });
  });
  if (!row.isPreferred) {
    await recordAuditEvent({
      action: "purchasing.product_supplier.preferred",
      entityType: "ProductSupplier",
      entityId: row.id,
      actorUserId,
      metadata: { sku: row.sku, supplierId: row.supplierId, supplierName: row.supplier.name },
      before: { preferredSupplier: previous?.supplier.name ?? null },
      after: { preferredSupplier: row.supplier.name },
    });
  }
  return { id: row.id };
}

export async function setProductSupplierActive(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = z.object({ id: z.string().min(1), active: z.boolean() }).parse(raw);
  const before = await prisma.productSupplier.findUnique({ where: { id: input.id } });
  if (!before) throw new AuthError("Supplier relationship not found", "NOT_FOUND", 404);
  if (before.active === input.active) return { id: before.id };
  const updated = await prisma.productSupplier.update({
    where: { id: input.id },
    data: {
      active: input.active,
      ...(input.active ? {} : { isPreferred: false }),
      updatedByUserId: actorUserId,
    },
  });
  await recordAuditEvent({
    action: input.active ? "purchasing.product_supplier.reactivate" : "purchasing.product_supplier.deactivate",
    entityType: "ProductSupplier",
    entityId: updated.id,
    actorUserId,
    metadata: { supplierId: updated.supplierId, sku: updated.sku },
    before: relationAudit(before),
    after: relationAudit(updated),
  });
  return { id: updated.id };
}

/** Internal product detail: all supplier relationships for one SKU (catalogue or external). */
export async function getProductSuppliersForSku(actorUserId: string, raw: unknown) {
  const profile = await requirePurchasingAccess(actorUserId);
  const input = z.object({ sku: z.string().trim().min(1) }).parse(raw);
  const matchKey = skuMatchKey(input.sku);
  const [rows, product] = await Promise.all([
    prisma.productSupplier.findMany({
      where: { matchKey },
      include: { supplier: true },
      orderBy: [{ active: "desc" }, { isPreferred: "desc" }, { createdAt: "asc" }],
    }),
    productInfoForKeys([matchKey]).then((m) => m.get(matchKey) ?? null),
  ]);
  const relations = rows.map((r) => ({
    id: r.id,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    supplierCode: r.supplier.code,
    supplierActive: r.supplier.active,
    active: r.active,
    isPreferred: r.isPreferred,
    supplierSku: r.supplierSku,
    leadTimeDays: r.leadTimeDays ?? null,
    supplierDefaultLeadTimeDays: r.supplier.defaultLeadTimeDays,
    minimumOrderQty: r.minimumOrderQty,
    orderMultiple: r.orderMultiple,
    unitCost: money(r.unitCost, 4),
  }));
  const planning = resolvePlanningSupplier(relations);
  return {
    canManage: hasPermission(profile, "purchasing.manage"),
    sku: product?.sku ?? input.sku,
    latestCost: product?.latestCost ?? null,
    planningState: planning.state,
    planningSupplierId: planning.relation?.supplierId ?? null,
    relations,
  };
}
