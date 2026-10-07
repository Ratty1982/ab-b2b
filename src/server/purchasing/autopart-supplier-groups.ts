/**
 * Explicit Autopart Group mappings and reconciliation onto ProductSupplier.
 * Never infers a supplier from Supplier.code, SKU, brand, or description.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import {
  accumulateSupplierGroupPlan,
  emptySupplierGroupTotals,
  formatSupplierGroupReconciliation,
  normalizeAutopartGroupCode,
  planAutopartGroupReconciliation,
  type ActiveAutopartGroupMapping,
  type SupplierGroupReconcileTotals,
  type SupplierRelationState,
} from "@/domain/autopart-supplier-group";
async function requirePurchasingManage(actorUserId: string) {
  const profile = await requirePurchasingAccess(actorUserId);
  if (!hasPermission(profile, "purchasing.manage")) {
    throw new AuthError("purchasing.manage is required", "FORBIDDEN", 403);
  }
  return profile;
}

const CHUNK = 100;

export type SupplierGroupImportDiagnostics = SupplierGroupReconcileTotals & {
  summary: string;
  error?: string;
};

type ProductRow = {
  id: string;
  sku: string;
  matchKey: string;
  groupCode: string | null;
  catalogueVariantId: string | null;
};

async function loadActiveMappings(): Promise<Map<string, ActiveAutopartGroupMapping>> {
  const rows = await prisma.supplierAutopartGroup.findMany({
    where: { active: true },
    select: { id: true, supplierId: true, groupCode: true },
  });
  const map = new Map<string, ActiveAutopartGroupMapping>();
  for (const row of rows) map.set(row.groupCode, row);
  return map;
}

async function applyPlan(
  product: ProductRow,
  relations: SupplierRelationState[],
  mapping: ActiveAutopartGroupMapping | null,
): Promise<ReturnType<typeof planAutopartGroupReconciliation>> {
  const plan = planAutopartGroupReconciliation({
    groupCode: product.groupCode,
    relations,
    mapping,
  });
  if (!plan.decisions.length) return plan;
  const deactivations = plan.decisions.filter((d) => d.kind === "deactivate");
  const ensures = plan.decisions.filter((d) => d.kind === "ensure-auto");
  await prisma.$transaction(async (tx) => {
    if (deactivations.length) {
      await tx.productSupplier.updateMany({
        where: { id: { in: deactivations.map((d) => d.id) } },
        data: { active: false, isPreferred: false },
      });
    }
    for (const decision of ensures) {
      const data = {
        active: true,
        isPreferred: decision.isPreferred,
        source: "AUTOPART_GROUP" as const,
        autopartGroupCode: decision.groupCode,
        supplierAutopartGroupId: decision.mappingId,
        autopartProductId: product.id,
        variantId: product.catalogueVariantId,
        sku: product.sku,
      };
      if (decision.existingId) {
        await tx.productSupplier.update({ where: { id: decision.existingId }, data });
      } else {
        await tx.productSupplier.create({
          data: {
            ...data,
            supplierId: decision.supplierId,
            matchKey: product.matchKey,
          },
        });
      }
    }
  });
  return plan;
}

export async function reconcileAutopartSupplierGroups(input: {
  matchKeys?: string[];
  groupCodes?: string[];
}): Promise<SupplierGroupReconcileTotals> {
  const totals = emptySupplierGroupTotals();
  const unmapped = new Set<string>();
  const mappings = await loadActiveMappings();
  const where: Prisma.AutopartProductWhereInput = {};
  if (input.matchKeys) where.matchKey = { in: [...new Set(input.matchKeys)] };
  if (input.groupCodes) where.groupCode = { in: [...new Set(input.groupCodes)] };
  if (!input.matchKeys && !input.groupCodes) return totals;
  if (input.matchKeys && input.matchKeys.length === 0) return totals;
  if (input.groupCodes && input.groupCodes.length === 0) return totals;

  const products = await prisma.autopartProduct.findMany({
    where,
    select: { id: true, sku: true, matchKey: true, groupCode: true, catalogueVariantId: true },
  });
  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);
    const keys = chunk.map((p) => p.matchKey);
    const existing = await prisma.productSupplier.findMany({
      where: { matchKey: { in: keys } },
      select: {
        id: true,
        matchKey: true,
        supplierId: true,
        source: true,
        autopartGroupCode: true,
        active: true,
        isPreferred: true,
      },
    });
    const byKey = new Map<string, SupplierRelationState[]>();
    for (const row of existing) {
      const list = byKey.get(row.matchKey) ?? [];
      list.push({
        id: row.id,
        supplierId: row.supplierId,
        source: row.source,
        autopartGroupCode: row.autopartGroupCode,
        active: row.active,
        isPreferred: row.isPreferred,
      });
      byKey.set(row.matchKey, list);
    }
    for (const product of chunk) {
      const group = normalizeAutopartGroupCode(product.groupCode);
      const mapping = group ? (mappings.get(group) ?? null) : null;
      try {
        const plan = await applyPlan(product, byKey.get(product.matchKey) ?? [], mapping);
        accumulateSupplierGroupPlan(totals, plan, unmapped);
      } catch (error) {
        console.warn("[ab:supplier-group]", {
          matchKey: product.matchKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  totals.unmappedGroups = unmapped.size;
  return totals;
}

export async function reconcileAutopartSupplierGroupsForImport(
  matchKeys: string[],
): Promise<SupplierGroupImportDiagnostics> {
  try {
    const totals = await reconcileAutopartSupplierGroups({ matchKeys });
    return { ...totals, summary: formatSupplierGroupReconciliation(totals) };
  } catch (error) {
    const totals = emptySupplierGroupTotals();
    return {
      ...totals,
      summary: "Supplier group reconciliation failed. Stock import was kept.",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function assertGroupAvailable(groupCode: string, supplierId: string) {
  const owner = await prisma.supplierAutopartGroup.findFirst({
    where: { groupCode, active: true, supplierId: { not: supplierId } },
    include: { supplier: { select: { name: true } } },
  });
  if (owner) {
    throw new AuthError(
      `Autopart Group ${groupCode} is already mapped to ${owner.supplier.name}`,
      "VALIDATION",
      400,
    );
  }
}

function groupAudit(supplier: { id: string; name: string }, groupCode: string, active: boolean) {
  return { supplierId: supplier.id, supplierName: supplier.name, groupCode, active };
}

function groupTakenError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AuthError("That Autopart Group is already mapped to a supplier", "VALIDATION", 400);
  }
  throw error;
}

export async function addSupplierAutopartGroup(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = z.object({ supplierId: z.string().min(1), groupCode: z.string() }).parse(raw);
  const groupCode = normalizeAutopartGroupCode(input.groupCode);
  if (!groupCode) throw new AuthError("Enter an Autopart Group code", "VALIDATION", 400);
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new AuthError("Supplier not found", "NOT_FOUND", 404);
  if (!supplier.active) throw new AuthError("Supplier is inactive", "VALIDATION", 400);
  await assertGroupAvailable(groupCode, supplier.id);
  const existing = await prisma.supplierAutopartGroup.findUnique({
    where: { supplierId_groupCode: { supplierId: supplier.id, groupCode } },
  });
  let action: "purchasing.supplier_autopart_group.create" | "purchasing.supplier_autopart_group.reactivate" =
    "purchasing.supplier_autopart_group.create";
  const saved = existing
    ? await prisma.supplierAutopartGroup
        .update({
          where: { id: existing.id },
          data: { active: true, updatedByUserId: actorUserId },
        })
        .catch(groupTakenError)
    : await prisma.supplierAutopartGroup
        .create({
          data: {
            supplierId: supplier.id,
            groupCode,
            active: true,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
          },
        })
        .catch(groupTakenError);
  if (existing?.active) {
    const reconciliation = await reconcileAutopartSupplierGroups({ groupCodes: [groupCode] });
    return { id: saved.id, groupCode, active: true, reconciliation, alreadyActive: true };
  }
  if (existing && !existing.active) action = "purchasing.supplier_autopart_group.reactivate";
  const reconciliation = await reconcileAutopartSupplierGroups({ groupCodes: [groupCode] });
  await recordAuditEvent({
    action,
    entityType: "SupplierAutopartGroup",
    entityId: saved.id,
    actorUserId,
    metadata: groupAudit(supplier, groupCode, true),
    before: existing ? { active: existing.active, groupCode: existing.groupCode } : null,
    after: { active: true, groupCode },
  });
  return { id: saved.id, groupCode, active: true, reconciliation, alreadyActive: false };
}

export async function setSupplierAutopartGroupActive(actorUserId: string, raw: unknown) {
  await requirePurchasingManage(actorUserId);
  const input = z.object({ id: z.string().min(1), active: z.boolean() }).parse(raw);
  const before = await prisma.supplierAutopartGroup.findUnique({
    where: { id: input.id },
    include: { supplier: { select: { id: true, name: true, active: true } } },
  });
  if (!before) throw new AuthError("Autopart Group mapping not found", "NOT_FOUND", 404);
  if (input.active && !before.supplier.active) {
    throw new AuthError("Supplier is inactive", "VALIDATION", 400);
  }
  if (input.active) await assertGroupAvailable(before.groupCode, before.supplierId);
  if (before.active === input.active) {
    const reconciliation = await reconcileAutopartSupplierGroups({ groupCodes: [before.groupCode] });
    return { id: before.id, groupCode: before.groupCode, active: before.active, reconciliation };
  }
  const updated = await prisma.supplierAutopartGroup
    .update({
      where: { id: before.id },
      data: { active: input.active, updatedByUserId: actorUserId },
    })
    .catch(groupTakenError);
  const reconciliation = await reconcileAutopartSupplierGroups({ groupCodes: [before.groupCode] });
  await recordAuditEvent({
    action: input.active
      ? "purchasing.supplier_autopart_group.reactivate"
      : "purchasing.supplier_autopart_group.deactivate",
    entityType: "SupplierAutopartGroup",
    entityId: updated.id,
    actorUserId,
    metadata: groupAudit(before.supplier, before.groupCode, input.active),
    before: { active: before.active, groupCode: before.groupCode },
    after: { active: updated.active, groupCode: updated.groupCode },
  });
  return { id: updated.id, groupCode: updated.groupCode, active: updated.active, reconciliation };
}

export async function listSupplierAutopartGroups(supplierId: string) {
  const groups = await prisma.supplierAutopartGroup.findMany({
    where: { supplierId },
    orderBy: [{ active: "desc" }, { groupCode: "asc" }],
  });
  if (!groups.length) return [];
  const codes = groups.map((g) => g.groupCode);
  const [inGroup, linked] = await Promise.all([
    prisma.autopartProduct.groupBy({
      by: ["groupCode"],
      where: { groupCode: { in: codes } },
      _count: { _all: true },
    }),
    prisma.productSupplier.groupBy({
      by: ["autopartGroupCode"],
      where: { supplierId, source: "AUTOPART_GROUP", active: true, autopartGroupCode: { in: codes } },
      _count: { _all: true },
    }),
  ]);
  const inGroupCount = new Map(inGroup.map((row) => [row.groupCode, row._count._all]));
  const linkedCount = new Map(linked.map((row) => [row.autopartGroupCode, row._count._all]));
  return groups.map((g) => ({
    id: g.id,
    groupCode: g.groupCode,
    active: g.active,
    productsInGroup: inGroupCount.get(g.groupCode) ?? 0,
    linkedProducts: linkedCount.get(g.groupCode) ?? 0,
  }));
}

export async function autopartGroupsBySupplier(supplierIds: string[]) {
  if (!supplierIds.length) return new Map<string, string[]>();
  const rows = await prisma.supplierAutopartGroup.findMany({
    where: { supplierId: { in: supplierIds }, active: true },
    orderBy: { groupCode: "asc" },
    select: { supplierId: true, groupCode: true },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.supplierId) ?? [];
    list.push(row.groupCode);
    map.set(row.supplierId, list);
  }
  return map;
}
