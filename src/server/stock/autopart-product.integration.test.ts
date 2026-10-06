/**
 * Internal Autopart product master — catalogue vs external vs historic-only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct, listPublicProducts } from "@/server/catalogue/products";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import {
  getAutopartProduct,
  linkAutopartProductToVariant,
  listAutopartProducts,
  loadIntelligenceByMatchKeys,
} from "@/server/stock/autopart-products";
import { getCustomerSalesEnquiry } from "@/server/sales-intelligence/enquiry";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  exportPurchasePlannerCsv,
  getPurchasingSku,
  listPurchasePlanner,
  listPurchasingForecast,
  updateSkuPurchasingSettings,
} from "@/server/purchasing/service";
import { addDaysIso, todayLondonDateOnly } from "@/domain/sales-history-period";

const prisma = new PrismaClient();
const stamp = Date.now();
const tag = stamp.toString(36).slice(-6).toUpperCase();
const today = todayLondonDateOnly();

let adminId = "";
let salesId = "";
let tradeId = "";
let companyId = "";
const catalogueSku = `APC${tag}`;
const externalSku = `APE${tag}`;
const historicSku = `APH${tag}`;
const conflictA = `Apx${tag}`;
const conflictB = `apx${tag}`;

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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

async function seedSale(sku: string, date: string, units: string, ref: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const code = company.autopartCustomerCode ?? `APR${String(stamp).slice(-6)}`;
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: code,
      documentType: "INVOICE",
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId,
      documentId: doc.id,
      autopartCustomerCode: code,
      documentType: "INVOICE",
      documentReference: ref,
      lineNumber: 1,
      sku,
      descriptionSnapshot: sku === externalSku ? "AA Heavy Duty LED Torch" : sku,
      units,
      salesNet: "40.00",
      matchStatus: "MATCHED",
      source: "561L",
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`ap.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`ap.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`ap.trade.${stamp}@example.invalid`, [], "TRADE");

  const company = await prisma.company.create({
    data: {
      name: `Autopart Retail ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: `ap.retail.${stamp}@example.invalid`,
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId,
    code: `APR${String(stamp).slice(-6)}`,
  });

  await saveProduct(adminId, {
    sku: catalogueSku,
    name: "Catalogue Cleaner",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.updateMany({
    where: { variants: { some: { sku: catalogueSku.toUpperCase() } } },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
  });

  await saveProduct(adminId, {
    sku: `${conflictA}-A`,
    name: "Conflict A",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await saveProduct(adminId, {
    sku: `${conflictB}-B`,
    name: "Conflict B",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.productVariant.update({
    where: { sku: `${conflictA}-A`.toUpperCase() },
    data: { sku: conflictA },
  });
  await prisma.productVariant.update({
    where: { sku: `${conflictB}-B`.toUpperCase() },
    data: { sku: conflictB },
  });

  const native = buildNative231Po3New([
    {
      sku: catalogueSku,
      description: "CLEANER",
      stk: "40.0000",
      avail: "36.0000",
      pick: "0.0000",
      physical: "40.0000",
      cost: "2.5000",
      incoming: "12.0000",
    },
    {
      sku: externalSku,
      description: "TORCH",
      stk: "16.0000",
      avail: "14.0000",
      pick: "0.0000",
      physical: "16.0000",
      incoming: "0.0000",
    },
    {
      sku: conflictA,
      description: "AMBIG",
      stk: "5.0000",
      avail: "5.0000",
      pick: "0.0000",
      physical: "5.0000",
      incoming: "24.0000",
    },
  ]);
  let live: Awaited<ReturnType<typeof applyStockFeed>> | null = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      live = await applyStockFeed({
        text: native,
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
      break;
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "CONFLICT" || attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  expect(["SUCCESS", "PARTIAL"]).toContain(live?.status);

  await seedSale(externalSku, addDaysIso(today, -10), "4", `AP-EXT-${stamp}`);
  await seedSale(historicSku, addDaysIso(today, -20), "2", `AP-HIST-${stamp}`);
  await seedSale(catalogueSku, addDaysIso(today, -5), "8", `AP-CAT-${stamp}`);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AutopartProduct master from 231PO3NEW", () => {
  it("creates/updates catalogue Autopart products and links the unique ProductVariant", async () => {
    const row = await prisma.autopartProduct.findUniqueOrThrow({
      where: { matchKey: catalogueSku.toUpperCase() },
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: catalogueSku.toUpperCase() },
    });
    expect(row.catalogueVariantId).toBe(variant.id);
    expect(row.availQty).toBe(36);
    expect(row.physicalQty).toBe(40);
    expect(row.incomingQty).toBe(12);
    expect(Number(row.latestCost)).toBeCloseTo(2.5, 4);
    expect(row.presentInLatestFeed).toBe(true);
    const listed = await listAutopartProducts(adminId, { q: catalogueSku, productType: "catalogue" });
    expect(listed.items.some((i) => i.sku === catalogueSku && i.kind === "CATALOGUE")).toBe(true);
  });

  it("creates an external Autopart product without a ProductVariant", async () => {
    const row = await prisma.autopartProduct.findUniqueOrThrow({
      where: { matchKey: externalSku.toUpperCase() },
    });
    expect(row.catalogueVariantId).toBeNull();
    expect(row.description).toContain("TORCH");
    expect(row.availQty).toBe(14);
    expect(row.physicalQty).toBe(16);
    expect(row.incomingQty).toBe(0);
    expect(Number(row.latestCost)).toBeCloseTo(1.41, 4);
    expect(await prisma.productVariant.findUnique({ where: { sku: externalSku } })).toBeNull();
    expect(await prisma.inventory.count({ where: { variant: { sku: externalSku } } })).toBe(0);
    expect(await prisma.stockFeedUnmatched.count({ where: { sku: externalSku } })).toBe(0);
    const listed = await listAutopartProducts(adminId, { q: externalSku, productType: "external" });
    expect(listed.items[0]?.kind).toBe("EXTERNAL");
    expect(listed.items[0]?.availLine).toMatch(/14 available|Stock data delayed/);
    expect(listed.items[0]?.incomingLine).toMatch(/No incoming stock|Incoming delayed/);
  });

  it("does not silently link duplicate catalogue SKU conflicts", async () => {
    const row = await prisma.autopartProduct.findUniqueOrThrow({
      where: { matchKey: conflictA.toUpperCase() },
    });
    expect(row.catalogueVariantId).toBeNull();
    expect(row.availQty).toBe(5);
    expect(row.incomingQty).toBe(24);
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: [conflictA, conflictB] } },
      select: { id: true },
    });
    expect(await prisma.inventory.count({ where: { variantId: { in: variants.map((v) => v.id) } } })).toBe(0);
  });

  it("keeps 0 incoming and does not invent historic-only stock", async () => {
    expect(await prisma.autopartProduct.findUnique({ where: { matchKey: historicSku.toUpperCase() } })).toBeNull();
    const intel = await loadIntelligenceByMatchKeys([externalSku, historicSku, catalogueSku]);
    expect(intel.get(historicSku.toUpperCase())?.kind).toBe("HISTORIC_ONLY");
    expect(intel.get(historicSku.toUpperCase())?.availLine).toBe("Historic only");
    expect(intel.get(externalSku.toUpperCase())?.kind).toBe("EXTERNAL");
    expect(intel.get(catalogueSku.toUpperCase())?.kind).toBe("CATALOGUE");
  });
});

describe("privacy", () => {
  it("hides external products from public and trade catalogue APIs", async () => {
    const pub = await listPublicProducts({ userId: null, q: externalSku });
    expect(pub.items.some((i) => i.sku === externalSku)).toBe(false);
    expect(await getPublicProduct(null, externalSku)).toBeNull();
    expect(await getPublicProduct(tradeId, externalSku)).toBeNull();
    await expect(listAutopartProducts(tradeId, { q: externalSku })).rejects.toBeInstanceOf(AuthError);
    await expect(getAutopartProduct(tradeId, externalSku)).rejects.toBeInstanceOf(AuthError);
  });

  it("lets internal staff see exact stock and cost, never on public JSON", async () => {
    const detail = await getAutopartProduct(adminId, externalSku);
    expect(detail.availQty).toBe(14);
    expect(detail.incomingQty).toBe(0);
    expect(detail.latestCost).toBeTruthy();
    const pubCat = await getPublicProduct(null, catalogueSku);
    expect(pubCat).toBeTruthy();
    expect(JSON.stringify(pubCat)).not.toMatch(/latestCost/);
    expect(pubCat).not.toHaveProperty("qtyOnHand");
  });
});

describe("Sales Intelligence", () => {
  it("shows live stock for Retail external SKUs and Historic only when absent from 231PO3NEW", async () => {
    const enquiry = await getCustomerSalesEnquiry(salesId, {
      companyId,
      period: "CUSTOM",
      from: addDaysIso(today, -40),
      to: today,
      pageSize: 50,
    });
    const ext = enquiry.products.items.find((p) => p.sku === externalSku);
    const hist = enquiry.products.items.find((p) => p.sku === historicSku);
    expect(ext?.productKind).toBe("EXTERNAL");
    expect(ext?.productKindLabel).toBe("External product");
    expect(ext?.availableQty).toBe(14);
    expect(ext?.incomingQty).toBe(0);
    expect(ext?.availLine).toMatch(/14 available|Stock data delayed/);
    expect(hist?.productKind).toBe("HISTORIC_ONLY");
    expect(hist?.productKindLabel).toBe("Historic only");
    expect(hist?.availLine).toBe("Historic only");
  });
});

describe("Purchasing Intelligence", () => {
  it("forecasts external products without ProductVariant and keeps catalogue settings", async () => {
    const forecast = await listPurchasingForecast(adminId, { q: externalSku, productType: "external" });
    const row = forecast.rows.find((r) => r.sku === externalSku);
    expect(row).toBeTruthy();
    expect(row?.productKind).toBe("EXTERNAL");
    expect(row?.availableQty).toBe(14);
    expect(row?.incomingQty).toBe(0);
    expect(row?.forecastConfidence).toBeTruthy();
    expect(row?.purchase.suggestedQty).toBeGreaterThanOrEqual(0);

    const updated = await updateSkuPurchasingSettings(adminId, {
      sku: externalSku,
      leadTimeDays: 14,
      minimumOrderQty: 6,
      orderMultiple: 6,
      safetyStockQty: 2,
      targetCoverWeeks: 8,
      supplierName: "AA",
    });
    expect(updated.forecast.purchasing.leadTimeDays).toBe(14);
    expect(updated.forecast.purchasing.minimumOrderQty).toBe(6);
    expect(await prisma.variantPurchasingSettings.count({ where: { variant: { sku: externalSku } } })).toBe(0);
    expect(
      await prisma.autopartProductPurchasingSettings.count({
        where: { autopartProduct: { matchKey: externalSku.toUpperCase() } },
      }),
    ).toBe(1);

    const cat = await updateSkuPurchasingSettings(adminId, {
      sku: catalogueSku,
      leadTimeDays: 7,
      minimumOrderQty: 12,
    });
    expect(cat.forecast.purchasing.leadTimeDays).toBe(7);
    expect(
      await prisma.variantPurchasingSettings.count({
        where: { variant: { sku: catalogueSku.toUpperCase() } },
      }),
    ).toBe(1);

    const planner = await listPurchasePlanner(adminId, { q: externalSku });
    expect(planner.rows.some((r) => r.sku === externalSku && r.productKind === "EXTERNAL")).toBe(true);
    const csv = await exportPurchasePlannerCsv(adminId, { q: externalSku });
    expect(csv.csv).toContain("Product Type");
    expect(csv.csv).toContain("External product");
    expect(csv.csv).toContain(externalSku);

    const catForecast = await listPurchasingForecast(adminId, { q: catalogueSku, productType: "catalogue" });
    expect(catForecast.rows.some((r) => r.sku === catalogueSku && r.productKind === "CATALOGUE")).toBe(true);
  });

  it("does not require a catalogue ProductVariant for SKU drill-down", async () => {
    const sku = await getPurchasingSku(adminId, externalSku);
    expect(sku.forecast.productKind).toBe("EXTERNAL");
    expect(sku.forecast.availableQty).toBe(14);
  });
});

describe("optional catalogue linking", () => {
  it("links an external Autopart product to an existing variant without creating products", async () => {
    const extraSku = `LNK${tag}`;
    await saveProduct(adminId, {
      sku: extraSku,
      name: "Later linked",
      brand: "Power Maxed",
      category: "Cleaning",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const orphanSku = `ORP${tag}`;
    await applyStockFeed({
      text: buildNative231Po3New([
        {
          sku: orphanSku,
          description: "ORPHAN",
          stk: "40.0000",
          avail: "3.0000",
          pick: "0.0000",
          physical: "3.0000",
          incoming: "0.0000",
        },
        {
          sku: catalogueSku,
          description: "CLEANER",
          stk: "40.0000",
          avail: "36.0000",
          pick: "0.0000",
          physical: "40.0000",
          cost: "2.5000",
          incoming: "12.0000",
        },
      ]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const linked = await linkAutopartProductToVariant(adminId, { sku: orphanSku, variantSku: extraSku });
    expect(linked.kind).toBe("CATALOGUE");
    expect(linked.catalogueVariantId).toBeTruthy();
    expect(await prisma.productVariant.count({ where: { sku: orphanSku } })).toBe(0);
  });
});
