import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { moneyToString, moneyFromUnknown } from "@/domain/money";
import { saveProduct } from "@/server/catalogue/service";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { upsertCustomerPrice, upsertPriceList, upsertPriceListItem, upsertPromotion } from "@/server/pricing/service";
import {
  approveCustomerPriceImport,
  exportCustomerNegotiatedPricesCsv,
  previewCustomerPriceImport,
  rejectCustomerPriceImport,
  setCustomerPriceImportDecisionAuditWriterForTests,
  submitCustomerPriceImport,
} from "@/server/pricing/customer-price-import";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = `${Date.now()}`;
let adminId = "";
let managerId = "";
let repId = "";
let otherRepId = "";
let serviceId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
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
  adminId = await ensureUser(`cpi.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  managerId = await ensureUser(`cpi.manager.${stamp}@example.invalid`, ["MANAGEMENT"]);
  repId = await ensureUser(`cpi.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  otherRepId = await ensureUser(`cpi.other.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  serviceId = await ensureUser(`cpi.service.${stamp}@example.invalid`, ["CUSTOMER_SERVICE"]);
  const rep = await prisma.salesRep.create({
    data: { userId: repId, code: `CPI-${stamp}`, displayName: `Rep ${stamp}`, active: true },
  });
  const other = await prisma.salesRep.create({
    data: { userId: otherRepId, code: `CPIB-${stamp}`, displayName: `Other ${stamp}`, active: true },
  });
  await prisma.companyAssignment.create({
    data: {
      companyId: (await ownedCompany()).id,
      salesRepId: rep.id,
      isPrimary: true,
    },
  });
  void other;
});

let ownedId = "";
async function ownedCompany() {
  if (!ownedId) {
    ownedId = (await prisma.company.create({ data: { name: `CPI Owned ${stamp}`, status: "ACTIVE", accountNumber: `AC${stamp}` } })).id;
  }
  return prisma.company.findUniqueOrThrow({ where: { id: ownedId } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  setCustomerPriceImportDecisionAuditWriterForTests(null);
});

async function product(label: string, trade = 20) {
  const sku = `CPI-${label.slice(0, 12)}-${stamp.slice(-6)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const saved = await saveProduct(adminId, {
    sku,
    name: `${label} cleaner`,
    brand: "Power Maxed",
    category: "Braking",
    trade,
    rrp: 30,
    packQty: 1,
    caseQty: 1,
    description: "customer price import",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: saved.id } });
  return variant;
}

function csvFor(rows: string[]) {
  return ["SKU,Customer Price Ex VAT,Valid From,Valid Until", ...rows].join("\n");
}

async function upload(actorId: string, companyId: string, csv: string, filename = "prices.csv") {
  return previewCustomerPriceImport(actorId, {
    companyId,
    filename,
    fileBase64: Buffer.from(csv).toString("base64"),
  });
}

async function priceOf(companyId: string, variantId: string) {
  const row = await prisma.customerPrice.findUnique({
    where: { companyId_variantId: { companyId, variantId } },
  });
  return row ? moneyToString(moneyFromUnknown(row.unitPrice)!) : null;
}

describe("customer price import workflow", () => {
  it("adds and updates only the selected customer and preserves omitted prices", async () => {
    const company = await ownedCompany();
    const other = await prisma.company.create({ data: { name: `CPI Other ${stamp}`, status: "ACTIVE" } });
    const kept = await product("kept", 8);
    const changed = await product("changed", 20);
    const added = await product("added", 20);
    const list = await upsertPriceList(adminId, { name: `CPI list ${changed.sku}` });
    await upsertPriceListItem(adminId, { priceListId: list.id, variantId: changed.id, unitPrice: 18 });
    await prisma.company.update({ where: { id: company.id }, data: { priceListId: list.id } });
    await upsertCustomerPrice(adminId, { companyId: company.id, variantId: kept.id, unitPrice: 4, startsAt: null, endsAt: null });
    await upsertCustomerPrice(adminId, { companyId: company.id, variantId: changed.id, unitPrice: 10, startsAt: null, endsAt: null });
    await upsertCustomerPrice(adminId, { companyId: other.id, variantId: changed.id, unitPrice: 5, startsAt: null, endsAt: null });
    const tradeBefore = String(changed.tradePrice);
    const listBefore = await prisma.priceListItem.findFirstOrThrow({ where: { priceListId: list.id, variantId: changed.id } });

    const preview = await upload(
      repId,
      company.id,
      csvFor([`${changed.sku},12.3456,,`, `${added.sku},16.50,,`]),
    );
    expect(preview.companyName).toBe(company.name);
    expect(preview.accountCode).toBe(`AC${stamp}`);
    expect(preview.newCount).toBe(1);
    expect(preview.updateCount).toBe(1);
    expect(preview.invalidCount).toBe(0);
    expect(preview.canSubmit).toBe(true);
    expect(await priceOf(company.id, added.id)).toBeNull();

    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    expect(await priceOf(company.id, added.id)).toBeNull();
    await expect(approveCustomerPriceImport(repId, company.id, preview.importId!)).rejects.toBeInstanceOf(AuthError);
    expect(await priceOf(company.id, added.id)).toBeNull();

    const order = await prisma.order.create({
      data: {
        orderNumber: `CPI-${stamp}-${added.sku}`,
        companyId: company.id,
        status: "CONFIRMED",
        subtotal: "9.99",
        vatTotal: "2.00",
        grandTotal: "11.99",
        items: {
          create: {
            variantId: added.id,
            sku: added.sku,
            name: "Historical line",
            qty: 1,
            unitPrice: "9.9900",
            customerUnitPrice: "9.99",
            vatRate: "20.00",
            lineTotal: "9.99",
          },
        },
      },
    });

    const approved = await approveCustomerPriceImport(managerId, company.id, preview.importId!);
    expect(approved.status).toBe("APPROVED");
    expect(await priceOf(company.id, added.id)).toBe("16.5000");
    expect(await priceOf(company.id, changed.id)).toBe("12.3456");
    expect(await priceOf(company.id, kept.id)).toBe("4.0000");
    expect(await priceOf(other.id, changed.id)).toBe("5.0000");
    const companyAfter = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(companyAfter.priceListId).toBe(list.id);
    expect(String((await prisma.productVariant.findUniqueOrThrow({ where: { id: changed.id } })).tradePrice)).toBe(tradeBefore);
    const listAfter = await prisma.priceListItem.findFirstOrThrow({ where: { id: listBefore.id } });
    expect(moneyToString(moneyFromUnknown(listAfter.unitPrice)!)).toBe("18.0000");

    const resolved = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: company.id,
      quantity: 1,
    });
    const quotePrice = resolved.get(added.id)!;
    expect(quotePrice.source).toBe("CUSTOMER");
    expect(quotePrice.unitPriceExVat).toBe("16.5000");
    expect(quotePrice.vatPercent).toBe(20);
    expect(quotePrice.unitPriceIncVat).toBe("19.80");
    const otherResolved = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: other.id,
      quantity: 1,
    });
    expect(otherResolved.get(added.id)?.source).not.toBe("CUSTOMER");

    const historical = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(moneyToString(moneyFromUnknown(historical.unitPrice)!)).toBe("9.9900");

    const legacy = await upsertPromotion(adminId, {
      code: `CPI${stamp}${added.sku}`.slice(0, 40),
      name: "Ten off import",
      type: "PERCENT",
      value: 10,
      isActive: true,
      skus: [added.sku],
      catalogueWide: false,
    });
    const legacyResolved = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: company.id,
      quantity: 1,
    });
    expect(legacy.campaignStatus).toBe("LEGACY");
    expect(legacyResolved.get(added.id)?.source).toBe("PROMOTION");
    expect(legacyResolved.get(added.id)?.unitPriceExVat).toBe("14.8500");
    expect(await priceOf(company.id, added.id)).toBe("16.5000");

    const protectedCampaign = await prisma.promotion.create({
      data: {
        code: `NEW${stamp}`.slice(0, 20),
        name: "Protected negotiated prices",
        type: "PERCENT",
        value: "10.0000",
        isActive: true,
        campaignStatus: "APPROVED",
        appliesToNegotiatedPrices: false,
        metadata: { skus: [added.sku] },
      },
    });
    await prisma.promotion.update({ where: { id: legacy.id }, data: { isActive: false } });
    const held = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: company.id,
      quantity: 1,
    });
    expect(held.get(added.id)?.source).toBe("CUSTOMER");
    expect(held.get(added.id)?.unitPriceExVat).toBe("16.5000");
    const otherOffer = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: other.id,
      quantity: 1,
    });
    expect(otherOffer.get(added.id)?.source).toBe("PROMOTION");
    expect(otherOffer.get(added.id)?.unitPriceExVat).toBe("18.0000");
    await prisma.promotion.update({
      where: { id: protectedCampaign.id },
      data: { appliesToNegotiatedPrices: true },
    });
    const permitted = await resolveVariantTradePrices({
      variants: [{ id: added.id, sku: added.sku, tradePrice: added.tradePrice, vatCode: added.vatCode }],
      companyId: company.id,
      quantity: 1,
    });
    expect(permitted.get(added.id)?.source).toBe("PROMOTION");
    expect(permitted.get(added.id)?.unitPriceExVat).toBe("14.8500");
  });

  it("blocks other accounts, customer service, and a second submission of the same batch", async () => {
    const company = await ownedCompany();
    const hidden = await prisma.company.create({ data: { name: `CPI Hidden ${stamp}`, status: "ACTIVE" } });
    const variant = await product("perm", 11);
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},9.5000,,`]));
    await expect(upload(otherRepId, company.id, csvFor([`${variant.sku},9.5000,,`]))).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await expect(upload(serviceId, company.id, csvFor([`${variant.sku},9.5000,,`]))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(upload(repId, hidden.id, csvFor([`${variant.sku},9.5000,,`]))).rejects.toMatchObject({
      code: "COMPANY_FORBIDDEN",
    });
    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    await expect(submitCustomerPriceImport(repId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const again = await upload(repId, company.id, csvFor([`${variant.sku},9.5000,,`]));
    await expect(submitCustomerPriceImport(repId, company.id, again.importId!)).rejects.toMatchObject({
      code: "DUPLICATE",
    });
    expect(await priceOf(company.id, variant.id)).toBeNull();
    expect(await priceOf(hidden.id, variant.id)).toBeNull();
  });

  it("rejects a submission without changing live prices", async () => {
    const company = await ownedCompany();
    const variant = await product("reject", 15);
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},13.25,,`]));
    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    const rejected = await rejectCustomerPriceImport(managerId, {
      companyId: company.id,
      importId: preview.importId!,
      reason: "Price is below the agreed floor",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(await priceOf(company.id, variant.id)).toBeNull();
    const stored = await prisma.customerPriceImport.findUniqueOrThrow({ where: { id: preview.importId! } });
    expect(stored.rejectionReason).toBe("Price is below the agreed floor");
    expect(stored.decidedByUserId).toBe(managerId);
    await expect(approveCustomerPriceImport(managerId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rolls back approval when prices changed since preview", async () => {
    const company = await ownedCompany();
    const variant = await product("stale", 20);
    await upsertCustomerPrice(adminId, { companyId: company.id, variantId: variant.id, unitPrice: 10, startsAt: null, endsAt: null });
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},12.0000,,`]));
    expect(preview.updateCount).toBe(1);
    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    await prisma.customerPrice.update({
      where: { companyId_variantId: { companyId: company.id, variantId: variant.id } },
      data: { unitPrice: "11.0000" },
    });
    await expect(approveCustomerPriceImport(adminId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "STALE",
    });
    expect(await priceOf(company.id, variant.id)).toBe("11.0000");
    const stored = await prisma.customerPriceImport.findUniqueOrThrow({ where: { id: preview.importId! } });
    expect(stored.status).toBe("PENDING_APPROVAL");
  });

  it("rolls back price approval and all live price writes if its audit record cannot be stored", async () => {
    const company = await ownedCompany();
    const variant = await product("approve-audit-failure", 20);
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},9.7500,,`]));
    await submitCustomerPriceImport(repId, company.id, preview.importId!);

    setCustomerPriceImportDecisionAuditWriterForTests(async () => {
      throw new Error("Simulated audit persistence failure");
    });
    await expect(approveCustomerPriceImport(managerId, company.id, preview.importId!)).rejects.toThrow(
      "Simulated audit persistence failure",
    );
    setCustomerPriceImportDecisionAuditWriterForTests(null);

    expect(await priceOf(company.id, variant.id)).toBeNull();
    const batch = await prisma.customerPriceImport.findUniqueOrThrow({ where: { id: preview.importId! } });
    expect(batch.status).toBe("PENDING_APPROVAL");
    expect(batch.decidedAt).toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { entityId: preview.importId!, action: "pricing.customer_price_import.approved" },
      }),
    ).toBe(0);
  });

  it("rolls back price-upload rejection if its audit record cannot be stored", async () => {
    const company = await ownedCompany();
    const variant = await product("reject-audit-failure", 20);
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},11.0000,,`]));
    await submitCustomerPriceImport(repId, company.id, preview.importId!);

    setCustomerPriceImportDecisionAuditWriterForTests(async () => {
      throw new Error("Simulated audit persistence failure");
    });
    await expect(
      rejectCustomerPriceImport(managerId, {
        companyId: company.id,
        importId: preview.importId!,
        reason: "Not approved",
      }),
    ).rejects.toThrow("Simulated audit persistence failure");
    setCustomerPriceImportDecisionAuditWriterForTests(null);

    const batch = await prisma.customerPriceImport.findUniqueOrThrow({ where: { id: preview.importId! } });
    expect(batch.status).toBe("PENDING_APPROVAL");
    expect(batch.decidedByUserId).toBeNull();
    expect(batch.rejectionReason).toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { entityId: preview.importId!, action: "pricing.customer_price_import.rejected" },
      }),
    ).toBe(0);
  });

  it("does not overwrite a new negotiated price added after the upload preview", async () => {
    const company = await ownedCompany();
    const variant = await product("new-price-race", 20);
    const preview = await upload(repId, company.id, csvFor([`${variant.sku},9.0000,,`]));
    expect(preview.newCount).toBe(1);
    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    await upsertCustomerPrice(adminId, {
      companyId: company.id,
      variantId: variant.id,
      unitPrice: 8,
      startsAt: null,
      endsAt: null,
    });

    await expect(approveCustomerPriceImport(managerId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "STALE",
    });
    expect(await priceOf(company.id, variant.id)).toBe("8.0000");
    const batch = await prisma.customerPriceImport.findUniqueOrThrow({ where: { id: preview.importId! } });
    expect(batch.status).toBe("PENDING_APPROVAL");
  });

  it("does not apply an approval twice", async () => {
    const company = await ownedCompany();
    const variant = await product("once", 20);
    const preview = await upload(managerId, company.id, csvFor([`${variant.sku},8.2500,,`]));
    await submitCustomerPriceImport(managerId, company.id, preview.importId!);
    await approveCustomerPriceImport(adminId, company.id, preview.importId!);
    await expect(approveCustomerPriceImport(adminId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await prisma.customerPrice.count({ where: { companyId: company.id, variantId: variant.id } })).toBe(1);
    expect(await priceOf(company.id, variant.id)).toBe("8.2500");
  });

  it("imports an xlsx preview and exports the current negotiated prices safely", async () => {
    const company = await ownedCompany();
    const variant = await product("sheet", 20);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Prices");
    sheet.addRow(["SKU", "Customer Price Ex VAT", "Valid From", "Valid Until"]);
    sheet.addRow([variant.sku, 7.25, "2026-06-01", "2026-06-30"]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const preview = await previewCustomerPriceImport(repId, {
      companyId: company.id,
      filename: "negotiated.xlsx",
      fileBase64: bytes.toString("base64"),
    });
    expect(preview.productsFound).toBe(1);
    expect(preview.lines[0]?.proposedPrice).toBe("7.2500");
    expect(preview.lines[0]?.startsAt).toBe("2026-06-01T00:00:00.000Z");
    await submitCustomerPriceImport(repId, company.id, preview.importId!);
    await approveCustomerPriceImport(managerId, company.id, preview.importId!);
    const exported = await exportCustomerNegotiatedPricesCsv(repId, company.id);
    expect(exported.csv).toContain(variant.sku);
    expect(exported.csv).toContain("7.2500");
    expect(exported.csv.startsWith("SKU,Product,Customer Price Ex VAT")).toBe(true);
  });

  it("reimports an exported file and keeps matching on SKU when the product name changes", async () => {
    const company = await ownedCompany();
    const other = await prisma.company.create({ data: { name: `CPI Round Other ${stamp}`, status: "ACTIVE" } });
    const variant = await product("round", 20);
    await upsertCustomerPrice(adminId, {
      companyId: other.id,
      variantId: variant.id,
      unitPrice: 3,
      startsAt: null,
      endsAt: null,
    });
    const first = await upload(repId, company.id, csvFor([`${variant.sku},10.0000,,`]));
    await submitCustomerPriceImport(repId, company.id, first.importId!);
    await approveCustomerPriceImport(managerId, company.id, first.importId!);

    const exported = await exportCustomerNegotiatedPricesCsv(repId, company.id);
    const source = exported.csv.split("\n").find((row) => row.startsWith(`${variant.sku},`));
    expect(source).toBeTruthy();
    const cells = source!.split(",");
    cells[1] = "Not This Product";
    cells[2] = "11.5000";
    const reimport = await upload(
      repId,
      company.id,
      `SKU,Product,Customer Price Ex VAT,Valid From,Valid Until\n${cells.join(",")}\n`,
      "reimport.csv",
    );
    expect(reimport.fileIssues).toEqual([]);
    expect(reimport.lines[0]).toMatchObject({
      sku: variant.sku,
      variantId: variant.id,
      productName: "round cleaner",
      proposedPrice: "11.5000",
      action: "UPDATE",
    });
    expect(await priceOf(company.id, variant.id)).toBe("10.0000");
    await submitCustomerPriceImport(repId, company.id, reimport.importId!);
    expect(await priceOf(company.id, variant.id)).toBe("10.0000");
    await approveCustomerPriceImport(managerId, company.id, reimport.importId!);
    expect(await priceOf(company.id, variant.id)).toBe("11.5000");
    expect(await priceOf(other.id, variant.id)).toBe("3.0000");
  });

  it("provisions pricing.approve through the production RBAC bootstrap", async () => {
    await bootstrapRbac(prisma);
    const keysFor = async (roleKey: string) => {
      const role = await prisma.role.findUniqueOrThrow({
        where: { key: roleKey },
        include: { permissions: { include: { permission: true } } },
      });
      return role.permissions.map((row) => row.permission.key);
    };
    expect(await prisma.permission.findUnique({ where: { key: "pricing.approve" } })).toBeTruthy();
    expect(await keysFor("MANAGEMENT")).toContain("pricing.approve");
    expect(await keysFor("SUPER_ADMIN")).toContain("pricing.approve");
    expect(await keysFor("SALES_REPRESENTATIVE")).not.toContain("pricing.approve");
    expect(await keysFor("SALES_MANAGER")).not.toContain("pricing.approve");
    expect(await keysFor("CUSTOMER_SERVICE")).not.toContain("pricing.approve");
  });

  it("still lets a pricing editor save a customer price immediately", async () => {
    const company = await ownedCompany();
    const variant = await product("manual", 20);
    await expect(
      upsertCustomerPrice(managerId, {
        companyId: company.id,
        variantId: variant.id,
        unitPrice: 6.5,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(await priceOf(company.id, variant.id)).toBeNull();
    await upsertCustomerPrice(adminId, {
      companyId: company.id,
      variantId: variant.id,
      unitPrice: 6.5,
      startsAt: null,
      endsAt: null,
    });
    expect(await priceOf(company.id, variant.id)).toBe("6.5000");
    expect(await prisma.customerPriceImport.count({ where: { companyId: company.id, lines: { some: { variantId: variant.id } } } })).toBe(0);
  });

  it("refuses an invalid batch and does not create live prices", async () => {
    const company = await ownedCompany();
    const preview = await upload(repId, company.id, csvFor(["UNKNOWN-SKU,16.50,,", ",1.00,,"]));
    expect(preview.invalidCount).toBe(2);
    expect(preview.canSubmit).toBe(false);
    await expect(submitCustomerPriceImport(repId, company.id, preview.importId!)).rejects.toMatchObject({
      code: "INVALID",
    });
    expect(await prisma.customerPrice.count({ where: { companyId: company.id, variant: { sku: "UNKNOWN-SKU" } } })).toBe(0);
  });
});
