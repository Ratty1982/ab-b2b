import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { completeCustomerSalesCutoverWithoutHistory } from "@/server/companies/customer-sales-history-import";
import { confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import {
  confirmSkippedOngoingSalesRecovery,
  diagnoseSalesCutoverIncident,
  previewSkippedOngoingSalesRecovery,
} from "@/server/companies/sales-cutover-recovery";
import {
  run504TrmFulfilmentAfterImport,
  with504TrmFulfilmentExclusive,
} from "@/server/orders/autopart-504-trm-fulfilment";
import { AuthError } from "@/server/rbac/guards";
import { canContinuePastSalesHistory } from "@/domain/customer-creation-wizard";

const prisma = new PrismaClient();
const stamp = Date.now().toString();
let adminId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
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

async function uniqueAbOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const n = String(
      (100000 + ((Date.now() + attempt * 7919 + Math.floor(Math.random() * 900000)) % 900000)) %
        1000000,
    ).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true },
    });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate a unique AB order number");
}

async function seedRecoverableCustomer(label: string) {
  const local = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const company = await prisma.company.create({
    data: { name: `${label} ${local}`, status: "ACTIVE" },
  });
  const code = `RC${local.slice(-10).toUpperCase()}`;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code });
  await completeCustomerSalesCutoverWithoutHistory(adminId, {
    companyId: company.id,
    confirmAccount: code,
    reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
  });
  const orderNumber = await uniqueAbOrderNumber();
  const documentReference = `SS${local.slice(-8).toUpperCase()}`;
  const otherDocument = `SX${local.slice(-8).toUpperCase()}`;
  const brand = await prisma.brand.create({
    data: { name: `Brand ${local}`, slug: `brand-${local}`, isActive: true },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${local}`, slug: `cat-${local}`, isActive: true },
  });
  const product = await prisma.product.create({
    data: {
      name: `Widget ${local}`,
      slug: `widget-${local}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      variants: {
        create: { sku: `SK${local.slice(-8).toUpperCase()}`, isDefault: true, isActive: true },
      },
    },
    include: { variants: true },
  });
  const sku = product.variants[0]!.sku;
  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: 10,
      vatTotal: 2,
      deliveryTotal: 0,
      grandTotal: 12,
      placedAt: new Date(),
      deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: {
        name: "Buyer",
        email: `buyer-${local}@example.invalid`,
        phone: "01130000000",
      },
      items: {
        create: {
          sku,
          name: "Widget",
          qty: 1,
          unitPrice: 10,
          customerUnitPrice: 10,
          lineTotal: 10,
          vatRate: 20,
          lineVat: "2.00",
          lineGross: 12,
          despatchedQty: 0,
          variantId: product.variants[0]!.id,
          productId: product.id,
        },
      },
    },
  });
  return {
    local,
    company,
    code,
    order,
    orderNumber,
    documentReference,
    otherDocument,
    sku,
    brandId: brand.id,
    categoryId: category.id,
    productId: product.id,
  };
}

async function cleanupSeed(seed: Awaited<ReturnType<typeof seedRecoverableCustomer>>) {
  await prisma.transactionalEmail.deleteMany({
    where: { entityType: "Order", entityId: seed.order.id },
  });
  await prisma.autopartSalesLine.deleteMany({ where: { companyId: seed.company.id } });
  await prisma.autopartSalesDocument.deleteMany({ where: { companyId: seed.company.id } });
  await prisma.autopartImportDiagnostic.deleteMany({
    where: { importRun: { companyId: seed.company.id } },
  });
  await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: seed.company.id } });
  await prisma.orderFulfilmentEvent.deleteMany({ where: { orderId: seed.order.id } });
  await prisma.invoice.deleteMany({ where: { companyId: seed.company.id } });
  await prisma.orderItem.deleteMany({ where: { orderId: seed.order.id } });
  await prisma.order.delete({ where: { id: seed.order.id } });
  await prisma.customerSalesCutover.deleteMany({ where: { companyId: seed.company.id } });
  await prisma.company.delete({ where: { id: seed.company.id } });
  await prisma.productVariant.deleteMany({ where: { productId: seed.productId } });
  await prisma.product.delete({ where: { id: seed.productId } });
  await prisma.category.delete({ where: { id: seed.categoryId } });
  await prisma.brand.delete({ where: { id: seed.brandId } });
}

function trmLines(
  code: string,
  rows: Array<{ document: string; sku: string; qty?: number; sales?: string }>,
) {
  return [
    "Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%",
    ...rows.map(
      (row) =>
        `${code},GRP,${row.document},05/11/2026,${row.sku},Widget,${row.qty ?? 1},${row.sales ?? "10.00"},4.00,6.00,60.000`,
    ),
  ].join("\n");
}

