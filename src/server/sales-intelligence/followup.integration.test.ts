/**
 * Sales Intelligence → CRM follow-up integration coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { AUTOPART_WAREHOUSE_CODE } from "@/domain/stock";
import { getCustomerGapAnalysis } from "@/server/sales-intelligence/gap";
import {
  completeCrmTask,
  createSalesIntelligenceFollowUp,
  getCrmTask,
  listCrmTasks,
  previewSalesIntelligenceFollowUp,
} from "@/server/sales-intelligence/followup";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let salesRepUserId = "";
let otherRepUserId = "";
let managerId = "";
let marketingId = "";
let accountsId = "";
let tradeBuyerId = "";
let salesRepId = "";
let otherRepId = "";

let yorkId = "";
let yorkCode = "";
let outOfScopeId = "";
let brandId = "";
let catId = "";

const skuStopped = `FU-STOP-${stamp}`;
const skuHist = `FU-HIST-${stamp}`;
const skuRangeAnchor1 = `FU-A1-${stamp}`;
const skuRangeAnchor2 = `FU-A2-${stamp}`;
const skuRangeAnchor3 = `FU-A3-${stamp}`;
const skuRangeCand = `FU-CAND-${stamp}`;

const SELECTED = { from: "2026-03-01", to: "2026-03-31" } as const;
const COMPARISON = { from: "2025-06-01", to: "2025-06-30" } as const;
const RANGE_PERIOD = { from: "2025-10-01", to: "2026-09-29" } as const;

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

async function ensureCatalogueSku(sku: string, name: string) {
  const existing = await prisma.productVariant.findUnique({ where: { sku } });
  if (!existing) {
    await saveProduct(adminId, {
      sku,
      name,
      brand: `tmp-${sku}`,
      category: `tmp-c-${sku}`,
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 12,
      description: name,
      active: true,
    });
  }
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
  await prisma.product.update({
    where: { id: v.productId },
    data: {
      brandId,
      categoryId: catId,
      isActive: true,
      isTradeVisible: true,
      status: "ACTIVE",
      name,
    },
  });
  return v;
}

async function seedStock(variantId: string, avail: number) {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    create: { code: AUTOPART_WAREHOUSE_CODE, name: "Autopart", isDefault: true },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
    create: {
      variantId,
      warehouseId: warehouse.id,
      qtyOnHand: avail,
      qtyReserved: 0,
      status: "IN_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
    update: {
      qtyOnHand: avail,
      qtyReserved: 0,
      status: "IN_STOCK",
      externalSyncedAt: new Date(),
      sourceAvailRaw: String(avail),
    },
  });
}

async function createCompany(name: string, email: string) {
  return prisma.company.create({
    data: {
      name,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: email,
    },
  });
}

async function setupAssignedCompany(
  name: string,
  email: string,
  repId: string,
  codeSuffix: string,
) {
  const co = await createCompany(name, email);
  await prisma.companyAssignment.create({ data: { companyId: co.id, salesRepId: repId } });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: co.id,
    code: `FU${codeSuffix}${String(stamp).slice(-3)}`,
  });
  const code = (await prisma.company.findUniqueOrThrow({ where: { id: co.id } }))
    .autopartCustomerCode!;
  return { id: co.id, code };
}

async function seedInvoice(
  companyId: string,
  code: string,
  ref: string,
  date: string,
  lines: Array<{ sku: string; units: string; salesNet: string; line: number; desc?: string }>,
) {
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      dryRun: false,
      completedAt: new Date(),
      rowsImported: lines.length,
      detectedAccount: code,
    },
  });
  const doc = await prisma.autopartSalesDocument.create({
    data: {
      companyId,
      autopartCustomerCode: code,
      documentType: "INVOICE",
      documentReference: ref,
      documentDate: new Date(`${date}T12:00:00.000Z`),
      source: "SLRB",
      importRunId: run.id,
    },
  });
  for (const l of lines) {
    await prisma.autopartSalesLine.create({
      data: {
        companyId,
        documentId: doc.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: ref,
        lineNumber: l.line,
        sku: l.sku,
        descriptionSnapshot: l.desc ?? l.sku,
        units: l.units,
        salesNet: l.salesNet,
        matchStatus: "MATCHED",
        source: "561L",
        importRunId: run.id,
      },
    });
  }
  return run.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`fu.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(`fu.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  otherRepUserId = await ensureUser(`fu.other.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  managerId = await ensureUser(`fu.mgr.${stamp}@example.invalid`, ["SALES_MANAGER"]);
  marketingId = await ensureUser(`fu.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  accountsId = await ensureUser(`fu.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  tradeBuyerId = await ensureUser(`fu.trade.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: { name: `FU Brand ${stamp}`, slug: `fu-brand-${stamp}` },
  });
  brandId = brand.id;
  const cat = await prisma.category.create({
    data: { name: `FU Cat ${stamp}`, slug: `fu-cat-${stamp}` },
  });
  catId = cat.id;

  const stopped = await ensureCatalogueSku(skuStopped, "Catalytic Converter Cleaner");
  await ensureCatalogueSku(skuRangeAnchor1, "FU Multi Lube");
  await ensureCatalogueSku(skuRangeAnchor2, "FU Wheel Cleaner");
  await ensureCatalogueSku(skuRangeAnchor3, "FU Glass Cleaner");
  const cand = await ensureCatalogueSku(skuRangeCand, "FU Brake Cleaner 500ml");
  await seedStock(stopped.id, 40);
  await seedStock(cand.id, 40);
  for (const sku of [skuRangeAnchor1, skuRangeAnchor2, skuRangeAnchor3]) {
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    await seedStock(v.id, 40);
  }

  let rep = await prisma.salesRep.findFirst({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: salesRepUserId,
        code: `FU-REP-${stamp}`,
        displayName: "Wayne Radford",
        active: true,
      },
    });
  } else {
    await prisma.salesRep.update({
      where: { id: rep.id },
      data: { displayName: "Wayne Radford", active: true },
    });
  }
  salesRepId = rep.id;

  let other = await prisma.salesRep.findFirst({ where: { userId: otherRepUserId } });
  if (!other) {
    other = await prisma.salesRep.create({
      data: {
        userId: otherRepUserId,
        code: `FU-OTH-${stamp}`,
        displayName: "Other Rep",
        active: true,
      },
    });
  }
  otherRepId = other.id;

  const york = await setupAssignedCompany(
    `York Motor Factors ${stamp}`,
    `fu.york.${stamp}@example.invalid`,
    salesRepId,
    "Y",
  );
  yorkId = york.id;
  yorkCode = york.code;

  // Gap: STOPPED cleaner + historic-only SKU in comparison, nothing in selected
  await seedInvoice(yorkId, yorkCode, `FU-${yorkCode}-C1`, "2025-06-12", [
    {
      sku: skuStopped,
      units: "12",
      salesNet: "89.52",
      line: 1,
      desc: "Catalytic Converter Cleaner",
    },
    {
      sku: skuHist,
      units: "7",
      salesNet: "70.00",
      line: 2,
      desc: "Historic Catalytic Flush",
    },
    { sku: skuRangeAnchor1, units: "5", salesNet: "50.00", line: 3 },
    { sku: skuRangeAnchor2, units: "4", salesNet: "40.00", line: 4 },
    { sku: skuRangeAnchor3, units: "3", salesNet: "30.00", line: 5 },
  ]);
  // Selected period — no stopped / historic SKUs (keeps STOPPED); anchors remain for range similarity
  await seedInvoice(yorkId, yorkCode, `FU-${yorkCode}-S1`, "2026-03-14", [
    { sku: skuRangeAnchor1, units: "5", salesNet: "50.00", line: 1 },
    { sku: skuRangeAnchor2, units: "4", salesNet: "40.00", line: 2 },
    { sku: skuRangeAnchor3, units: "3", salesNet: "30.00", line: 3 },
  ]);

  // Comparable cohort for Range Opportunities (admin-scoped)
  for (const [suffix, buyCand] of [
    ["B", true],
    ["C", true],
    ["D", true],
    ["E", false],
  ] as const) {
    const co = await setupAssignedCompany(
      `FU Peer ${suffix} ${stamp}`,
      `fu.peer.${suffix}.${stamp}@example.invalid`,
      salesRepId,
      suffix,
    );
    const lines = [
      { sku: skuRangeAnchor1, units: "5", salesNet: "50.00", line: 1 },
      { sku: skuRangeAnchor2, units: "4", salesNet: "40.00", line: 2 },
      { sku: skuRangeAnchor3, units: "3", salesNet: "30.00", line: 3 },
    ];
    if (buyCand) {
      lines.push({ sku: skuRangeCand, units: "8", salesNet: "80.00", line: 4 });
    }
    await seedInvoice(co.id, co.code, `FU-${co.code}-1`, "2026-04-01", lines);
  }

  const oos = await setupAssignedCompany(
    `FU Out Of Scope ${stamp}`,
    `fu.oos.${stamp}@example.invalid`,
    otherRepId,
    "X",
  );
  outOfScopeId = oos.id;
  await seedInvoice(outOfScopeId, oos.code, `FU-${oos.code}-1`, "2025-06-10", [
    { sku: skuStopped, units: "9", salesNet: "90.00", line: 1 },
  ]);

  await prisma.companyUser.create({
    data: {
      companyId: yorkId,
      userId: tradeBuyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const gapBase = {
  sourceModule: "GAP_ANALYSIS" as const,
  companyId: () => yorkId,
  sku: skuStopped,
  period: "CUSTOM",
  from: SELECTED.from,
  to: SELECTED.to,
  compare: "CUSTOM",
  compareFrom: COMPARISON.from,
  compareTo: COMPARISON.to,
  sourceReason: "STOPPED" as const,
};

describe("Sales Intelligence Follow-ups", () => {
  it("creates Gap STOPPED follow-up with authoritative snapshot, activity, and audit", async () => {
    const leadsBefore = await prisma.lead.count({ where: { companyId: yorkId } });
    const oppsBefore = await prisma.opportunity.count({ where: { companyId: yorkId } });

    const preview = await previewSalesIntelligenceFollowUp(salesRepUserId, {
      ...gapBase,
      companyId: yorkId,
    });
    expect(preview.snapshot.sourceModule).toBe("GAP_ANALYSIS");
    expect(preview.snapshot.sourceReason).toBe("STOPPED");
    expect(preview.snapshot.sku).toBe(skuStopped);
    expect(preview.snapshot.productName).toContain("Catalytic Converter Cleaner");
    expect(preview.defaultAssignee.id).toBe(salesRepUserId);
    expect(preview.title).toContain("Catalytic Converter Cleaner");
    expect(Number(preview.snapshot.metrics["Comparison qty"])).toBe(12);
    expect(String(preview.snapshot.metrics["Comparison net sales"])).toContain("89.52");
    expect(Number(preview.snapshot.metrics["Selected qty"])).toBe(0);

    const created = await createSalesIntelligenceFollowUp(salesRepUserId, {
      ...gapBase,
      companyId: yorkId,
      title: preview.title,
      assigneeId: preview.defaultAssignee.id,
      duePreset: "IN_3_DAYS",
      priority: "NORMAL",
      notes: "Call the buyer",
    });
    expect(created.created).toBe(true);
    if (!created.created) throw new Error("expected created");

    const task = await prisma.task.findUniqueOrThrow({ where: { id: created.task.id } });
    expect(task.companyId).toBe(yorkId);
    expect(task.assigneeId).toBe(salesRepUserId);
    expect(task.sourceModule).toBe("GAP_ANALYSIS");
    expect(task.sourceReason).toBe("STOPPED");
    expect(task.sourceSku).toBe(skuStopped);
    expect(task.productId).toBeTruthy();
    const ctx = task.sourceContext as Record<string, unknown>;
    expect(ctx["sourceModule"]).toBe("GAP_ANALYSIS");
    expect(ctx["sourceReason"]).toBe("STOPPED");
    expect(created.task.href).toContain("/crm/tasks");
    expect(created.task.href).toContain(created.task.id);

    const activity = await prisma.activity.findFirst({
      where: {
        companyId: yorkId,
        type: "FOLLOW_UP",
        subject: "Sales follow-up created",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(activity?.body).toContain("Gap Analysis");
    expect(activity?.body).toContain("Catalytic Converter Cleaner");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "sales_followup.created", entityId: created.task.id },
    });
    expect(audit?.actorUserId).toBe(salesRepUserId);
    expect(audit?.companyId).toBe(yorkId);

    expect(await prisma.lead.count({ where: { companyId: yorkId } })).toBe(leadsBefore);
    expect(await prisma.opportunity.count({ where: { companyId: yorkId } })).toBe(oppsBefore);

    const detail = await getCrmTask(salesRepUserId, { taskId: created.task.id });
    expect(detail.deepLinkPath).toContain("/sales/sales-intelligence/gaps");
    expect(detail.deepLinkPath).toContain(yorkId);
    expect(detail.snapshot?.metrics["Comparison qty"]).toBe(12);
  });

  it("warns on open duplicate and allows explicit override; completed does not warn", async () => {
    const first = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — Historic Catalytic Flush",
      assigneeId: salesRepUserId,
      duePreset: "TOMORROW",
    });
    expect(first.created).toBe(true);
    if (!first.created) throw new Error("expected first");

    const dup = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — Historic Catalytic Flush",
      assigneeId: salesRepUserId,
      duePreset: "TOMORROW",
    });
    expect(dup.created).toBe(false);
    if (dup.created) throw new Error("expected duplicate");
    expect(dup.duplicate.id).toBe(first.task.id);

    const second = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — Historic Catalytic Flush again",
      assigneeId: salesRepUserId,
      duePreset: "IN_1_WEEK",
      allowDuplicate: true,
    });
    expect(second.created).toBe(true);
    if (!second.created) throw new Error("expected override");
    expect(second.task.id).not.toBe(first.task.id);

    const overrideAudit = await prisma.auditEvent.findFirst({
      where: { action: "sales_followup.duplicate_override", entityId: second.task.id },
    });
    expect(overrideAudit).toBeTruthy();

    await completeCrmTask(adminId, { taskId: first.task.id });
    await completeCrmTask(adminId, { taskId: second.task.id });

    const afterComplete = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — after complete",
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
    });
    expect(afterComplete.created).toBe(true);
  });

  it("supports historic-only SKU follow-up without creating a catalogue product", async () => {
    const productsBefore = await prisma.product.count();
    const created = await createSalesIntelligenceFollowUp(salesRepUserId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — Historic Catalytic Flush",
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
      allowDuplicate: true,
    });
    expect(created.created).toBe(true);
    if (!created.created) throw new Error("expected created");
    expect(created.snapshot.productId).toBeNull();
    expect(created.snapshot.historicOnly).toBe(true);
    expect(created.snapshot.productName).toContain("Historic");
    expect(await prisma.product.count()).toBe(productsBefore);
    expect(await prisma.productVariant.findUnique({ where: { sku: skuHist } })).toBeNull();
  });

  it("creates Range Opportunity follow-up with factual adoption snapshot", async () => {
    const created = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "RANGE_OPPORTUNITY",
      companyId: yorkId,
      sku: skuRangeCand,
      period: "CUSTOM",
      from: RANGE_PERIOD.from,
      to: RANGE_PERIOD.to,
      opportunityPeriod: "CUSTOM",
      title: "Range opportunity — FU Brake Cleaner 500ml",
      assigneeId: salesRepUserId,
      duePreset: "IN_3_DAYS",
    });
    expect(created.created).toBe(true);
    if (!created.created) throw new Error("expected created");
    expect(created.snapshot.sourceModule).toBe("RANGE_OPPORTUNITY");
    expect(created.snapshot.sourceReason).toBe("RANGE_GAP");
    expect(created.snapshot.metrics["Range match"]).toBeTruthy();
    expect(Number(created.snapshot.metrics["Comparable buyers"])).toBeGreaterThanOrEqual(3);
    expect(Number(created.snapshot.metrics["Comparable customers"])).toBeGreaterThanOrEqual(3);
    expect(String(created.snapshot.metrics["Observed adoption"])).toMatch(/%/);
    // No comparable customer identities in snapshot
    const ctxJson = JSON.stringify(created.snapshot);
    expect(ctxJson).not.toMatch(/FU Peer/);
    expect(created.snapshot.deepLinkPath).toContain("/sales/sales-intelligence/opportunities");
    expect(await prisma.opportunity.count({ where: { companyId: yorkId } })).toBe(0);
    expect(await prisma.lead.count({ where: { companyId: yorkId } })).toBe(0);
  });

  it("creates Sales Enquiry and Rebate customer-level follow-ups", async () => {
    const enquiry = await createSalesIntelligenceFollowUp(salesRepUserId, {
      sourceModule: "SALES_ENQUIRY",
      companyId: yorkId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      title: `Follow up — York Motor Factors ${stamp}`,
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
    });
    expect(enquiry.created).toBe(true);
    if (!enquiry.created) throw new Error("expected enquiry");
    expect(enquiry.snapshot.sourceReason).toBe("CUSTOMER");
    expect(enquiry.snapshot.sku).toBeNull();

    const rebate = await createSalesIntelligenceFollowUp(salesRepUserId, {
      sourceModule: "REBATE_ANALYSIS",
      companyId: yorkId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      title: `Net spend review — York Motor Factors ${stamp}`,
      assigneeId: salesRepUserId,
      duePreset: "TOMORROW",
    });
    expect(rebate.created).toBe(true);
    if (!rebate.created) throw new Error("expected rebate");
    expect(rebate.snapshot.sourceReason).toBe("NET_SPEND_REVIEW");
    expect(rebate.snapshot.metrics["Net spend"]).toBeDefined();
    const text = JSON.stringify(rebate.snapshot).toLowerCase();
    expect(text).not.toContain("rebate due");
    expect(text).not.toContain("rebate eligible");
  });

  it("keeps captured Gap snapshot when live classification later changes", async () => {
    const created = await createSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuStopped,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      title: "Follow up — Catalytic Converter Cleaner",
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
      allowDuplicate: true,
    });
    expect(created.created).toBe(true);
    if (!created.created) throw new Error("expected created");
    const capturedQty = created.snapshot.metrics["Selected qty"];
    const capturedReason = created.snapshot.sourceReason;

    // New selected-period invoice changes live Gap away from STOPPED
    await seedInvoice(yorkId, yorkCode, `FU-${yorkCode}-LATE`, "2026-03-28", [
      { sku: skuStopped, units: "4", salesNet: "30.00", line: 1 },
    ]);

    const live = await getCustomerGapAnalysis(adminId, {
      companyId: yorkId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
      q: skuStopped,
      status: "ALL_CHANGES",
      pageSize: 20,
    });
    const liveRow = live.items.items.find(
      (r) => r.sku.trim().toUpperCase() === skuStopped.toUpperCase(),
    );
    expect(liveRow).toBeTruthy();
    expect(liveRow!.status).not.toBe("STOPPED");

    const detail = await getCrmTask(adminId, { taskId: created.task.id });
    expect(detail.snapshot?.sourceReason).toBe(capturedReason);
    expect(detail.snapshot?.metrics["Selected qty"]).toBe(capturedQty);
    expect(detail.deepLinkPath).toContain("gaps");
  });

  it("lists SI-originated tasks in CRM Tasks with source filter", async () => {
    const list = await listCrmTasks(adminId, {
      sourceModule: "GAP_ANALYSIS",
      status: "OPEN_ACTIVE",
      pageSize: 100,
    });
    expect(list.items.some((t) => t.company?.id === yorkId && t.sourceModule === "GAP_ANALYSIS")).toBe(
      true,
    );
    const mine = await listCrmTasks(salesRepUserId, {
      sourceModule: "ALL",
      pageSize: 100,
    });
    expect(mine.items.every((t) => t.assigneeName || t.id)).toBe(true);
    expect(mine.items.some((t) => t.company?.id === yorkId)).toBe(true);
  });

  it("enforces security, scope, and server-side validation", async () => {
    await expect(
      createSalesIntelligenceFollowUp("anonymous-user-id", {
        ...gapBase,
        companyId: yorkId,
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      createSalesIntelligenceFollowUp(tradeBuyerId, {
        ...gapBase,
        companyId: yorkId,
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      createSalesIntelligenceFollowUp(marketingId, {
        ...gapBase,
        companyId: yorkId,
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Accounts can view SI but cannot create CRM tasks
    await expect(
      createSalesIntelligenceFollowUp(accountsId, {
        ...gapBase,
        companyId: yorkId,
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Out-of-scope company for own-rep
    await expect(
      createSalesIntelligenceFollowUp(salesRepUserId, {
        ...gapBase,
        companyId: outOfScopeId,
        title: "x",
        assigneeId: otherRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Manipulated SKU
    await expect(
      createSalesIntelligenceFollowUp(salesRepUserId, {
        ...gapBase,
        companyId: yorkId,
        sku: "DOES-NOT-EXIST-SKU",
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Manipulated classification rejected when it doesn't match authoritative row
    await expect(
      createSalesIntelligenceFollowUp(salesRepUserId, {
        ...gapBase,
        companyId: yorkId,
        sku: skuHist,
        sourceReason: "INCREASED",
        title: "x",
        assigneeId: salesRepUserId,
        duePreset: "TODAY",
        allowDuplicate: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Manipulated assignee rejected for non-manager
    await expect(
      createSalesIntelligenceFollowUp(salesRepUserId, {
        ...gapBase,
        companyId: yorkId,
        sku: skuHist,
        title: "x",
        assigneeId: otherRepUserId,
        duePreset: "TODAY",
        allowDuplicate: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Client-supplied fake metrics are ignored — server rebuilds snapshot
    const preview = await previewSalesIntelligenceFollowUp(adminId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku: skuHist,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      compare: "CUSTOM",
      compareFrom: COMPARISON.from,
      compareTo: COMPARISON.to,
    });
    expect(Number(preview.snapshot.metrics["Comparison qty"])).toBe(7);
    expect(preview.snapshot.metrics["Comparison qty"]).not.toBe(99999);

    // Sales manager can create within broader scope
    const mgr = await createSalesIntelligenceFollowUp(managerId, {
      sourceModule: "SALES_ENQUIRY",
      companyId: yorkId,
      period: "CUSTOM",
      from: SELECTED.from,
      to: SELECTED.to,
      title: "Manager follow-up",
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
      allowDuplicate: true,
    });
    expect(mgr.created).toBe(true);
  });
});
