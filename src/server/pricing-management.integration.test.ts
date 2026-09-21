import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct } from "@/server/catalogue/products";
import {
  addPriceListItems,
  applyPriceListCsv,
  assignCompanyToPriceList,
  bulkUpdatePriceListItems,
  deleteCustomerPrice,
  deletePriceListItem,
  deleteQuantityBreak,
  exportPriceListCsv,
  getPriceList,
  listCommercialAudit,
  listCustomerPrices,
  listPriceListCompanies,
  listPriceListItems,
  listPriceLists,
  listPromotions,
  listQuantityBreaks,
  previewPriceListCsv,
  previewTradePriceAsCustomer,
  pricingOverview,
  upsertCustomerPrice,
  upsertPriceList,
  upsertPriceListItem,
  upsertPromotion,
  upsertQuantityBreak,
} from "@/server/pricing/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
let adminId = "";
let viewerId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("pricing.mgmt.admin@example.invalid", ["SUPER_ADMIN"]);
  viewerId = await ensureUser("pricing.mgmt.viewer@example.invalid", ["SALES_REPRESENTATIVE"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture(label: string) {
  const sku = `P4B-${label}-${Date.now()}`;
  const product = await saveProduct(adminId, {
    sku,
    name: `${label} Window & Glass Cleaner 5 Litre`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 8.7,
    rrp: 17.99,
    packQty: 1,
    caseQty: 6,
    description: "phase4b",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  return { sku: variant.sku, product, variant };
}

describe("Phase 4B commercial management", () => {
  it("lists price lists and opens a detail workspace with difference vs base", async () => {
    const { sku, variant } = await fixture("list");
    const list = await upsertPriceList(adminId, { name: `Distributor ${sku}` });
    await upsertPriceListItem(adminId, { priceListId: list.id, variantId: variant.id, unitPrice: 7.95 });
    const lists = await listPriceLists(adminId);
    expect(lists.some((row) => row.id === list.id && row.itemCount >= 1)).toBe(true);
    const detail = await getPriceList(adminId, list.id);
    expect(detail.name).toContain("Distributor");
    const items = await listPriceListItems(adminId, { priceListId: list.id, q: sku });
    expect(items.items[0]?.sku).toBe(sku);
    expect(items.items[0]?.brand).toBe("Power Maxed");
    expect(items.items[0]?.differencePercent).toBe("-8.6%");
    const overview = await pricingOverview(adminId);
    expect(overview.priceLists).toBeGreaterThan(0);
  });

  it("adds, bulk-edits, and removes products without duplicating unique pairs", async () => {
    const { variant, sku } = await fixture("items");
    const list = await upsertPriceList(adminId, { name: `Items ${sku}` });
    const added = await addPriceListItems(adminId, {
      priceListId: list.id,
      items: [{ variantId: variant.id, unitPrice: 7.95 }],
    });
    expect(added.created).toBe(1);
    const dup = await addPriceListItems(adminId, {
      priceListId: list.id,
      items: [{ variantId: variant.id, unitPrice: 7.5 }],
    });
    expect(dup.created).toBe(0);
    expect(dup.skippedDuplicates).toEqual([variant.id]);
    const count = await prisma.priceListItem.count({ where: { priceListId: list.id, variantId: variant.id } });
    expect(count).toBe(1);
    await bulkUpdatePriceListItems(adminId, {
      priceListId: list.id,
      items: [{ variantId: variant.id, unitPrice: 7.5 }],
    });
    const after = await listPriceListItems(adminId, { priceListId: list.id });
    expect(after.items[0]?.unitPrice).toBe(7.5);
    await deletePriceListItem(adminId, after.items[0]!.id);
    const empty = await listPriceListItems(adminId, { priceListId: list.id });
    expect(empty.items).toHaveLength(0);
  });

  it("assigns a company via Company.priceListId and records audit", async () => {
    const { sku } = await fixture("assign");
    const list = await upsertPriceList(adminId, { name: `Assign ${sku}` });
    const company = await prisma.company.create({ data: { name: `Assign Co ${sku}`, status: "ACTIVE" } });
    await assignCompanyToPriceList(adminId, { companyId: company.id, priceListId: list.id });
    const fresh = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(fresh.priceListId).toBe(list.id);
    const assigned = await listPriceListCompanies(adminId, list.id);
    expect(assigned.some((row) => row.id === company.id)).toBe(true);
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: company.id, action: "company.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("manages customer prices including validity states and isolation", async () => {
    const { sku, variant } = await fixture("cust");
    const company = await prisma.company.create({ data: { name: `Cust ${sku}`, status: "ACTIVE" } });
    const other = await prisma.company.create({ data: { name: `Other ${sku}`, status: "ACTIVE" } });
    const future = new Date(Date.now() + 86400000 * 10).toISOString();
    await upsertCustomerPrice(adminId, {
      companyId: company.id,
      variantId: variant.id,
      unitPrice: 7.95,
      startsAt: future,
      endsAt: null,
    });
    const listed = await listCustomerPrices(adminId, company.id);
    expect(listed.items[0]?.status).toBe("scheduled");
    await upsertCustomerPrice(adminId, {
      companyId: company.id,
      variantId: variant.id,
      unitPrice: 7.95,
      startsAt: null,
      endsAt: null,
    });
    const active = await listCustomerPrices(adminId, company.id);
    expect(active.items[0]?.status).toBe("active");
    const otherList = await listCustomerPrices(adminId, other.id);
    expect(otherList.items).toHaveLength(0);
    await deleteCustomerPrice(adminId, active.items[0]!.id);
    expect((await listCustomerPrices(adminId, company.id)).items).toHaveLength(0);
  });

  it("price-as-customer uses resolver explanation and quantity, with case note", async () => {
    const { sku, variant } = await fixture("pac");
    const company = await prisma.company.create({ data: { name: `PAC ${sku}`, status: "ACTIVE" } });
    await upsertQuantityBreak(adminId, { variantId: variant.id, minQty: 12, unitPrice: 8.2 });
    const q2 = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 2 });
    const q12 = await previewTradePriceAsCustomer(adminId, { variantId: variant.id, companyId: company.id, quantity: 12 });
    expect(q2.resolved.source).toBe("BASE");
    expect(q2.resolved.explanation.baseTradePrice).toBeTruthy();
    expect(q2.winningRule).toBe("Base Trade Price");
    expect(q2.orderableNote).toMatch(/multiples of 6/);
    expect(q12.resolved.source).toBe("QUANTITY_BREAK");
    expect(q12.orderableNote).toBeNull();
  });

  it("creates, edits, and deletes quantity breaks with case information", async () => {
    const { variant, sku } = await fixture("qb");
    await upsertQuantityBreak(adminId, { variantId: variant.id, minQty: 10, unitPrice: 8.2 });
    const listed = await listQuantityBreaks(adminId, variant.id);
    expect(listed.caseQty).toBe(6);
    const volume = listed.items.filter((row) => !row.isBaseMirror);
    expect(volume[0]?.minQty).toBe(10);
    expect(volume[0]?.firstOrderableQty).toBe(12);
    expect(volume[0]?.caseNote).toMatch(/12 units/);
    await upsertQuantityBreak(adminId, { variantId: variant.id, minQty: 10, unitPrice: 8.1 });
    const updated = await listQuantityBreaks(adminId, variant.id);
    expect(updated.items.find((row) => row.minQty === 10)?.unitPrice).toBe(8.1);
    await deleteQuantityBreak(adminId, volume[0]!.id);
    const after = await listQuantityBreaks(adminId, variant.id);
    expect(after.items.filter((row) => !row.isBaseMirror)).toHaveLength(0);
    void sku;
  });

  it("creates PERCENT and FIXED promotions with product scope and rejects new QUANTITY_DEAL", async () => {
    const { sku, variant } = await fixture("promo");
    const percent = await upsertPromotion(adminId, {
      code: `PCT${Date.now()}`,
      name: "Ten off",
      type: "PERCENT",
      value: 10,
      isActive: true,
      skus: [sku],
      catalogueWide: false,
    });
    expect(percent.engineApplies).toBe(true);
    expect(percent.skus).toContain(sku);
    const fixed = await upsertPromotion(adminId, {
      code: `FIX${Date.now()}`,
      name: "Fifty off",
      type: "FIXED",
      value: 0.5,
      isActive: false,
      catalogueWide: true,
    });
    expect(fixed.status).toBe("disabled");
    expect(fixed.typeLabel).toMatch(/amount off/i);
    await expect(
      upsertPromotion(adminId, {
        code: `QD${Date.now()}`,
        name: "Deal",
        type: "QUANTITY_DEAL",
        value: 12,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    const existingDeal = await prisma.promotion.create({
      data: {
        code: `KEEP${Date.now()}`,
        name: "Legacy deal",
        type: "QUANTITY_DEAL",
        value: "12",
        isActive: true,
        metadata: {},
      },
    });
    const listed = await listPromotions(adminId);
    const kept = listed.find((row) => row.id === existingDeal.id);
    expect(kept?.engineApplies).toBe(false);
    const scheduled = await upsertPromotion(adminId, {
      id: percent.id,
      code: percent.code,
      name: percent.name,
      type: "PERCENT",
      value: 10,
      isActive: true,
      startsAt: new Date(Date.now() + 86400000 * 5).toISOString(),
      skus: [sku],
    });
    expect(scheduled.status).toBe("scheduled");
    void variant;
  });

  it("exports CSV and import preview/confirm, without creating unknown SKUs", async () => {
    const { sku, variant } = await fixture("csv");
    const list = await upsertPriceList(adminId, { name: `CSV ${sku}` });
    await upsertPriceListItem(adminId, { priceListId: list.id, variantId: variant.id, unitPrice: 7.95 });
    const exported = await exportPriceListCsv(adminId, list.id);
    expect(exported.csv).toContain("sku,productName,baseTradePrice,priceListPrice");
    expect(exported.csv).toContain(sku);
    expect(exported.csv).not.toContain("customer");
    const preview = await previewPriceListCsv(adminId, {
      priceListId: list.id,
      csv: `sku,price\n${sku},7.50\nUNKNOWN-SKU,9.00\n${sku},8.00`,
    });
    expect(preview.issues.some((i) => i.kind === "unknown_sku")).toBe(true);
    expect(preview.issues.some((i) => i.kind === "duplicate_sku")).toBe(true);
    expect(preview.ready.some((row) => row.sku === sku && row.price === 7.5)).toBe(true);
    const apply = await applyPriceListCsv(adminId, {
      priceListId: list.id,
      items: [{ sku, price: 7.5 }],
    });
    expect(apply.applied).toBe(1);
    expect(await prisma.productVariant.count({ where: { sku: "UNKNOWN-SKU" } })).toBe(0);
  });

  it("enforces pricing.view / pricing.edit and blocks trade admin access", async () => {
    const { sku } = await fixture("rbac");
    const lists = await listPriceLists(viewerId);
    expect(Array.isArray(lists)).toBe(true);
    await expect(upsertPriceList(viewerId, { name: `Noedit ${sku}` })).rejects.toBeInstanceOf(AuthError);
    const tradeId = await ensureUser(`trade.mgmt.${Date.now()}@example.invalid`, [], "TRADE");
    const own = await prisma.company.create({ data: { name: `Trade ${sku}`, status: "ACTIVE" } });
    await prisma.companyUser.create({
      data: { companyId: own.id, userId: tradeId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });
    await expect(listPriceLists(tradeId)).rejects.toBeInstanceOf(AuthError);
  });

  it("reflects saved commercial changes on the customer-facing resolver and audits mutations", async () => {
    const { sku, variant } = await fixture("live");
    const list = await upsertPriceList(adminId, { name: `Live ${sku}` });
    await upsertPriceListItem(adminId, { priceListId: list.id, variantId: variant.id, unitPrice: 7.6 });
    const company = await prisma.company.create({ data: { name: `Live Co ${sku}`, status: "ACTIVE", priceListId: list.id } });
    const tradeId = await ensureUser(`trade.live.${Date.now()}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: { companyId: company.id, userId: tradeId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });
    const asCustomer = await getPublicProduct(tradeId, sku);
    expect(asCustomer?.card.price.trade).toBe(7.6);
    expect(asCustomer?.card.price.source).toBe("price_list");
    const leak = await getPublicProduct(null, sku);
    expect(leak?.card.price.trade).toBeNull();
    const audit = await listCommercialAudit(adminId, { priceListId: list.id });
    expect(audit.some((row) => row.action.includes("price_list"))).toBe(true);
  });
});