function csv504(rows: Array<{ document: string; orderNumber: string; goods?: string }>) {
  return [
    "Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number",
    ...rows.map((row) => {
      const goods = Number(row.goods ?? "10.00");
      const vat = Number((goods * 0.2).toFixed(2));
      const value = Number((goods + vat).toFixed(2));
      return `ACCOUNT,${row.document},05/11/2026,10:00,TEST CUSTOMER,${goods.toFixed(2)},${vat.toFixed(2)},${value.toFixed(2)},WR,${row.orderNumber}`;
    }),
  ].join("\n");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`cutover.recovery.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", fulfilmentMode: "ACTIVE", fulfilmentFrom: new Date("2020-01-01") },
    update: { fulfilmentMode: "ACTIVE", fulfilmentFrom: new Date("2020-01-01") },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe(
  "sales history cutover recovery safety",
  { timeout: 30_000 },
  () => {
  it("blocks wizard continue until an active verified customer finishes baseline", () => {
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
      }).ok,
    ).toBe(false);
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
      }),
    ).toEqual({ ok: true });
  });

  it("requires an explicit invoice reference and refuses empty matches", async () => {
    const seed = await seedRecoverableCustomer("NoMatch");
    await expect(
      previewSkippedOngoingSalesRecovery(adminId, {
        companyId: seed.company.id,
        textTrm21qc: trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]),
        // missing documentReference
      }),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      previewSkippedOngoingSalesRecovery(adminId, {
        companyId: seed.company.id,
        documentReference: "SSDOESNOTEXIST",
        orderNumber: seed.orderNumber,
        textTrm21qc: trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      previewSkippedOngoingSalesRecovery(adminId, {
        companyId: seed.company.id,
        documentReference: seed.documentReference,
        textTrm21qc: trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]),
        // no orderNumber and no 504 AB ref
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await cleanupSeed(seed);
  });

  it(
    "marks fulfilment pending before evidence exists and suppresses dispatch email on recovery",
    async () => {
    const seed = await seedRecoverableCustomer("PendingPreview");
    const trm = trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]);
    const text504 = csv504([
      { document: seed.documentReference, orderNumber: seed.orderNumber },
    ]);

    const preview = await previewSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });
    expect(preview.fulfilmentPreviewStatus).toBe("PENDING_AFTER_IMPORT");
    expect(preview.fulfilmentPreview).toMatchObject({ pending: true });
    expect(preview.customerEmailPlan.willQueueDispatchEmail).toBe(false);
    expect(preview.matchedOrders.map((order) => order.orderNumber)).toEqual([seed.orderNumber]);

    const recovered = await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });
    expect(recovered.fulfilment.emailsQueued).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: seed.company.id, documentReference: seed.documentReference },
      }),
    ).toBe(1);

    const emails = await prisma.transactionalEmail.count({
      where: {
        entityType: "Order",
        entityId: seed.order.id,
        purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
      },
    });
    expect(emails).toBe(0);

    const suppressAudit = await prisma.auditEvent.findFirst({
      where: {
        entityId: seed.company.id,
        action: "order.despatch_email_suppressed",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(suppressAudit?.metadata).toMatchObject({
      documentReference: seed.documentReference,
      source: "AUTOPART_504_TRM_RECOVERY",
    });

    // Repeated recovery is idempotent.
    await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: seed.company.id, documentReference: seed.documentReference },
      }),
    ).toBe(1);

    await cleanupSeed(seed);
  },
    20_000,
  );

  it("persists only the named invoice from a multi-invoice source file", async () => {
    const seed = await seedRecoverableCustomer("MultiInvoice");
    const otherOrderNumber = await uniqueAbOrderNumber();
    await prisma.order.create({
      data: {
        orderNumber: otherOrderNumber,
        companyId: seed.company.id,
        status: "CONFIRMED",
        subtotal: 5,
        vatTotal: 1,
        deliveryTotal: 0,
        grandTotal: 6,
        placedAt: new Date(),
        deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
        contactSnapshot: { name: "Buyer", email: `other-${seed.local}@example.invalid`, phone: "01130000000" },
        items: {
          create: {
            sku: seed.sku,
            name: "Widget",
            qty: 1,
            unitPrice: 5,
            customerUnitPrice: 5,
            lineTotal: 5,
            vatRate: 20,
            lineVat: "1.00",
            lineGross: 6,
            variantId: (await prisma.productVariant.findFirstOrThrow({ where: { sku: seed.sku } })).id,
            productId: seed.productId,
          },
        },
      },
    });

    const trm = trmLines(seed.code, [
      { document: seed.documentReference, sku: seed.sku, sales: "10.00" },
      { document: seed.otherDocument, sku: seed.sku, sales: "5.00" },
    ]);
    const text504 = csv504([
      { document: seed.documentReference, orderNumber: seed.orderNumber },
      { document: seed.otherDocument, orderNumber: otherOrderNumber, goods: "5.00" },
    ]);

    const preview = await previewSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });
    expect(preview.wouldSkipOutsideScope.documents504).toContain(seed.otherDocument);
    expect(preview.wouldImport504.every((row) => row.document === seed.documentReference)).toBe(true);

    await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });

    expect(
      await prisma.autopartSalesDocument.count({
        where: { companyId: seed.company.id, documentReference: seed.documentReference },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.autopartSalesDocument.count({
        where: { companyId: seed.company.id, documentReference: seed.otherDocument },
      }),
    ).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: seed.company.id, documentReference: seed.otherDocument },
      }),
    ).toBe(0);

    await prisma.orderItem.deleteMany({ where: { order: { orderNumber: otherOrderNumber } } });
    await prisma.order.delete({ where: { orderNumber: otherOrderNumber } });
    await cleanupSeed(seed);
  });

  it("applies full despatch when invoice covers the whole order and partial when it does not", async () => {
    const full = await seedRecoverableCustomer("FullFulfil");
    const fullRecovered = await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: full.company.id,
      documentReference: full.documentReference,
      orderNumber: full.orderNumber,
      text504: csv504([{ document: full.documentReference, orderNumber: full.orderNumber }]),
      textTrm21qc: trmLines(full.code, [
        { document: full.documentReference, sku: full.sku, qty: 1 },
      ]),
      suppressDispatchEmail: true,
    });
    expect(fullRecovered.fulfilment.ordersMutated).toBeGreaterThan(0);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: full.order.id },
          select: { status: true },
        })
      ).status,
    ).toBe("DISPATCHED");
    await cleanupSeed(full);

    const partial = await seedRecoverableCustomer("PartialFulfil");
    await prisma.orderItem.updateMany({
      where: { orderId: partial.order.id },
      data: { qty: 2, lineTotal: 20, lineVat: "4.00", lineGross: 24 },
    });
    await prisma.order.update({
      where: { id: partial.order.id },
      data: { subtotal: 20, vatTotal: 4, grandTotal: 24 },
    });
    const partialRecovered = await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: partial.company.id,
      documentReference: partial.documentReference,
      orderNumber: partial.orderNumber,
      text504: csv504([{ document: partial.documentReference, orderNumber: partial.orderNumber }]),
      textTrm21qc: trmLines(partial.code, [
        { document: partial.documentReference, sku: partial.sku, qty: 1 },
      ]),
      suppressDispatchEmail: true,
    });
    expect(partialRecovered.fulfilment.ordersMutated).toBeGreaterThan(0);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: partial.order.id },
          select: { status: true },
        })
      ).status,
    ).toBe("PARTIALLY_DESPATCHED");
    expect(partialRecovered.fulfilment.emailsQueued).toBe(0);
    await cleanupSeed(partial);
  });

  it("refuses unrelated foreign AB orders and never runs unfiltered fulfilment", async () => {
    const seed = await seedRecoverableCustomer("ForeignOrder");
    const foreign = await prisma.company.create({
      data: { name: `Foreign ${seed.local}`, status: "ACTIVE" },
    });
    const foreignOrderNumber = await uniqueAbOrderNumber();
    await prisma.order.create({
      data: {
        orderNumber: foreignOrderNumber,
        companyId: foreign.id,
        status: "CONFIRMED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        deliveryAddress: { line1: "9 Other St", town: "York", postcode: "YO1 1AA", country: "GB" },
        contactSnapshot: { name: "Other", email: `foreign-${seed.local}@example.invalid`, phone: "01904000000" },
      },
    });

    await expect(
      previewSkippedOngoingSalesRecovery(adminId, {
        companyId: seed.company.id,
        documentReference: seed.documentReference,
        orderNumber: foreignOrderNumber,
        textTrm21qc: trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]),
        suppressDispatchEmail: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await prisma.order.delete({ where: { orderNumber: foreignOrderNumber } });
    await prisma.company.delete({ where: { id: foreign.id } });
    await cleanupSeed(seed);
  });

  it("keeps recovery suppress policy isolated from concurrent scheduled fulfilment", async () => {
    const seed = await seedRecoverableCustomer("Concurrent");
    const trm = trmLines(seed.code, [{ document: seed.documentReference, sku: seed.sku }]);
    const text504 = csv504([
      { document: seed.documentReference, orderNumber: seed.orderNumber },
    ]);

    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const blocker = with504TrmFulfilmentExclusive(async () => {
      await hold;
      return "held";
    });

    const recoveryPromise = confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: seed.company.id,
      documentReference: seed.documentReference,
      orderNumber: seed.orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });

    // While recovery waits for the exclusive section, a normal unfiltered call must also wait —
    // and must not be joined into the recovery promise.
    let normalStarted = false;
    const normalPromise = (async () => {
      normalStarted = true;
      return run504TrmFulfilmentAfterImport(adminId, {
        orderIds: [seed.order.id],
      });
    })();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(normalStarted).toBe(true);

    releaseHold();
    await blocker;
    const recovered = await recoveryPromise;
    expect(recovered.fulfilment.emailsQueued).toBe(0);
    await normalPromise;

    const emails = await prisma.transactionalEmail.count({
      where: {
        entityType: "Order",
        entityId: seed.order.id,
        purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
      },
    });
    expect(emails).toBe(0);

    await cleanupSeed(seed);
  });

  it("diagnoses skipped HISTORY_CUTOVER_INCOMPLETE then recovers for Sales Enquiry population", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { name: `SENCO Style ${local}`, status: "ACTIVE" },
    });
    const code = `SN${local.slice(-10).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code });
    const orderNumber = await uniqueAbOrderNumber();
    const documentReference = `SS${local.slice(-8).toUpperCase()}`;
    const brand = await prisma.brand.create({
      data: { name: `SENCO Brand ${local}`, slug: `senco-brand-${local}`, isActive: true },
    });
    const category = await prisma.category.create({
      data: { name: `SENCO Cat ${local}`, slug: `senco-cat-${local}`, isActive: true },
    });
    const product = await prisma.product.create({
      data: {
        name: `SENCO Widget ${local}`,
        slug: `senco-widget-${local}`,
        brandId: brand.id,
        categoryId: category.id,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku: `SW${local.slice(-8).toUpperCase()}`, isDefault: true, isActive: true },
        },
      },
      include: { variants: true },
    });
    const sku = product.variants[0]!.sku;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        companyId: company.id,
        status: "CONFIRMED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
        contactSnapshot: {
          name: "SENCO Buyer",
          email: `senco-${local}@example.invalid`,
          phone: "01130000000",
        },
        items: {
          create: {
            sku,
            name: "Widget",
            qty: 1,
            unitPrice: 10,
            customerUnitPrice: 10,
            lineTotal: 10,
            vatRate: 20,
            lineVat: "2.00",
            lineGross: 12,
            despatchedQty: 0,
            variantId: product.variants[0]!.id,
            productId: product.id,
          },
        },
      },
    });

    const trm = trmLines(code, [{ document: documentReference, sku }]);
    const blocked = await confirmAutopartTrm21qcImport(adminId, {
      text: trm,
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(blocked.id).toBeTruthy();
    expect(
      await prisma.autopartImportDiagnostic.count({
        where: { importRunId: blocked.id!, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
      }),
    ).toBeGreaterThan(0);

    const before = await diagnoseSalesCutoverIncident(adminId, {
      companyId: company.id,
      orderNumber,
      documentReference,
    });
    expect(before.ongoingEligibility.eligible).toBe(false);
    expect(before.skippedDiagnostics.length).toBeGreaterThan(0);
    expect(before.importedDocuments).toHaveLength(0);

    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId: company.id,
      confirmAccount: code,
      reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
    });

    const text504 = csv504([{ document: documentReference, orderNumber }]);
    await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: company.id,
      documentReference,
      orderNumber,
      text504,
      textTrm21qc: trm,
      suppressDispatchEmail: true,
    });

    const after = await diagnoseSalesCutoverIncident(adminId, {
      companyId: company.id,
      orderNumber,
      documentReference,
    });
    expect(after.cutover?.evidenceKind).toBe("NO_HISTORICAL_SALES");
    expect(after.ongoingEligibility.eligible).toBe(true);
    expect(after.importedDocuments.length).toBeGreaterThan(0);
    expect(
      after.importedDocuments.some((doc) =>
        doc.lines.some((line) => line.sku === sku && Number(line.units) === 1),
      ),
    ).toBe(true);

    await prisma.autopartSalesLine.deleteMany({ where: { companyId: company.id } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: company.id } });
    await prisma.autopartImportDiagnostic.deleteMany({
      where: { importRun: { companyId: company.id } },
    });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: company.id } });
    await prisma.orderFulfilmentEvent.deleteMany({ where: { orderId: order.id } });
    await prisma.invoice.deleteMany({ where: { companyId: company.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.brand.delete({ where: { id: brand.id } });
  });

  it("refuses zero-history when historical sales evidence already exists", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { name: `Existing History ${local}`, status: "ACTIVE" },
    });
    const code = `EH${local.slice(-10).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code });
    await prisma.autopartSalesDocument.create({
      data: {
        companyId: company.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: `SSEH${local.slice(-6).toUpperCase()}`,
        source: "561L",
      },
    });
    await expect(
      completeCustomerSalesCutoverWithoutHistory(adminId, {
        companyId: company.id,
        confirmAccount: code,
        reason: "Should not overwrite existing historical evidence with zero history.",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
