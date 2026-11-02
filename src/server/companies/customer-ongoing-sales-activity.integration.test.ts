/**
 * Customer Autopart workspace freshness and issues after automatic mailbox polls.
 *
 * Poll runs keep AutopartCustomerImportRun.companyId null; attribution is on
 * documents, lines, and diagnostics. These tests exercise processOngoingSalesEmailBatch.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  getCustomerAutopartWorkspace,
  listCustomerAutopartImportActivity,
  listCustomerAutopartImportDetails,
} from "@/server/companies/customer-autopart-workspace";
import { processOngoingSalesEmailBatch } from "@/server/companies/autopart-ongoing-sales-poll";
import { loadHistoricSalesLines, summarizeHistoricLines } from "@/server/sales-intelligence/historic-lines";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const accountActive = `CA${stamp}`.slice(0, 12);
const accountProspect = `CP${stamp}`.slice(0, 12);
const accountHistoryOnly = `CH${stamp}`.slice(0, 12);
const accountUnrelated = `CU${stamp}`.slice(0, 12);
const sku = `CSK${stamp}`.slice(0, 16);
const references: string[] = [];
let adminId = "";
let activeId = "";
let prospectId = "";
let historyOnlyId = "";
let unrelatedId = "";
let brandId = "";
let categoryId = "";
let activeOrderNumber = "";

function reference(label: string) {
  const value = `SS${label}${stamp}`.slice(0, 16);
  references.push(value);
  return value;
}

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
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate AB order number");
}

function sample504(rows: Array<{ document: string; goods: string; orderNumber: string; name?: string }>) {
  return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
${rows
  .map((row) => {
    const goods = Number(row.goods);
    const vat = (goods * 0.2).toFixed(2);
    const value = (goods * 1.2).toFixed(2);
    return `ACCOUNT,${row.document},14/10/2026,13:05,${row.name ?? "TEST CUST"},${row.goods},${vat},${value},WR,${row.orderNumber}`;
  })
  .join("\n")}
`;
}

function sampleTrm(
  lines: Array<{ account: string; document: string; qty: string; sales: string; sku?: string }>,
) {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${lines
  .map(
    (line) =>
      `${line.account},GRP,${line.document},14/10/2026,${line.sku ?? sku},Activity part,${line.qty},${line.sales},4.00,1.00,10.000`,
  )
  .join("\n")}
`;
}

function pollEmail(filename504: string, text504: string, filenameTrm: string, textTrm: string, uid: string) {
  return {
    uid,
    messageId: `<${uid}@example.invalid>`,
    from: "reports@example.invalid",
    subject: "Day end reports",
    receivedAt: new Date(),
    attachments: [
      { filename: filename504, content: Buffer.from(text504), contentType: "text/csv" },
      { filename: filenameTrm, content: Buffer.from(textTrm), contentType: "text/csv" },
    ],
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`ongoing-activity.${stamp}@example.invalid`, ["SUPER_ADMIN"]);

  const brand = await prisma.brand.create({
    data: { name: `Activity Brand ${stamp}`, slug: `activity-brand-${stamp.toLowerCase()}` },
  });
  brandId = brand.id;
  const category = await prisma.category.create({
    data: { name: `Activity Cat ${stamp}`, slug: `activity-cat-${stamp.toLowerCase()}` },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: `Activity Product ${stamp}`,
      slug: `activity-product-${stamp.toLowerCase()}`,
      brandId,
      categoryId,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku, isActive: true, tradePrice: 10 },
  });

  const active = await prisma.company.create({
    data: { name: `Activity Active ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const prospect = await prisma.company.create({
    data: { name: `Activity Prospect ${stamp}`, status: "PROSPECT", paymentTerms: "30 Days" },
  });
  const historyOnly = await prisma.company.create({
    data: { name: `Activity History ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  const unrelated = await prisma.company.create({
    data: { name: `Activity Unrelated ${stamp}`, status: "ACTIVE", paymentTerms: "30 Days" },
  });
  activeId = active.id;
  prospectId = prospect.id;
  historyOnlyId = historyOnly.id;
  unrelatedId = unrelated.id;

  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: activeId, code: accountActive });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: prospectId,
    code: accountProspect,
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: historyOnlyId,
    code: accountHistoryOnly,
  });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: unrelatedId,
    code: accountUnrelated,
  });

  await prisma.customerSalesCutover.createMany({
    data: [
      {
        companyId: activeId,
        historyStatus: "COMPLETE",
        completedAt: new Date("2024-06-30T12:00:00.000Z"),
        historyFrom: new Date("2014-10-06T12:00:00.000Z"),
        historyTo: new Date("2024-06-30T12:00:00.000Z"),
        evidence: { kind: "561L_SLRB" },
      },
      {
        companyId: prospectId,
        historyStatus: "COMPLETE",
        completedAt: new Date(),
        evidence: { kind: "NO_HISTORICAL_SALES" },
      },
      {
        companyId: historyOnlyId,
        historyStatus: "COMPLETE",
        completedAt: new Date("2024-06-30T12:00:00.000Z"),
        historyFrom: new Date("2014-10-06T12:00:00.000Z"),
        historyTo: new Date("2024-06-30T12:00:00.000Z"),
        evidence: { kind: "561L_SLRB" },
      },
      {
        companyId: unrelatedId,
        historyStatus: "COMPLETE",
        completedAt: new Date(),
        evidence: { kind: "NO_HISTORICAL_SALES" },
      },
    ],
  });

  // Historical 561L/SLRB for history-only customer (no ongoing yet).
  const histDoc = reference("H");
  await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: historyOnlyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      filename: "561L-history.csv",
      filenameSlrb: "SLRB-history.csv",
      completedAt: new Date("2024-07-01T10:00:00.000Z"),
      createdById: adminId,
    },
  });
  const histDocument = await prisma.autopartSalesDocument.create({
    data: {
      companyId: historyOnlyId,
      autopartCustomerCode: accountHistoryOnly,
      documentType: "INVOICE",
      documentReference: histDoc,
      documentDate: new Date("2024-01-15T12:00:00.000Z"),
      goodsNet: "25.00",
      source: "SLRB",
    },
  });
  await prisma.autopartSalesLine.create({
    data: {
      companyId: historyOnlyId,
      documentId: histDocument.id,
      autopartCustomerCode: accountHistoryOnly,
      documentType: "INVOICE",
      documentReference: histDoc,
      lineNumber: 1,
      sku,
      units: "1",
      salesNet: "25.00",
      source: "561L",
    },
  });

  activeOrderNumber = await uniqueAbOrderNumber();
  await prisma.order.create({
    data: {
      companyId: activeId,
      orderNumber: activeOrderNumber,
      status: "CONFIRMED",
      subtotal: "40.00",
      vatTotal: "8.00",
      deliveryTotal: "0.00",
      grandTotal: "48.00",
      placedAt: new Date("2026-10-14T12:00:00.000Z"),
      autopartExportStatus: "EXPORTED",
      autopartAccountLinked: true,
      autopartCustomerCodeSnapshot: accountActive,
      deliveryAddress: {
        line1: "1 Test Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      contactSnapshot: {
        name: "Buyer",
        email: `buyer-activity-${stamp}@example.test`,
        phone: "01130000000",
      },
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    if (references.length) {
      await prisma.autopartSalesLine.deleteMany({ where: { documentReference: { in: references } } });
      await prisma.autopartSalesDocument.deleteMany({ where: { documentReference: { in: references } } });
      await prisma.autopartImportDiagnostic.deleteMany({
        where: { documentReference: { in: references } },
      });
    }
    const companyIds = [activeId, prospectId, historyOnlyId, unrelatedId].filter(Boolean);
    if (companyIds.length) {
      await prisma.autopartSalesLine.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.autopartSalesDocument.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.autopartImportDiagnostic.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.order.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.autopartCustomerImportRun.deleteMany({
        where: { OR: [{ companyId: { in: companyIds } }, { createdById: adminId }] },
      });
      await prisma.autopartAccount.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.customerSalesCutover.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.autopartCustomerAccountAlias.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    if (brandId) {
      await prisma.productVariant.deleteMany({ where: { product: { brandId } } });
      await prisma.product.deleteMany({ where: { brandId } });
      await prisma.brand.deleteMany({ where: { id: brandId } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("customer ongoing sales activity after automatic polling", () => {
  it("attributes poll 504/TRM dates to Active customers and skips Prospects", async () => {
    const activeDoc = reference("A");
    const prospectDoc = reference("P");
    const text504 = sample504([
      { document: activeDoc, goods: "40.00", orderNumber: activeOrderNumber, name: "ACTIVE CUST" },
      { document: prospectDoc, goods: "15.00", orderNumber: "PROSPECT-ORD-1", name: "PROSPECT CUST" },
    ]);
    const textTrm = sampleTrm([
      { account: accountActive, document: activeDoc, qty: "2", sales: "40.00" },
      { account: accountProspect, document: prospectDoc, qty: "1", sales: "15.00" },
    ]);

    const poll = await processOngoingSalesEmailBatch({
      emails: [
        pollEmail(
          `504-activity-${stamp}.csv`,
          text504,
          `TRM21QC-activity-${stamp}.csv`,
          textTrm,
          `uid-activity-${stamp}`,
        ),
      ],
      actorUserId: adminId,
      source: "SCHEDULE",
      autoArchive: false,
    });
    expect(poll.processed504).toBe(1);
    expect(poll.processedTrm21qc).toBe(1);

    const pollRuns = await prisma.autopartCustomerImportRun.findMany({
      where: {
        createdById: adminId,
        type: { in: ["ONGOING_504", "ONGOING_TRM21QC"] },
        filename: { contains: stamp },
      },
      select: { id: true, type: true, companyId: true, status: true },
    });
    expect(pollRuns.length).toBeGreaterThanOrEqual(2);
    expect(pollRuns.every((run) => run.companyId === null)).toBe(true);
    expect(pollRuns.every((run) => run.status === "COMMITTED")).toBe(true);

    const activeDocRow = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: activeDoc, companyId: activeId },
    });
    expect(activeDocRow?.has504).toBe(true);
    expect(activeDocRow?.hasTrm21qc).toBe(true);
    expect(
      await prisma.autopartSalesLine.count({
        where: { documentReference: activeDoc, companyId: activeId, source: "ONGOING_TRM21QC" },
      }),
    ).toBe(1);

    expect(
      await prisma.autopartSalesDocument.count({
        where: { documentReference: prospectDoc, companyId: prospectId },
      }),
    ).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({
        where: { documentReference: prospectDoc, companyId: prospectId },
      }),
    ).toBe(0);

    const prospectSkip = await prisma.autopartImportDiagnostic.findFirst({
      where: {
        companyId: prospectId,
        reasonCode: "NOT_ACTIVE",
        status: "SKIPPED",
      },
    });
    expect(prospectSkip).toBeTruthy();

    const activeWorkspace = await getCustomerAutopartWorkspace(adminId, activeId);
    expect(activeWorkspace.ongoing.latest504At).toBeTruthy();
    expect(activeWorkspace.ongoing.latestTrm21qcAt).toBeTruthy();
    expect(activeWorkspace.ongoing.companionStatus).toBe("ready");
    expect(activeWorkspace.ongoing.hasOutstandingIssues).toBe(false);
    expect(activeWorkspace.primaryAction).toBe("view-enquiry");
    expect(activeWorkspace.stages.find((stage) => stage.id === "current")?.state).toBe("COMPLETE");
    // History coverage stays on cutover dates — not replaced by poll freshness.
    expect(activeWorkspace.history.coveredThrough).toBe("2024-06-30");
    expect(activeWorkspace.history.latestImportAt).toBeNull();

    const prospectWorkspace = await getCustomerAutopartWorkspace(adminId, prospectId);
    expect(prospectWorkspace.ongoing.latest504At).toBeNull();
    expect(prospectWorkspace.ongoing.latestTrm21qcAt).toBeNull();
    expect(prospectWorkspace.ongoing.hasOutstandingIssues).toBe(true);
    expect(prospectWorkspace.ongoing.issueKind).toBe("not_active");
    expect(prospectWorkspace.ongoing.outstandingIssue).toMatch(/not Active|Not Active|NOT_ACTIVE/i);
    expect(prospectWorkspace.primaryAction).toBe("activate");

    const activity = await listCustomerAutopartImportActivity(adminId, activeId);
    expect(activity.items.some((item) => item.type === "ONGOING_504")).toBe(true);
    expect(activity.items.some((item) => item.type === "ONGOING_TRM21QC")).toBe(true);

    const poll504 = pollRuns.find((run) => run.type === "ONGOING_504")!;
    const details = await listCustomerAutopartImportDetails(adminId, {
      companyId: activeId,
      runId: poll504.id,
    });
    expect(details.items.every((row) => !row.customerAccount || row.customerAccount === accountActive || row.documentReference === activeDoc || row.status === "INSERTED" || row.status === "UPDATED" || row.status === "SKIPPED" || row.status === "ERROR")).toBe(
      true,
    );
    // Unrelated prospect diagnostics must not appear on the Active customer's detail view.
    expect(details.items.some((row) => row.customerAccount === accountProspect)).toBe(false);
  });

  it("keeps history-complete customers without ongoing transactions on companion await", async () => {
    const workspace = await getCustomerAutopartWorkspace(adminId, historyOnlyId);
    expect(workspace.history.status).toBe("COMPLETE");
    expect(workspace.history.label).toBe("History imported");
    expect(workspace.ongoing.latest504At).toBeNull();
    expect(workspace.ongoing.latestTrm21qcAt).toBeNull();
    expect(workspace.ongoing.companionStatus).toBe("awaiting_both");
    expect(workspace.ongoing.companionNote).toMatch(/Awaiting first 504 and TRM21QC/i);
    expect(workspace.ongoing.hasOutstandingIssues).toBe(false);
    expect(workspace.primaryAction).toBe("view-enquiry");
    expect(workspace.stages.find((stage) => stage.id === "current")?.state).toBe("COMPLETE");
  });

  it("does not treat unrelated customers in a global poll as this customer's update", async () => {
    const before = await getCustomerAutopartWorkspace(adminId, historyOnlyId);
    expect(before.ongoing.latest504At).toBeNull();

    const unrelatedDoc = reference("U");
    const unrelatedOrder = await uniqueAbOrderNumber();
    await prisma.order.create({
      data: {
        companyId: unrelatedId,
        orderNumber: unrelatedOrder,
        status: "CONFIRMED",
        subtotal: "10.00",
        vatTotal: "2.00",
        deliveryTotal: "0.00",
        grandTotal: "12.00",
        placedAt: new Date("2026-10-14T12:00:00.000Z"),
        autopartExportStatus: "EXPORTED",
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: accountUnrelated,
        deliveryAddress: {
          line1: "2 Other Street",
          town: "York",
          postcode: "YO1 1AA",
          country: "GB",
        },
        contactSnapshot: {
          name: "Other",
          email: `other-activity-${stamp}@example.test`,
          phone: "01904000000",
        },
      },
    });

    const poll = await processOngoingSalesEmailBatch({
      emails: [
        pollEmail(
          `504-unrelated-${stamp}.csv`,
          sample504([{ document: unrelatedDoc, goods: "10.00", orderNumber: unrelatedOrder }]),
          `TRM21QC-unrelated-${stamp}.csv`,
          sampleTrm([{ account: accountUnrelated, document: unrelatedDoc, qty: "1", sales: "10.00" }]),
          `uid-unrelated-${stamp}`,
        ),
      ],
      actorUserId: adminId,
      source: "SCHEDULE",
      autoArchive: false,
    });
    expect(poll.processed504).toBe(1);
    expect(poll.processedTrm21qc).toBe(1);

    const historyWorkspace = await getCustomerAutopartWorkspace(adminId, historyOnlyId);
    expect(historyWorkspace.ongoing.latest504At).toBeNull();
    expect(historyWorkspace.ongoing.latestTrm21qcAt).toBeNull();
    expect(historyWorkspace.ongoing.hasOutstandingIssues).toBe(false);

    const unrelatedWorkspace = await getCustomerAutopartWorkspace(adminId, unrelatedId);
    expect(unrelatedWorkspace.ongoing.latest504At).toBeTruthy();
    expect(unrelatedWorkspace.ongoing.latestTrm21qcAt).toBeTruthy();
    expect(
      await prisma.autopartSalesLine.count({
        where: { documentReference: unrelatedDoc, companyId: historyOnlyId },
      }),
    ).toBe(0);
  });

  it("clears NOT_ACTIVE skip issues after activation and imports on the next poll", async () => {
    const before = await getCustomerAutopartWorkspace(adminId, prospectId);
    expect(before.ongoing.hasOutstandingIssues).toBe(true);
    expect(before.ongoing.issueKind).toBe("not_active");

    await prisma.company.update({
      where: { id: prospectId },
      data: { status: "ACTIVE" },
    });

    const cleared = await getCustomerAutopartWorkspace(adminId, prospectId);
    expect(cleared.ongoing.hasOutstandingIssues).toBe(false);
    expect(cleared.ongoing.issueKind).toBe("none");
    expect(cleared.primaryAction).toBe("view-enquiry");

    const catchUpDoc = reference("R");
    const prospectOrder = await uniqueAbOrderNumber();
    await prisma.order.create({
      data: {
        companyId: prospectId,
        orderNumber: prospectOrder,
        status: "CONFIRMED",
        subtotal: "18.00",
        vatTotal: "3.60",
        deliveryTotal: "0.00",
        grandTotal: "21.60",
        placedAt: new Date("2026-10-14T15:00:00.000Z"),
        autopartExportStatus: "EXPORTED",
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: accountProspect,
        deliveryAddress: {
          line1: "3 Prospect Street",
          town: "Hull",
          postcode: "HU1 1AA",
          country: "GB",
        },
        contactSnapshot: {
          name: "Prospect",
          email: `prospect-activity-${stamp}@example.test`,
          phone: "01482000000",
        },
      },
    });

    const poll = await processOngoingSalesEmailBatch({
      emails: [
        pollEmail(
          `504-catchup-${stamp}.csv`,
          sample504([{ document: catchUpDoc, goods: "18.00", orderNumber: prospectOrder }]),
          `TRM21QC-catchup-${stamp}.csv`,
          sampleTrm([{ account: accountProspect, document: catchUpDoc, qty: "1", sales: "18.00" }]),
          `uid-catchup-${stamp}`,
        ),
      ],
      actorUserId: adminId,
      source: "SCHEDULE",
      autoArchive: false,
    });
    expect(poll.processed504).toBe(1);
    expect(poll.processedTrm21qc).toBe(1);

    const after = await getCustomerAutopartWorkspace(adminId, prospectId);
    expect(after.ongoing.latest504At).toBeTruthy();
    expect(after.ongoing.latestTrm21qcAt).toBeTruthy();
    expect(after.ongoing.hasOutstandingIssues).toBe(false);
    expect(after.ongoing.companionStatus).toBe("ready");
    expect(
      await prisma.autopartSalesLine.count({
        where: { documentReference: catchUpDoc, companyId: prospectId, source: "ONGOING_TRM21QC" },
      }),
    ).toBe(1);
  });

  it("surfaces data errors as outstanding and drops them when resolved for the customer", async () => {
    const badRun = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: null,
        type: "ONGOING_504",
        status: "COMMITTED",
        dryRun: false,
        filename: `504-bad-${stamp}.csv`,
        createdById: adminId,
        completedAt: new Date(),
      },
    });
    await prisma.autopartImportDiagnostic.create({
      data: {
        importRunId: badRun.id,
        companyId: activeId,
        status: "ERROR",
        reasonCode: "INVALID_NET_SALES",
        reason: "Goods value could not be parsed for this customer row.",
        customerAccount: accountActive,
        documentReference: reference("E"),
        isWarning: false,
      },
    });

    const withError = await getCustomerAutopartWorkspace(adminId, activeId);
    expect(withError.ongoing.hasOutstandingIssues).toBe(true);
    expect(withError.ongoing.issueKind).toBe("data_error");
    expect(withError.stages.find((stage) => stage.id === "current")?.state).toBe("ACTION_REQUIRED");

    // Foreign customer's ERROR must not appear on Active.
    const foreignRun = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: null,
        type: "ONGOING_TRM21QC",
        status: "FAILED",
        dryRun: false,
        filename: `TRM21QC-foreign-fail-${stamp}.csv`,
        createdById: adminId,
        completedAt: new Date(),
        issues: { error: "global parse failure" },
      },
    });
    await prisma.autopartImportDiagnostic.create({
      data: {
        importRunId: foreignRun.id,
        companyId: unrelatedId,
        status: "ERROR",
        reasonCode: "PARSE_ERROR",
        reason: "Unrelated parse failure",
        customerAccount: accountUnrelated,
        isWarning: false,
      },
    });
    const stillActiveError = await getCustomerAutopartWorkspace(adminId, activeId);
    expect(stillActiveError.ongoing.outstandingIssue).toMatch(/INVALID_NET_SALES|Goods value|504/i);
    expect(stillActiveError.ongoing.outstandingIssue).not.toMatch(/Unrelated parse/i);

    await prisma.autopartImportDiagnostic.deleteMany({ where: { importRunId: badRun.id } });
    const resolved = await getCustomerAutopartWorkspace(adminId, activeId);
    expect(resolved.ongoing.hasOutstandingIssues).toBe(false);
    expect(resolved.stages.find((stage) => stage.id === "current")?.state).toBe("COMPLETE");
  });

  it("reloads workspace freshness after polling and keeps Sales Enquiry without double-counting", async () => {
    const ongoingLines = await prisma.autopartSalesLine.findMany({
      where: { companyId: activeId, source: "ONGOING_TRM21QC" },
    });
    expect(ongoingLines.length).toBeGreaterThan(0);

    const histForActive = reference("AH");
    const histDocument = await prisma.autopartSalesDocument.create({
      data: {
        companyId: activeId,
        autopartCustomerCode: accountActive,
        documentType: "INVOICE",
        documentReference: histForActive,
        documentDate: new Date("2023-05-01T12:00:00.000Z"),
        goodsNet: "12.00",
        source: "SLRB",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: activeId,
        documentId: histDocument.id,
        autopartCustomerCode: accountActive,
        documentType: "INVOICE",
        documentReference: histForActive,
        lineNumber: 1,
        sku,
        units: "1",
        salesNet: "12.00",
        source: "561L",
      },
    });

    const reload = await getCustomerAutopartWorkspace(adminId, activeId);
    expect(reload.ongoing.latest504At).toBeTruthy();
    expect(reload.ongoing.latestTrm21qcAt).toBeTruthy();
    expect(reload.coverage.productLineCount).toBeGreaterThanOrEqual(2);

    const lines = await loadHistoricSalesLines({
      companyId: activeId,
      range: { from: "2014-01-01", to: "2026-12-31" },
    });
    const totals = summarizeHistoricLines(lines);
    expect(totals.netSalesMinor).toBeGreaterThan(0);

    // Same invoice must not appear twice when 561L and TRM share a reference for this company.
    const sharedRef = reference("D");
    const sharedDoc = await prisma.autopartSalesDocument.create({
      data: {
        companyId: activeId,
        autopartCustomerCode: accountActive,
        documentType: "INVOICE",
        documentReference: sharedRef,
        documentDate: new Date("2024-02-01T12:00:00.000Z"),
        goodsNet: "7.00",
        source: "SLRB",
        hasTrm21qc: true,
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: activeId,
        documentId: sharedDoc.id,
        autopartCustomerCode: accountActive,
        documentType: "INVOICE",
        documentReference: sharedRef,
        lineNumber: 1,
        sku,
        units: "1",
        salesNet: "7.00",
        source: "561L",
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: activeId,
        documentId: sharedDoc.id,
        autopartCustomerCode: accountActive,
        documentType: "INVOICE",
        documentReference: sharedRef,
        lineNumber: 9,
        sku,
        units: "1",
        salesNet: "7.00",
        source: "ONGOING_TRM21QC",
      },
    });
    const deduped = await loadHistoricSalesLines({
      companyId: activeId,
      range: { from: "2014-01-01", to: "2026-12-31" },
    });
    const shared = deduped.filter((line) => line.documentReference === sharedRef);
    expect(shared).toHaveLength(1);
    expect(Number(shared[0]!.salesNet)).toBeCloseTo(7, 2);
  });
});
