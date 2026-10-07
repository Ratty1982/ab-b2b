/**
 * Explicit Autopart Group → Supplier mapping.
 * Supplier.code is not inferred. Manual relationships win.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct } from "@/server/catalogue/products";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New, type Native231Po3NewRow } from "@/server/stock/fixtures/native-231po3new";
import { skuMatchKey } from "@/domain/stock";
import { addProductSupplier, updateProductSupplier } from "@/server/purchasing/suppliers";
import { listPurchasePlanner } from "@/server/purchasing/service";
import {
  addSupplierAutopartGroup,
  setSupplierAutopartGroupActive,
} from "@/server/purchasing/autopart-supplier-groups";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).slice(-6).toUpperCase();

let adminId = "";
let accountsId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

function row(sku: string, group: string, extra: Partial<Native231Po3NewRow> = {}): Native231Po3NewRow {
  return {
    sku,
    description: `Part ${sku}`,
    group,
    stk: "6.0000",
    avail: "4.0000",
    pick: "0.0000",
    physical: "6.0000",
    cost: "2.50",
    incoming: "3.0000",
    condition: "W",
    subGrp: "NOTGRP",
    trailerGroup: "LATER",
    ...extra,
  };
}

async function apply(rows: Native231Po3NewRow[]) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await applyStockFeed({
        text: buildNative231Po3New(rows),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "CONFLICT" || attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("stock sync lock was not released");
}

async function product(sku: string) {
  return prisma.autopartProduct.findUniqueOrThrow({ where: { matchKey: skuMatchKey(sku) } });
}

async function links(sku: string) {
  return prisma.productSupplier.findMany({
    where: { matchKey: skuMatchKey(sku) },
    orderBy: { supplierId: "asc" },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`grp.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  accountsId = await ensureUser(`grp.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  const catalogue = await saveProduct(adminId, {
    sku: `GCAT${stamp}`,
    name: "Group catalogue item",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: catalogue.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true, slug: `group-cat-${stamp}` },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Autopart Group supplier mapping", () => {
  it("maps groups explicitly, backfills, and keeps stock fields intact", async () => {
    const catalogueSku = `GCAT${stamp}`;
    const externalSku = `GEXT${stamp}`;
    const manualSku = `GMAN${stamp}`;
    const changeSku = `GCHG${stamp}`;
    const unmappedSku = `GUNM${stamp}`;
    const base = stamp.slice(0, 5);
    const sxGroup = `${base}X`;
    const stGroup = `${base}T`;
    const zzGroup = `${base}Z`;
    const abGroup = `${base}A`;
    const imported = await apply([
      row(catalogueSku, sxGroup),
      row(externalSku, sxGroup),
      row(manualSku, sxGroup),
      row(changeSku, sxGroup),
      row(unmappedSku, sxGroup),
    ]);
    expect(imported.supplierGroups?.relationshipsCreated).toBe(0);
    expect(imported.supplierGroups?.unmappedGroups).toBeGreaterThan(0);

    for (const sku of [catalogueSku, externalSku]) {
      const saved = await product(sku);
      expect(saved.groupCode).toBe(sxGroup);
      expect(saved.availQty).toBe(4);
      expect(saved.incomingQty).toBe(3);
      expect(saved.latestCost?.toString()).toBe("2.5");
      expect(saved.conditionCode).toBe("W");
    }
    expect((await product(catalogueSku)).catalogueVariantId).toBeTruthy();
    expect((await product(externalSku)).catalogueVariantId).toBeNull();

    const saxon = await prisma.supplier.create({
      data: { name: `Saxon ${stamp}`, code: `SAXON-${stamp}`, active: true },
    });
    const street = await prisma.supplier.create({
      data: { name: `Streetwize ${stamp}`, code: `STREET-${stamp}`, active: true },
    });
    const other = await prisma.supplier.create({
      data: { name: `Other ${stamp}`, code: `OTHER-${stamp}`, active: true },
    });

    const mapped = await addSupplierAutopartGroup(adminId, { supplierId: saxon.id, groupCode: ` ${sxGroup.toLowerCase()} ` });
    expect(mapped.groupCode).toBe(sxGroup);
    expect(mapped.reconciliation.matchedProducts).toBeGreaterThanOrEqual(5);
    expect(mapped.reconciliation.relationshipsCreated).toBeGreaterThanOrEqual(5);
    expect(saxon.code).not.toBe(sxGroup);

    const second = await addSupplierAutopartGroup(adminId, { supplierId: saxon.id, groupCode: abGroup });
    expect(second.groupCode).toBe(abGroup);
    await expect(
      addSupplierAutopartGroup(adminId, { supplierId: street.id, groupCode: sxGroup }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addSupplierAutopartGroup(accountsId, { supplierId: saxon.id, groupCode: "QQ" })).rejects.toBeInstanceOf(
      AuthError,
    );

    const catalogueLink = (await links(catalogueSku)).find((link) => link.supplierId === saxon.id);
    const externalLink = (await links(externalSku)).find((link) => link.supplierId === saxon.id);
    expect(catalogueLink).toMatchObject({ source: "AUTOPART_GROUP", autopartGroupCode: sxGroup, active: true, isPreferred: true });
    expect(externalLink).toMatchObject({ source: "AUTOPART_GROUP", active: true, isPreferred: true });

    const preferredManual = await addProductSupplier(adminId, {
      supplierId: other.id,
      sku: manualSku,
      isPreferred: true,
    });
    const afterManual = await links(manualSku);
    expect(afterManual.find((link) => link.id === preferredManual.id)).toMatchObject({
      source: "MANUAL",
      isPreferred: true,
      active: true,
    });
    expect(afterManual.find((link) => link.supplierId === saxon.id)).toMatchObject({
      source: "AUTOPART_GROUP",
      isPreferred: false,
      active: true,
    });
    expect(afterManual.filter((link) => link.active && link.isPreferred)).toHaveLength(1);

    const changeLink = (await links(changeSku)).find((link) => link.supplierId === saxon.id);
    expect(changeLink?.source).toBe("AUTOPART_GROUP");
    await updateProductSupplier(adminId, { id: changeLink!.id, supplierSku: "KEEP-ME" });
    const converted = await prisma.productSupplier.findUniqueOrThrow({ where: { id: changeLink!.id } });
    expect(converted.source).toBe("MANUAL");

    await addSupplierAutopartGroup(adminId, { supplierId: street.id, groupCode: stGroup });
    const changed = await apply([
      row(catalogueSku, sxGroup),
      row(externalSku, sxGroup),
      row(manualSku, sxGroup),
      row(changeSku, stGroup),
      row(unmappedSku, zzGroup, { condition: "S", avail: "9.0000", incoming: "1.0000", cost: "4.00" }),
    ]);
    expect(changed.supplierGroups?.manualOverridesPreserved).toBeGreaterThanOrEqual(1);
    expect(changed.status).not.toBe("FAILED");

    const changeRows = await links(changeSku);
    expect(changeRows.find((link) => link.supplierId === saxon.id)).toMatchObject({
      source: "MANUAL",
      active: true,
      supplierSku: "KEEP-ME",
    });
    expect(changeRows.find((link) => link.supplierId === street.id)).toMatchObject({
      source: "AUTOPART_GROUP",
      autopartGroupCode: stGroup,
      active: true,
    });
    const unmappedRows = await links(unmappedSku);
    expect(unmappedRows.find((link) => link.supplierId === saxon.id)).toMatchObject({
      source: "AUTOPART_GROUP",
      active: false,
      isPreferred: false,
    });
    expect(unmappedRows.filter((link) => link.active)).toHaveLength(0);
    const unmappedProduct = await product(unmappedSku);
    expect(unmappedProduct.groupCode).toBe(zzGroup);
    expect(unmappedProduct.availQty).toBe(9);
    expect(unmappedProduct.incomingQty).toBe(1);
    expect(unmappedProduct.conditionCode).toBe("S");
    expect(unmappedProduct.latestCost?.toString()).toBe("4");

    const beforeQty = await listPurchasePlanner(adminId, { q: externalSku, pageSize: 20 });
    const externalBefore = beforeQty.rows.find((line) => line.sku === externalSku);
    expect(externalBefore?.supplier.supplierId).toBe(saxon.id);
    expect(externalBefore?.suggestedQty).toBeGreaterThanOrEqual(0);

    const deactivated = await setSupplierAutopartGroupActive(adminId, { id: mapped.id, active: false });
    expect(deactivated.active).toBe(false);
    const externalAfterOff = await links(externalSku);
    expect(externalAfterOff.find((link) => link.supplierId === saxon.id)?.active).toBe(false);
    const manualStill = await links(changeSku);
    expect(manualStill.find((link) => link.supplierId === saxon.id)?.active).toBe(true);

    const restored = await setSupplierAutopartGroupActive(adminId, { id: mapped.id, active: true });
    expect(restored.active).toBe(true);
    expect((await links(externalSku)).find((link) => link.supplierId === saxon.id)).toMatchObject({
      source: "AUTOPART_GROUP",
      active: true,
      isPreferred: true,
    });
    expect((await links(catalogueSku)).find((link) => link.supplierId === saxon.id)?.active).toBe(true);

    const planner = await listPurchasePlanner(adminId, { q: externalSku, supplierId: saxon.id, pageSize: 20 });
    expect(planner.rows.some((line) => line.sku === externalSku)).toBe(true);
    const unassigned = await listPurchasePlanner(adminId, { q: externalSku, supplierId: "unassigned", pageSize: 20 });
    expect(unassigned.rows.some((line) => line.sku === externalSku)).toBe(false);
    const afterQty = planner.rows.find((line) => line.sku === externalSku);
    expect(afterQty?.suggestedQty).toBe(externalBefore?.suggestedQty);

    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "SupplierAutopartGroup", entityId: mapped.id },
      select: { action: true, metadata: true },
    });
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "purchasing.supplier_autopart_group.create",
        "purchasing.supplier_autopart_group.deactivate",
        "purchasing.supplier_autopart_group.reactivate",
      ]),
    );

    const pub = await getPublicProduct(null, `group-cat-${stamp}`);
    const serialised = JSON.stringify(pub);
    expect(serialised).not.toContain(`Saxon ${stamp}`);
    expect(serialised).not.toContain("groupCode");
    expect(serialised).not.toContain("AUTOPART_GROUP");
  });
});
