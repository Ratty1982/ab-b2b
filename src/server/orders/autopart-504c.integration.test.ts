/**
 * Autopart 504C reconciliation — dry-run, apply, despatch, idempotency, credits.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  buildAb000003RealWorld504cFixture,
  buildAutopart504cSampleFixture,
  format504cDataRow,
  AUTOPART_504C_HEADER,
  AUTOPART_504C_SEPARATOR,
} from "@/domain/autopart-504c-fixture";
import {
  applyAutopart504cFile,
  dryRunAutopart504cFile,
  getAutopart504cFeedSettings,
  getAutopart504cImportRunDetail,
  listAutopart504cImportRuns,
  pollAutopart504cMailboxNow,
  runAutopart504cScheduledPollIfEnabled,
  updateAutopart504cFeedSettings,
} from "@/server/orders/autopart-504c";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
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

async function createProcessingOrder(orderNumber: string) {
  const company = await prisma.company.create({
    data: {
      name: `504C Co ${orderNumber}`,
      status: "ACTIVE",
      autopartCustomerCode: `MAM-${orderNumber}`,
      autopartCustomerCodeVerifiedAt: new Date(),
    },
  });

  const stamp = `${orderNumber}-${Math.random().toString(36).slice(2, 8)}`;
  const brand = await prisma.brand.create({
    data: { name: `Brand ${stamp}`, slug: `brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `Cat ${stamp}`, slug: `cat-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Product ${stamp}`,
      slug: `product-${stamp}`,
      brandId: brand.id,
      categoryId: category.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `VAR-${stamp}`,
      isActive: true,
      tradePrice: 10,
    },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "AUTOPART" },
    create: { code: "AUTOPART", name: "Autopart" },
    update: {},
  });
  const inventory = await prisma.inventory.create({
    data: {
      variantId: variant.id,
      warehouseId: warehouse.id,
      qtyOnHand: 100,
      qtyReserved: 5,
      status: "IN_STOCK",
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber,
      companyId: company.id,
      status: "CONFIRMED",
      subtotal: 44.28,
      vatTotal: 10.05,
      deliveryTotal: 5.95,
      grandTotal: 60.28,
      placedAt: new Date("2026-09-25T12:00:00.000Z"),
      poNumber: "PO696969",
      autopartCustomerCodeSnapshot: `MAM-${orderNumber}`,
      autopartAccountLinked: true,
      autopartExportStatus: "EXPORTED",
      deliveryAddress: {
        line1: "12 High Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      contactSnapshot: {
        name: "Alex Buyer",
        email: `buyer-${stamp}@example.test`,
        phone: "01130000000",
      },
      items: {
        create: [
          {
            sku: `SKU-${stamp}`,
            name: "Line",
            qty: 12,
            unitPrice: 3.69,
            customerUnitPrice: 3.69,
            vatRate: 20,
            lineTotal: 44.28,
            lineVat: "0.00",
            lineGross: 44.28,
            variantId: variant.id,
          },
        ],
      },
    },
  });

  const reservation = await prisma.orderStockReservation.create({
    data: {
      orderId: order.id,
      variantId: variant.id,
      inventoryId: inventory.id,
      quantity: 5,
      status: "ACTIVE",
    },
  });

  return { order, company, inventory, reservation };
}

function reportForAbOrders(
  rows: Array<{
    document: string;
    orderNumber: string;
    goods?: string;
    vat?: string;
    value?: string;
    credit?: boolean;
  }>,
) {
  const lines = [
    "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)",
    AUTOPART_504C_HEADER,
    AUTOPART_504C_SEPARATOR,
    ...rows.map((r) =>
      format504cDataRow({
        document: r.document,
        date: "25/09/2026",
        time: "14:12",
        account: "AB001",
        customer: "EXAMPLE MOTOR FACTORS",
        goods: r.goods ?? (r.credit ? "-12.00" : "44.28"),
        vat: r.vat ?? (r.credit ? "-2.40" : "10.05"),
        value: r.value ?? (r.credit ? "-14.40" : "60.28"),
        inits: "WR",
        orderNumber: r.orderNumber,
      }),
    ),
    format504cDataRow({
      document: "I555001",
      date: "25/09/2026",
      time: "13:05",
      account: "AMZ01",
      customer: "AMAZON EU SARL",
      goods: "22.00",
      vat: "4.40",
      value: "26.40",
      inits: "AZ",
      orderNumber: "026-1234567-8901234",
    }),
    "*** END OF REPORT ***",
  ];
  return lines.join("\n");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("504c-admin@ab.test", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autopart 504C feed defaults", () => {
  it("defaults to disabled / not configured", async () => {
    const settings = await getAutopart504cFeedSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.automaticPolling).toBe("OFF");
    expect(["NOT_CONFIGURED", "DISABLED"]).toContain(settings.statusLabel);
    expect(settings.scheduleHours).toEqual([13, 16]);
  });

  it("scheduler no-ops while disabled", async () => {
    const result = await runAutopart504cScheduledPollIfEnabled();
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("poll mailbox now refuses while disabled", async () => {
    const result = await pollAutopart504cMailboxNow(adminId);
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/DISABLED|NOT CONFIGURED/i);
  });

  it("cannot enable without configured", async () => {
    await expect(
      updateAutopart504cFeedSettings(adminId, { enabled: true, configured: false }),
    ).rejects.toThrow(/configured/i);
  });
});

describe("autopart 504C dry-run and apply", () => {
  it("dry-run parses fixture without mutating orders", async () => {
    const abNumber = `AB-${String(900000 + (Date.now() % 90000)).padStart(6, "0")}`;
    const { order, reservation, inventory } = await createProcessingOrder(abNumber);

    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([{ document: `I${Date.now().toString().slice(-7)}`, orderNumber: abNumber }]),
      filename: "dry.txt",
    });
    expect(preview.abInvoices.some((r) => r.abOrderNumber === abNumber && r.match === "MATCHED")).toBe(
      true,
    );
    expect(preview.nonAbRows).toBeGreaterThanOrEqual(1);

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("CONFIRMED");
    const res = await prisma.orderStockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe("ACTIVE");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyOnHand).toBe(100);
    expect(inv.qtyReserved).toBe(5);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emails).toHaveLength(0);
  });

  it("apply invoices → DESPATCHED once; duplicate file safe; credit no despatch", async () => {
    const abNumber = `AB-${String(910000 + (Date.now() % 80000)).padStart(6, "0")}`;
    const doc = `I${Date.now().toString().slice(-7)}`;
    const creditDoc = `C${Date.now().toString().slice(-7)}`;
    const { order, reservation, inventory } = await createProcessingOrder(abNumber);

    const text = reportForAbOrders([
      { document: doc, orderNumber: abNumber },
      { document: creditDoc, orderNumber: abNumber, credit: true },
    ]);

    const run = await applyAutopart504cFile(adminId, {
      text,
      filename: "apply.txt",
      allowApply: true,
    });
    expect(run.ordersDespatched).toBe(1);
    expect(run.newInvoices).toBeGreaterThanOrEqual(1);
    expect(run.credits).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("DISPATCHED");

    const invoice = await prisma.invoice.findFirst({ where: { externalRef: doc } });
    expect(invoice).toBeTruthy();
    expect(invoice!.autopartCustomerOrderNumber).toBe(abNumber);
    expect(invoice!.autopartDocumentKind).toBe("INVOICE");

    const credit = await prisma.invoice.findFirst({ where: { externalRef: creditDoc } });
    expect(credit?.autopartDocumentKind).toBe("CREDIT");

    const res = await prisma.orderStockReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(res.status).toBe("CONSUMED");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyOnHand).toBe(100);
    expect(inv.qtyReserved).toBe(0);

    const emails = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emails).toHaveLength(1);

    const replay = await applyAutopart504cFile(adminId, {
      text,
      filename: "apply-replay.txt",
      allowApply: true,
    });
    expect(replay.duplicates).toBeGreaterThanOrEqual(2);
    expect(replay.ordersDespatched).toBe(0);

    const emailsAfter = await prisma.transactionalEmail.findMany({
      where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emailsAfter).toHaveLength(1);
  });

  it("refuses apply without allowApply when feed disabled", async () => {
    await expect(
      applyAutopart504cFile(adminId, {
        text: buildAutopart504cSampleFixture(),
        allowApply: false,
      }),
    ).rejects.toThrow(/DISABLED/i);
  });

  it("does not despatch RECEIVED orders from 504C alone", async () => {
    const abNumber = `AB-${String(920000 + (Date.now() % 70000)).padStart(6, "0")}`;
    const { order } = await createProcessingOrder(abNumber);
    await prisma.order.update({ where: { id: order.id }, data: { status: "SUBMITTED" } });

    const run = await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: `I${Date.now().toString().slice(-6)}`, orderNumber: abNumber },
      ]),
      allowApply: true,
    });
    expect(run.ordersDespatched).toBe(0);
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("SUBMITTED");
  });

  it("reports unknown AB references without treating non-AB as errors", async () => {
    const unknown = `AB-${String(930000 + (Date.now() % 60000)).padStart(6, "0")}`;
    const run = await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: `I${Date.now().toString().slice(-6)}`, orderNumber: unknown },
      ]),
      allowApply: true,
    });
    expect(run.unmatchedAbRefs).toBe(1);
    expect(run.nonAbRows).toBeGreaterThanOrEqual(1);
    expect(run.status).toBe("PARTIAL");
  });
});

describe("autopart 504C dry-run predictive diagnostics", () => {
  it("AB-000003 real-world dry-run predicts create+despatch with zero mutations", async () => {
    const abNumber = `AB-${String(940000 + (Date.now() % 50000)).padStart(6, "0")}`;
    const document = `SS${String(Date.now()).slice(-6)}`;
    const { order, reservation, inventory } = await createProcessingOrder(abNumber);

    // Snapshots matching proven MAM import: goods 10.56 + SDEL 5.95 + VAT 3.30 = 19.81
    await prisma.order.update({
      where: { id: order.id },
      data: {
        subtotal: "10.56",
        deliveryTotal: "5.95",
        vatTotal: "3.30",
        grandTotal: "19.81",
      },
    });
    await prisma.orderItem.updateMany({
      where: { orderId: order.id },
      data: {
        sku: "PMAPC500",
        qty: 6,
        unitPrice: "1.76",
        customerUnitPrice: "1.76",
        lineTotal: "10.56",
      },
    });

    const preview = await dryRunAutopart504cFile(adminId, {
      text: buildAb000003RealWorld504cFixture({ orderNumber: abNumber, document }),
      filename: "ss305967-dry.txt",
    });

    expect(preview.summary.abMatches).toBe(1);
    expect(preview.summary.wouldCreate).toBe(1);
    expect(preview.summary.duplicates).toBe(0);
    expect(preview.summary.wouldDespatch).toBe(1);
    expect(preview.summary.issues).toBe(0);
    expect(preview.summary.wouldSendEmail).toBe(1);
    expect(preview.nonAbRows).toBeGreaterThanOrEqual(1);

    const planRow = preview.plan.find((p) => p.documentNumber === document);
    expect(planRow).toBeTruthy();
    expect(planRow!.result).toBe("WOULD_DESPATCH");
    expect(planRow!.wouldCreateInvoice).toBe(true);
    expect(planRow!.wouldDespatch).toBe(true);
    expect(planRow!.wouldSendEmail).toBe(true);
    expect(planRow!.emailAction).toMatch(/ORDER_DESPATCHED/);
    expect(planRow!.financial?.status).toBe("OK");
    expect(planRow!.financial?.abNet).toBe("16.51");
    expect(planRow!.financial?.c504Goods).toBe("16.51");
    expect(planRow!.financial?.abDelivery).toBe("5.95");

    // Zero business mutations
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("CONFIRMED");
    const res = await prisma.orderStockReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(res.status).toBe("ACTIVE");
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(inv.qtyReserved).toBe(5);
    expect(inv.qtyOnHand).toBe(100);
    expect(await prisma.invoice.count({ where: { externalRef: document } })).toBe(0);
    expect(
      await prisma.transactionalEmail.count({
        where: { entityId: order.id, purpose: "ORDER_DESPATCHED" },
      }),
    ).toBe(0);

    const history = await listAutopart504cImportRuns(adminId, 5);
    const hist = history.find((r) => r.id === preview.runId);
    expect(hist?.isDryRun).toBe(true);
    expect(hist?.counterMode).toBe("PREVIEW");
    expect(hist?.ordersMatched).toBe(1);
    expect(hist?.newInvoices).toBe(1); // predictive would-create
    expect(hist?.ordersDespatched).toBe(1); // predictive would-despatch
    expect(hist?.issues).toBe(0);

    const detail = await getAutopart504cImportRunDetail(adminId, preview.runId);
    expect(detail.isDryRun).toBe(true);
    expect(detail.plan[0]?.documentNumber).toBe(document);
    expect(detail.plan[0]?.abOrderNumber).toBe(abNumber);
    expect(detail.plan[0]?.goods).toBe("16.51");
    expect(detail.plan[0]?.vat).toBe("3.30");
    expect(detail.plan[0]?.value).toBe("19.81");
  });

  it("dry-run duplicate predicts no create/despatch", async () => {
    const abNumber = `AB-${String(950000 + (Date.now() % 40000)).padStart(6, "0")}`;
    const document = `SS${String(Date.now()).slice(-6)}`;
    const { order } = await createProcessingOrder(abNumber);
    await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([{ document, orderNumber: abNumber }]),
      allowApply: true,
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "DISPATCHED",
    );

    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([{ document, orderNumber: abNumber }]),
      filename: "dup-dry.txt",
    });
    expect(preview.summary.duplicates).toBe(1);
    expect(preview.summary.wouldCreate).toBe(0);
    expect(preview.summary.wouldDespatch).toBe(0);
    expect(preview.plan[0]?.result).toBe("DUPLICATE");
    expect(preview.plan[0]?.action).toMatch(/No action/i);
  });

  it("dry-run credit predicts no despatch", async () => {
    const abNumber = `AB-${String(960000 + (Date.now() % 30000)).padStart(6, "0")}`;
    const creditDoc = `C${String(Date.now()).slice(-6)}`;
    await createProcessingOrder(abNumber);
    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: creditDoc, orderNumber: abNumber, credit: true },
      ]),
      filename: "credit-dry.txt",
    });
    const credit = preview.plan.find((p) => p.kind === "CREDIT");
    expect(credit?.result).toBe("CREDIT");
    expect(credit?.wouldDespatch).toBe(false);
    expect(credit?.wouldSendEmail).toBe(false);
    expect(credit?.emailAction).toMatch(/No despatch/i);
  });

  it("dry-run unknown AB order counts as issue; non-AB ignored", async () => {
    const unknown = `AB-${String(970000 + (Date.now() % 20000)).padStart(6, "0")}`;
    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([
        { document: `I${String(Date.now()).slice(-6)}`, orderNumber: unknown },
      ]),
      filename: "unknown-dry.txt",
    });
    expect(preview.summary.abMatches).toBe(0);
    expect(preview.summary.issues).toBe(1);
    expect(preview.summary.nonAbIgnored).toBeGreaterThanOrEqual(1);
    expect(preview.plan.some((p) => p.result === "UNKNOWN_AB_ORDER")).toBe(true);
    expect(preview.plan.every((p) => p.result !== "NON_AB")).toBe(true);
  });

  it("dry-run financial mismatch includes delivery and still predicts live create", async () => {
    const abNumber = `AB-${String(980000 + (Date.now() % 15000)).padStart(6, "0")}`;
    const document = `I${String(Date.now()).slice(-6)}`;
    const { order } = await createProcessingOrder(abNumber);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        subtotal: "10.56",
        deliveryTotal: "5.95",
        vatTotal: "3.30",
        grandTotal: "19.81",
      },
    });

    const preview = await dryRunAutopart504cFile(adminId, {
      text: reportForAbOrders([
        {
          document,
          orderNumber: abNumber,
          goods: "16.40",
          vat: "3.30",
          value: "19.70",
        },
      ]),
      filename: "mismatch-dry.txt",
    });
    const row = preview.plan.find((p) => p.documentNumber === document)!;
    expect(row.result).toBe("FINANCIAL_MISMATCH");
    expect(row.financial?.status).toBe("MISMATCH");
    expect(row.financial?.abNet).toBe("16.51");
    expect(row.financial?.abDelivery).toBe("5.95");
    expect(row.wouldCreateInvoice).toBe(true);
    expect(row.wouldDespatch).toBe(true);
    expect(preview.summary.issues).toBe(1);
    expect(preview.summary.wouldCreate).toBe(1);
  });

  it("live counters remain actual completed actions after apply", async () => {
    const abNumber = `AB-${String(990000 + (Date.now() % 10000)).padStart(6, "0")}`;
    const document = `I${String(Date.now()).slice(-6)}`;
    await createProcessingOrder(abNumber);
    const run = await applyAutopart504cFile(adminId, {
      text: reportForAbOrders([{ document, orderNumber: abNumber }]),
      allowApply: true,
    });
    expect(run.isDryRun).toBe(false);
    expect(run.newInvoices).toBeGreaterThanOrEqual(1);
    expect(run.ordersDespatched).toBe(1);

    const history = await listAutopart504cImportRuns(adminId, 10);
    const hist = history.find((r) => r.id === run.id);
    expect(hist?.counterMode).toBe("ACTUAL");
    expect(hist?.isDryRun).toBe(false);
    expect(hist?.ordersDespatched).toBe(1);
  });

  it("import run detail requires 504C admin permission", async () => {
    const outsider = await ensureUser(`504c-outsider-${Date.now()}@ab.test`, []);
    await expect(getAutopart504cImportRunDetail(outsider, "cjld2cjxh0000qzrmn831i7rn")).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
