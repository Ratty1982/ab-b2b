/**
 * Production CRM live-testing coverage — no demo fixtures in routes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { getCrmOverview } from "@/server/crm/overview";
import {
  convertCrmLead,
  createCrmLead,
  listCrmLeads,
  markCrmLeadLost,
} from "@/server/crm/leads";
import {
  createCrmOpportunity,
  listCrmOpportunities,
  updateCrmOpportunityStage,
} from "@/server/crm/opportunities";
import { createCrmTask, logCrmActivity } from "@/server/crm/activities";
import { getCompanyCrmWorkspace } from "@/server/crm/customer";
import {
  createSalesIntelligenceFollowUp,
  listCrmTasks,
} from "@/server/sales-intelligence/followup";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let salesRepUserId = "";
let otherRepUserId = "";
let marketingId = "";
let tradeBuyerId = "";
let salesRepId = "";
let otherRepId = "";
let yorkId = "";
let yorkCode = "";
let outOfScopeId = "";

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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`crm.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(`crm.rep.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  otherRepUserId = await ensureUser(`crm.oth.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  marketingId = await ensureUser(`crm.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeBuyerId = await ensureUser(`crm.trade.${stamp}@example.invalid`, [], "TRADE");

  let rep = await prisma.salesRep.findFirst({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: {
        userId: salesRepUserId,
        code: `CRM-REP-${stamp}`,
        displayName: "CRM Test Rep",
        active: true,
      },
    });
  }
  salesRepId = rep.id;

  let other = await prisma.salesRep.findFirst({ where: { userId: otherRepUserId } });
  if (!other) {
    other = await prisma.salesRep.create({
      data: {
        userId: otherRepUserId,
        code: `CRM-OTH-${stamp}`,
        displayName: "Other CRM Rep",
        active: true,
      },
    });
  }
  otherRepId = other.id;

  const york = await prisma.company.create({
    data: {
      name: `York Motor Factors CRM ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: `york.crm.${stamp}@example.invalid`,
    },
  });
  yorkId = york.id;
  await prisma.companyAssignment.create({ data: { companyId: yorkId, salesRepId } });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId: yorkId,
    code: `CRMY${String(stamp).slice(-4)}`,
  });
  yorkCode = (await prisma.company.findUniqueOrThrow({ where: { id: yorkId } }))
    .autopartCustomerCode!;

  const oos = await prisma.company.create({
    data: {
      name: `CRM Out Scope ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 days",
      primaryEmail: `oos.crm.${stamp}@example.invalid`,
    },
  });
  outOfScopeId = oos.id;
  await prisma.companyAssignment.create({
    data: { companyId: outOfScopeId, salesRepId: otherRepId },
  });

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

describe("CRM production routes — no demo data imports", () => {
  it("does not import lib/data or lib/crm-data demo opportunity arrays", () => {
    const root = join(process.cwd(), "src/routes");
    for (const file of ["crm.index.tsx", "crm.overview.tsx", "crm.leads.tsx", "crm.activities.tsx", "sales.index.tsx"]) {
      const src = readFileSync(join(root, file), "utf8");
      expect(src).not.toContain('from "@/lib/data"');
      expect(src).not.toContain("from '@/lib/data'");
      expect(src).not.toContain('from "@/lib/crm-data"');
      expect(src).not.toContain("OPP-204");
      expect(src).not.toContain("James Whitfield");
      expect(src).not.toContain("opportunityDetail");
      expect(src).not.toContain("managerTotals");
    }
  });
});

describe("CRM empty / real workflow", () => {
  it("overview shows genuine zero counts for a fresh scoped book when empty of owned work", async () => {
    // Use a brand-new sales user with no tasks/opps/leads
    const lonely = await ensureUser(`crm.lonely.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const overview = await getCrmOverview(lonely, { view: "MY" });
    expect(overview.counts.tasksDueToday).toBe(0);
    expect(overview.counts.overdueTasks).toBe(0);
    expect(overview.counts.openOpportunities).toBe(0);
    expect(overview.myDay.dueToday).toEqual([]);
    expect(overview.opportunities).toEqual([]);
  });

  it("supports task → log call → opportunity → stage changes without altering company status", async () => {
    const before = await prisma.company.findUniqueOrThrow({
      where: { id: yorkId },
      select: { status: true },
    });
    expect(before.status).toBe("ACTIVE");

    const task = await createCrmTask(salesRepUserId, {
      companyId: yorkId,
      title: `Call ${yorkCode}`,
      dueDate: new Date().toISOString().slice(0, 10),
      taskType: "CALL",
    });
    expect(task.id).toBeTruthy();

    const call = await logCrmActivity(salesRepUserId, {
      type: "CALL",
      companyId: yorkId,
      outcome: "Connected",
      body: "Spoke to buyer",
    });
    expect(call.id).toBeTruthy();

    const opp = await createCrmOpportunity(salesRepUserId, {
      companyId: yorkId,
      title: "Brake cleaner range",
      value: "1250",
    });
    expect(opp.id).toBeTruthy();

    await updateCrmOpportunityStage(salesRepUserId, {
      opportunityId: opp.id,
      stage: "CONTACTED",
    });
    await updateCrmOpportunityStage(salesRepUserId, {
      opportunityId: opp.id,
      stage: "QUOTE_REQUIRED",
    });

    const list = await listCrmOpportunities(salesRepUserId, { stage: "OPEN" });
    expect(list.items.some((o) => o.id === opp.id)).toBe(true);
    expect(list.items.find((o) => o.id === opp.id)?.value).toBe("1250");

    const ws = await getCompanyCrmWorkspace(salesRepUserId, { companyId: yorkId });
    expect(ws.salesRep?.userId).toBe(salesRepUserId);
    expect(ws.timeline.some((t) => t.title?.includes("Call") || t.type === "CALL")).toBe(true);
    expect(ws.snapshot.openOpportunities).toBeGreaterThanOrEqual(1);

    const after = await prisma.company.findUniqueOrThrow({
      where: { id: yorkId },
      select: { status: true },
    });
    expect(after.status).toBe("ACTIVE");

    const ordersBefore = await prisma.order.count({ where: { companyId: yorkId } });
    await updateCrmOpportunityStage(salesRepUserId, {
      opportunityId: opp.id,
      stage: "LOST",
      confirmWonLost: true,
      lostReason: "Not ready",
    });
    expect(await prisma.order.count({ where: { companyId: yorkId } })).toBe(ordersBefore);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "crm.opportunity.lost", entityId: opp.id },
    });
    expect(audit).toBeTruthy();
  });

  it("lead lifecycle: create → call → convert without auto opportunity", async () => {
    const created = await createCrmLead(salesRepUserId, {
      companyName: `Prospect Factors ${stamp}`,
      contactName: "Alex Buyer",
      email: `alex.${stamp}@example.invalid`,
      phone: "01234567890",
      source: "PHONE",
    });
    await logCrmActivity(salesRepUserId, {
      type: "CALL",
      leadId: created.id,
      outcome: "Left Message",
    });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: created.id } });
    expect(lead.status).toBe("CONTACTED");

    const converted = await convertCrmLead(salesRepUserId, {
      leadId: created.id,
      mode: "CREATE_NEW",
      createOpportunity: false,
    });
    expect(converted.status).toBe("CONVERTED");
    expect(converted.opportunityId).toBeNull();
    expect(converted.companyId).toBeTruthy();
    const co = await prisma.company.findUniqueOrThrow({
      where: { id: converted.companyId! },
    });
    expect(co.status).toBe("PROSPECT");
    expect(co.name).toContain("Prospect Factors");

    const still = await prisma.lead.findUniqueOrThrow({ where: { id: created.id } });
    expect(still.status).toBe("CONVERTED");
  });

  it("mark lead lost records reason", async () => {
    const created = await createCrmLead(salesRepUserId, {
      companyName: `Lost Prospect ${stamp}`,
      source: "EMAIL",
    });
    const r = await markCrmLeadLost(salesRepUserId, {
      leadId: created.id,
      reason: "No response",
    });
    expect(r.status).toBe("DISQUALIFIED");
  });

  it("enforces security and scope", async () => {
    await expect(getCrmOverview("no-user", {})).rejects.toBeInstanceOf(AuthError);
    await expect(
      createCrmOpportunity(tradeBuyerId, {
        companyId: yorkId,
        title: "Nope",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      createCrmOpportunity(marketingId, {
        companyId: yorkId,
        title: "Nope",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      createCrmOpportunity(salesRepUserId, {
        companyId: outOfScopeId,
        title: "Out of scope",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      logCrmActivity(salesRepUserId, {
        type: "CALL",
        companyId: outOfScopeId,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("PL-003: client companyId cannot expand sales scope for CRM/SI lists", async () => {
    const { listCrmActivities } = await import("@/server/crm/activities");

    const oppB = await createCrmOpportunity(otherRepUserId, {
      companyId: outOfScopeId,
      title: `Out-of-scope opp ${stamp}`,
      value: "99",
    });
    const actB = await logCrmActivity(otherRepUserId, {
      type: "NOTE",
      companyId: outOfScopeId,
      body: `Secret note ${stamp}`,
    });
    const taskB = await createCrmTask(otherRepUserId, {
      companyId: outOfScopeId,
      title: `Secret task ${stamp}`,
      dueDate: new Date().toISOString().slice(0, 10),
      taskType: "CALL",
    });

    await expect(
      listCrmOpportunities(salesRepUserId, { companyId: outOfScopeId }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      listCrmActivities(salesRepUserId, { companyId: outOfScopeId }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      listCrmTasks(salesRepUserId, { companyId: outOfScopeId }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getCompanyCrmWorkspace(salesRepUserId, { companyId: outOfScopeId }),
    ).rejects.toBeInstanceOf(AuthError);

    const ownOpps = await listCrmOpportunities(salesRepUserId, { companyId: yorkId });
    expect(ownOpps.items.every((o) => o.company.id === yorkId)).toBe(true);
    expect(ownOpps.items.some((o) => o.id === oppB.id)).toBe(false);

    const ownActs = await listCrmActivities(salesRepUserId, { companyId: yorkId });
    expect(ownActs.items.every((a) => a.company?.id === yorkId)).toBe(true);
    expect(ownActs.items.some((a) => a.id === actB.id)).toBe(false);

    const ownTasks = await listCrmTasks(salesRepUserId, { companyId: yorkId });
    expect(ownTasks.items.every((t) => t.company?.id === yorkId)).toBe(true);
    expect(ownTasks.items.some((t) => t.id === taskB.id)).toBe(false);

    // Managers retain team/all visibility when requesting a company in their remit.
    const managerView = await listCrmOpportunities(adminId, { companyId: outOfScopeId });
    expect(managerView.items.some((o) => o.id === oppB.id)).toBe(true);
  });

  it("lists leads without inventing demo rows", async () => {
    const list = await listCrmLeads(adminId, { status: "ALL", pageSize: 5 });
    expect(list.items.every((l) => !l.companyName.includes("ABC Motor Factors"))).toBe(true);
    expect(list.items.every((l) => !String(l.companyName).includes("OPP-204"))).toBe(true);
  });
});

describe("CRM + Sales Intelligence follow-up regression", () => {
  it("SI follow-up tasks appear in CRM task list with source context", async () => {
    // Minimal gap evidence: comparison invoice only for a unique SKU
    const sku = `CRM-SI-${stamp}`;
    const run = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: yorkId,
        type: "HISTORY_561L_SLRB",
        status: "COMMITTED",
        dryRun: false,
        completedAt: new Date(),
        rowsImported: 1,
        detectedAccount: yorkCode,
      },
    });
    const doc = await prisma.autopartSalesDocument.create({
      data: {
        companyId: yorkId,
        autopartCustomerCode: yorkCode,
        documentType: "INVOICE",
        documentReference: `CRM-SI-${yorkCode}`,
        documentDate: new Date("2025-06-10T12:00:00.000Z"),
        source: "SLRB",
        importRunId: run.id,
      },
    });
    await prisma.autopartSalesLine.create({
      data: {
        companyId: yorkId,
        documentId: doc.id,
        autopartCustomerCode: yorkCode,
        documentType: "INVOICE",
        documentReference: `CRM-SI-${yorkCode}`,
        lineNumber: 1,
        sku,
        descriptionSnapshot: "CRM SI Cleaner",
        units: "12",
        salesNet: "89.52",
        matchStatus: "NOT_IN_AB_CATALOGUE",
        source: "561L",
        importRunId: run.id,
      },
    });

    const created = await createSalesIntelligenceFollowUp(salesRepUserId, {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: yorkId,
      sku,
      period: "CUSTOM",
      from: "2026-03-01",
      to: "2026-03-31",
      compare: "CUSTOM",
      compareFrom: "2025-06-01",
      compareTo: "2025-06-30",
      title: "Follow up — CRM SI Cleaner",
      assigneeId: salesRepUserId,
      duePreset: "TODAY",
      allowDuplicate: true,
    });
    expect(created.created).toBe(true);
    if (!created.created) throw new Error("expected create");

    const tasks = await listCrmTasks(salesRepUserId, {
      sourceModule: "GAP_ANALYSIS",
      pageSize: 50,
    });
    expect(tasks.items.some((t) => t.id === created.task.id)).toBe(true);

    const overview = await getCrmOverview(salesRepUserId, { view: "MY" });
    expect(
      overview.myDay.dueToday.some((t) => t.id === created.task.id) ||
        overview.myDay.overdue.some((t) => t.id === created.task.id) ||
        overview.myDay.upcoming.some((t) => t.id === created.task.id),
    ).toBe(true);

    const ws = await getCompanyCrmWorkspace(salesRepUserId, { companyId: yorkId });
    expect(ws.timeline.some((t) => t.title === "Sales follow-up created")).toBe(true);

    // Snapshot immutability: captured reason stays STOPPED
    expect(created.snapshot.sourceReason).toBe("STOPPED");
    expect(created.snapshot.metrics["Comparison qty"]).toBe(12);
  });
});
