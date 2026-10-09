import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { getCompanyAutopartHistoryWorkspace } from "@/server/companies/autopart-history";
import {
  inviteCompanyUser,
  listCompaniesForActor,
  revokeCompanyUserInvitation,
  updateCompany,
} from "@/server/companies/service";
import {
  beginAutopartProspectConversion,
  executeAutopartProspectConversion,
  getAutopartProspectConversion,
  previewAutopartProspectConversion,
  resumeAutopartProspectConversion,
  writeProspectConversionExceptions,
} from "@/server/companies/autopart-prospect-conversion";
import {
  getPortalAutopartHistory,
  listAutopartLedger,
} from "@/server/companies/autopart-master-import";

const prisma = new PrismaClient();
const stamp = `P${Date.now().toString(36).slice(-6).toUpperCase()}`;
const eligibleCode = `${stamp}01`;
const linkedCode = `${stamp}02`;
const sameCodeA = `${stamp}03`;
const sameCodeB = `${stamp}04`;
const reuseCode = `${stamp}05`;
const conflictCode = `${stamp}06`;
const otherLinkedCode = `${stamp}07`;
const unmatchedCode = `${stamp}NO`;
const repCode = `R${stamp}`;
const otherRepCode = `X${stamp}`;
const sameName = `Same ${stamp}`;
const keepNote = `KEEP ${stamp}`;

let adminId = "";
let salesId = "";
let otherSalesId = "";
let managementId = "";
let salesRepId = "";
let otherSalesRepId = "";
let batchId = "";
let reuseCompanyId = "";
let linkedCompanyId = "";
let manualSameCompanyId = "";
const previousFlag = process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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

async function waitRun(runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await getAutopartProspectConversion(adminId, runId);
    if (
      current.status === "COMMITTED" ||
      current.status === "FAILED" ||
      current.status === "CANCELLED"
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getAutopartProspectConversion(adminId, runId);
}

describe("Autopart prospect conversion", () => {
  beforeAll(async () => {
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    await bootstrapRbac(prisma);
    adminId = await ensureUser(`prospect.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    salesId = await ensureUser(`prospect.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    otherSalesId = await ensureUser(`prospect.other.${stamp}@example.invalid`, [
      "SALES_REPRESENTATIVE",
    ]);
    managementId = await ensureUser(`prospect.mgmt.${stamp}@example.invalid`, ["MANAGEMENT"]);

    const batch = await prisma.autopartImportBatch.create({
      data: {
        kind: "INVOICE_LINES",
        status: "COMMITTED",
        filename: `${stamp}-561.csv`,
        fileHash: stamp,
        dryRun: false,
        importedRows: 3,
        validRows: 3,
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
        createdById: adminId,
      },
    });
    batchId = batch.id;

    const sales = await prisma.salesRep.create({
      data: { userId: salesId, code: repCode, active: true },
    });
    salesRepId = sales.id;
    const other = await prisma.salesRep.create({
      data: { userId: otherSalesId, code: otherRepCode, active: true },
    });
    otherSalesRepId = other.id;

    const linkedCompany = await prisma.company.create({
      data: {
        name: `Linked ${stamp}`,
        status: "PENDING_APPROVAL",
        autopartCustomerCode: linkedCode,
      },
    });
    linkedCompanyId = linkedCompany.id;
    const reuse = await prisma.company.create({
      data: {
        name: `Reuse ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: reuseCode,
        notes: keepNote,
      },
    });
    reuseCompanyId = reuse.id;
    await prisma.companyAssignment.create({
      data: { companyId: reuseCompanyId, salesRepId: otherSalesRepId, isPrimary: true },
    });
    const manual = await prisma.company.create({
      data: { name: sameName, status: "PROSPECT", notes: `manual ${stamp}` },
    });
    manualSameCompanyId = manual.id;
    const conflictCompany = await prisma.company.create({
      data: { name: `Conflict ${stamp}`, status: "ACTIVE", autopartCustomerCode: conflictCode },
    });
    await prisma.company.create({
      data: { name: `Plain ${stamp}`, status: "PROSPECT" },
    });
    await prisma.company.create({
      data: { name: `Closed ${stamp}`, status: "CLOSED" },
    });

    await prisma.autopartAccount.createMany({
      data: [
        {
          accountCode: eligibleCode,
          originalName: `Eligible ${stamp}`,
          classification: "TRADE_CANDIDATE",
          areaCode: "N1",
          repCode,
        },
        {
          accountCode: linkedCode,
          originalName: `Linked ${stamp}`,
          classification: "TRADE_CANDIDATE",
          companyId: linkedCompanyId,
        },
        {
          accountCode: sameCodeA,
          originalName: sameName,
          classification: "TRADE_CANDIDATE",
        },
        {
          accountCode: sameCodeB,
          originalName: sameName,
          classification: "TRADE_CANDIDATE",
        },
        {
          accountCode: reuseCode,
          originalName: `Reuse source ${stamp}`,
          classification: "TRADE_CANDIDATE",
        },
        {
          accountCode: conflictCode,
          originalName: `Conflict ${stamp}`,
          classification: "TRADE_CANDIDATE",
        },
        {
          accountCode: otherLinkedCode,
          originalName: `Other link ${stamp}`,
          classification: "TRADE_CANDIDATE",
          companyId: conflictCompany.id,
        },
        { accountCode: `${stamp}08`, originalName: `=cmd ${stamp}`, classification: "INTERNAL" },
        { accountCode: `${stamp}09`, originalName: `Staff ${stamp}`, classification: "STAFF" },
        { accountCode: `${stamp}10`, originalName: `Cash ${stamp}`, classification: "CASH" },
        { accountCode: `${stamp}11`, originalName: `DNU ${stamp}`, classification: "DO_NOT_USE" },
        { accountCode: `${stamp}12`, originalName: `Old ${stamp}`, classification: "OBSOLETE" },
        {
          accountCode: `${stamp}13`,
          originalName: `Unknown ${stamp}`,
          classification: "UNIDENTIFIED",
        },
        {
          accountCode: `${stamp}14`,
          originalName: `Review ${stamp}`,
          classification: "REQUIRES_REVIEW",
        },
      ],
    });
    const eligible = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: eligibleCode } },
    });
    await prisma.autopartInvoiceLine.createMany({
      data: [
        line("P-FREQ", "4.00", "1"),
        line("P-FREQ", "4.00", "2"),
        line("P-ONCE", "1.00", "3"),
      ].map((row) => ({ ...row, accountId: eligible.id })),
    });
    await prisma.autopartInvoiceLine.create({
      data: {
        sourceIdentity: `${stamp}-unmatched`,
        accountCode: unmatchedCode,
        rawInvAndLn: "U/1",
        partNumber: "UNMATCHED",
        quantity: "1.000",
        salesAmount: "50.00",
        salesMeasure: "NET_EX_VAT",
        importBatchId: batchId,
        rawSource: {},
      },
    });
    await prisma.autopartLedgerTransaction.create({
      data: {
        sourceIdentity: `${stamp}-ledger`,
        accountCode: eligibleCode,
        accountId: eligible.id,
        rawType: "CSH",
        ledgerKind: "PAYMENT",
        reference: `PAY${stamp}`,
        goodsAmount: "9.00",
        vatAmount: "1.80",
        totalAmount: "10.80",
        runningBalance: "10.80",
        importBatchId: batchId,
        rawSource: {},
      },
    });
  });

  afterAll(async () => {
    if (previousFlag == null) delete process.env["AUTOPART_PORTAL_HISTORY_ENABLED"];
    else process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = previousFlag;
    const companies = await prisma.company.findMany({
      where: {
        OR: [{ name: { contains: stamp } }, { autopartCustomerCode: { startsWith: stamp } }],
      },
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);
    if (companyIds.length) {
      await prisma.userInvitation.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.companyUser.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.activity.deleteMany({ where: { companyId: { in: companyIds } } });
    }
    await prisma.autopartLedgerTransaction.deleteMany({
      where: { accountCode: { startsWith: stamp } },
    });
    await prisma.autopartInvoiceLine.deleteMany({
      where: {
        OR: [{ accountCode: { startsWith: stamp } }, { sourceIdentity: { startsWith: stamp } }],
      },
    });
    await prisma.autopartAccount.deleteMany({ where: { accountCode: { startsWith: stamp } } });
    if (adminId) {
      await prisma.autopartProspectConversionRun.deleteMany({ where: { createdById: adminId } });
    }
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (salesRepId || otherSalesRepId) {
      await prisma.salesRep.deleteMany({
        where: { id: { in: [salesRepId, otherSalesRepId].filter(Boolean) } },
      });
    }
    if (batchId) await prisma.autopartImportBatch.deleteMany({ where: { id: batchId } });
    await prisma.$disconnect();
  });

  it("converts eligible accounts once, keeps history internal, and invites only active customers", async () => {
    const foreign = await prisma.autopartAccount.count({
      where: {
        classification: "TRADE_CANDIDATE",
        companyId: null,
        NOT: { accountCode: { startsWith: stamp } },
      },
    });
    expect(foreign).toBe(0);

    await expect(previewAutopartProspectConversion(salesId)).rejects.toBeInstanceOf(AuthError);

    const invitesBefore = await prisma.userInvitation.count();
    const usersBefore = await prisma.user.count();
    const mailBefore = await prisma.transactionalEmail.count();
    const linesBefore = await prisma.autopartInvoiceLine.count({
      where: { accountCode: eligibleCode },
    });
    const amountBefore = await prisma.autopartInvoiceLine.aggregate({
      where: { accountCode: eligibleCode },
      _sum: { salesAmount: true },
    });

    const preview = await previewAutopartProspectConversion(adminId);
    expect(preview.status).toBe("PREVIEWED");
    expect(preview.dryRun).toBe(true);
    expect(preview.summary.eligible).toBeGreaterThanOrEqual(7);
    expect(preview.summary.excludedByClassification["INTERNAL"]).toBeGreaterThanOrEqual(1);
    expect(preview.summary.excludedByClassification["STAFF"]).toBeGreaterThanOrEqual(1);
    expect(preview.summary.excludedByClassification["CASH"]).toBeGreaterThanOrEqual(1);
    expect(preview.summary.excludedByClassification["DO_NOT_USE"]).toBeGreaterThanOrEqual(1);
    expect(preview.summary.excludedByClassification["OBSOLETE"]).toBeGreaterThanOrEqual(1);
    expect(preview.summary.nameDuplicateGroups).toBeGreaterThanOrEqual(1);
    expect(preview.summary.eligibleWithInvoiceLines).toBeGreaterThanOrEqual(1);
    expect(preview.summary.eligibleWithoutInvoiceLines).toBeGreaterThanOrEqual(1);
    expect(preview.summary.eligibleWithLedger).toBeGreaterThanOrEqual(1);
    expect(preview.summary.unmatchedInvoiceCodes).toBeGreaterThanOrEqual(1);
    expect(preview.summary.conflicts).toBeGreaterThanOrEqual(1);
    expect(preview.summary.estimatedBatches).toBeGreaterThanOrEqual(1);
    expect(preview.createdProspects).toBe(0);
    expect(await prisma.company.count({ where: { autopartCustomerCode: eligibleCode } })).toBe(0);

    await expect(
      beginAutopartProspectConversion(adminId, { runId: preview.id, confirmed: false }),
    ).rejects.toBeInstanceOf(AuthError);
    expect((await getAutopartProspectConversion(adminId, preview.id)).status).toBe("PREVIEWED");

    await beginAutopartProspectConversion(adminId, { runId: preview.id, confirmed: true });
    await executeAutopartProspectConversion(preview.id, { maxBatches: 1, batchSize: 1 });
    const interrupted = await getAutopartProspectConversion(adminId, preview.id);
    expect(interrupted.status).toBe("RUNNING");
    expect(interrupted.processed).toBe(1);
    await expect(resumeAutopartProspectConversion(adminId, preview.id)).rejects.toBeInstanceOf(
      AuthError,
    );
    await prisma.autopartProspectConversionRun.update({
      where: { id: preview.id },
      data: { heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await resumeAutopartProspectConversion(adminId, preview.id);
    const committed = await waitRun(preview.id);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.summary.reconciliation?.eligibleUnlinked).toBe(1);

    const eligibleCompany = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: eligibleCode },
    });
    expect(eligibleCompany.status).toBe("PROSPECT");
    expect(eligibleCompany.name).toBe(`Eligible ${stamp}`);
    expect(eligibleCompany.notes).toContain(eligibleCode);
    expect(eligibleCompany.notes).toContain("N1");
    expect(eligibleCompany.notes).toContain(repCode);
    const eligibleAccount = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: eligibleCode } },
    });
    expect(eligibleAccount.companyId).toBe(eligibleCompany.id);
    expect(eligibleAccount.portalEligible).toBe(false);
    expect(eligibleAccount.historicalAccessEnabled).toBe(false);
    expect(await prisma.companyUser.count({ where: { companyId: eligibleCompany.id } })).toBe(0);
    const assignment = await prisma.companyAssignment.findFirst({
      where: { companyId: eligibleCompany.id, isPrimary: true },
    });
    expect(assignment?.salesRepId).toBe(salesRepId);

    const linked = await prisma.company.findUniqueOrThrow({ where: { id: linkedCompanyId } });
    expect(linked.status).toBe("PENDING_APPROVAL");
    expect(await prisma.company.count({ where: { autopartCustomerCode: linkedCode } })).toBe(1);

    const reuse = await prisma.company.findUniqueOrThrow({ where: { id: reuseCompanyId } });
    expect(reuse.status).toBe("ACTIVE");
    expect(reuse.notes).toBe(keepNote);
    const reuseAssignment = await prisma.companyAssignment.findFirst({
      where: { companyId: reuseCompanyId, isPrimary: true },
    });
    expect(reuseAssignment?.salesRepId).toBe(otherSalesRepId);
    expect(
      (
        await prisma.autopartAccount.findUniqueOrThrow({
          where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: reuseCode } },
        })
      ).companyId,
    ).toBe(reuseCompanyId);

    const sameCompanies = await prisma.company.findMany({ where: { name: sameName } });
    expect(sameCompanies).toHaveLength(3);
    expect(
      sameCompanies
        .map((company) => company.autopartCustomerCode)
        .filter(Boolean)
        .sort(),
    ).toEqual([sameCodeA, sameCodeB].sort());
    expect(sameCompanies.filter((company) => company.autopartCustomerCode == null)).toHaveLength(1);
    const manual = await prisma.company.findUniqueOrThrow({ where: { id: manualSameCompanyId } });
    expect(manual.notes).toBe(`manual ${stamp}`);
    expect(manual.autopartCustomerCode).toBeNull();

    const conflict = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: conflictCode } },
    });
    expect(conflict.companyId).toBeNull();
    expect(await prisma.company.count({ where: { autopartCustomerCode: conflictCode } })).toBe(1);

    const excluded = await prisma.autopartAccount.findMany({
      where: { accountCode: { startsWith: stamp }, classification: { not: "TRADE_CANDIDATE" } },
    });
    expect(excluded.length).toBe(7);
    expect(excluded.every((account) => account.companyId == null)).toBe(true);

    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: eligibleCode } })).toBe(
      linesBefore,
    );
    const amountAfter = await prisma.autopartInvoiceLine.aggregate({
      where: { accountCode: eligibleCode },
      _sum: { salesAmount: true },
    });
    expect(amountAfter._sum.salesAmount?.toFixed(2)).toBe(
      amountBefore._sum.salesAmount?.toFixed(2),
    );
    expect(await prisma.userInvitation.count()).toBe(invitesBefore);
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.transactionalEmail.count()).toBe(mailBefore);

    const history = await getCompanyAutopartHistoryWorkspace(salesId, eligibleCompany.id);
    expect(history.globalHistory.netSalesExVat).toBe("9.00");
    expect(history.globalHistory.purchaseDate).toBeNull();
    expect(history.globalHistory.purchaseTrend).toBe("UNAVAILABLE");
    expect(history.globalHistory.lastPurchase).toBeNull();
    expect(history.globalHistory.frequentProducts[0]?.partNumber).toBe("P-FREQ");
    expect(history.globalHistory.frequentProducts[0]?.lineCount).toBe(2);
    expect(history.globalHistory.ledgerRowCount).toBeNull();
    expect(JSON.stringify(history.globalHistory)).not.toContain("runningBalance");
    expect(history.globalHistory.nativeOrdersIncluded).toBe(false);
    await expect(
      getCompanyAutopartHistoryWorkspace(otherSalesId, eligibleCompany.id),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(listAutopartLedger(salesId, { accountCode: eligibleCode })).rejects.toBeInstanceOf(
      AuthError,
    );
    const ledger = await listAutopartLedger(managementId, { accountCode: eligibleCode });
    expect(ledger.balanceNote).toContain("not the current amount due");
    const managementHistory = await getCompanyAutopartHistoryWorkspace(
      managementId,
      eligibleCompany.id,
    );
    expect(managementHistory.globalHistory.ledgerRowCount).toBe(1);
    expect(JSON.stringify(managementHistory.globalHistory)).not.toContain("runningBalance");

    const tradeId = await ensureUser(`prospect.trade.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: eligibleCompany.id,
        userId: tradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
      },
    });
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "true";
    const portal = await getPortalAutopartHistory(tradeId);
    expect(portal.enabled).toBe(true);
    expect(portal.total).toBe(0);
    process.env["AUTOPART_PORTAL_HISTORY_ENABLED"] = "false";
    await expect(
      inviteCompanyUser(adminId, {
        companyId: eligibleCompany.id,
        email: `buyer.${stamp}@example.invalid`,
        role: "TRADE_BUYER",
        expiresInDays: 7,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const mine = await listCompaniesForActor(salesId, {
      q: `Eligible ${stamp}`,
      page: 1,
      pageSize: 10,
    });
    expect(mine.items.map((item) => item.id)).toEqual([eligibleCompany.id]);
    const notMine = await listCompaniesForActor(otherSalesId, {
      q: `Eligible ${stamp}`,
      page: 1,
      pageSize: 10,
    });
    expect(notMine.items).toHaveLength(0);
    const withHistory = await listCompaniesForActor(adminId, {
      q: stamp,
      historicalSales: "with",
      autopartLink: "linked",
      page: 1,
      pageSize: 50,
    });
    expect(withHistory.items.map((item) => item.id)).toContain(eligibleCompany.id);
    const withoutHistory = await listCompaniesForActor(adminId, {
      q: sameName,
      historicalSales: "without",
      page: 1,
      pageSize: 20,
    });
    expect(withoutHistory.total).toBe(3);
    const unlinked = await listCompaniesForActor(adminId, {
      q: `Plain ${stamp}`,
      autopartLink: "unlinked",
      page: 1,
      pageSize: 10,
    });
    expect(unlinked.total).toBe(1);
    const closed = await listCompaniesForActor(adminId, {
      q: `Closed ${stamp}`,
      statusGroup: "CLOSED_OR_SUSPENDED",
      page: 1,
      pageSize: 10,
    });
    expect(closed.total).toBe(1);

    const repeat = await previewAutopartProspectConversion(adminId);
    await beginAutopartProspectConversion(adminId, { runId: repeat.id, confirmed: true });
    await executeAutopartProspectConversion(repeat.id);
    const repeated = await getAutopartProspectConversion(adminId, repeat.id);
    expect(repeated.status).toBe("COMMITTED");
    expect(repeated.createdProspects).toBe(0);
    expect(await prisma.company.count({ where: { autopartCustomerCode: eligibleCode } })).toBe(1);

    let csv = "";
    await writeProspectConversionExceptions(adminId, preview.id, (chunk) => {
      csv += chunk;
    });
    expect(csv).toContain("EXCLUDED_CLASSIFICATION");
    expect(csv).toContain("NAME_DUPLICATE");
    expect(csv).toContain("UNMATCHED_ACCOUNT_CODE");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toContain("runningBalance");

    const invite = await inviteCompanyUser(adminId, {
      companyId: reuseCompanyId,
      email: `portal.${stamp}@example.invalid`,
      role: "TRADE_BUYER",
      expiresInDays: 7,
    });
    expect(invite.status).toBe("PENDING");
    expect(invite).not.toHaveProperty("token");
    expect(invite).not.toHaveProperty("password");
    expect(JSON.stringify(invite)).not.toContain("password");
    const revoked = await revokeCompanyUserInvitation(adminId, { invitationId: invite.id });
    expect(revoked.status).toBe("REVOKED");
    const storedInvite = await prisma.userInvitation.findUniqueOrThrow({
      where: { id: invite.id },
    });
    const memberships = await prisma.companyUser.findMany({ where: { companyId: reuseCompanyId } });
    const membership = memberships.find((row) => row.userId === storedInvite.userId);
    expect(membership?.status, JSON.stringify({ storedInvite, memberships })).toBe("DISABLED");

    const hold = await prisma.company.create({
      data: { name: `Hold ${stamp}`, status: "ACTIVE" },
    });
    const holdUser = await ensureUser(`hold.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: { companyId: hold.id, userId: holdUser, role: "TRADE_BUYER", status: "ACTIVE" },
    });
    const pending = await prisma.userInvitation.create({
      data: {
        kind: "COMPANY_USER",
        companyId: hold.id,
        email: `pending.${stamp}@example.invalid`,
        role: "TRADE_BUYER",
        tokenHash: `${stamp}-hash`,
        expiresAt: new Date(Date.now() + 86_400_000),
        status: "PENDING",
      },
    });
    const suspended = await updateCompany(adminId, { id: hold.id, status: "SUSPENDED" });
    expect(suspended.status).toBe("SUSPENDED");
    expect(
      (
        await prisma.companyUser.findFirstOrThrow({
          where: { companyId: hold.id, userId: holdUser },
        })
      ).status,
    ).toBe("DISABLED");
    expect(
      (await prisma.userInvitation.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe("REVOKED");
    expect(await prisma.autopartInvoiceLine.count({ where: { accountCode: eligibleCode } })).toBe(
      linesBefore,
    );
    const reopened = await updateCompany(adminId, { id: hold.id, status: "ACTIVE" });
    expect(reopened.status).toBe("ACTIVE");
    expect(
      (
        await prisma.companyUser.findFirstOrThrow({
          where: { companyId: hold.id, userId: holdUser },
        })
      ).status,
    ).toBe("DISABLED");
  });
});

function line(partNumber: string, salesAmount: string, rawInvAndLn: string) {
  return {
    sourceIdentity: `${stamp}-${eligibleCode}-${rawInvAndLn}`,
    accountCode: eligibleCode,
    rawInvAndLn,
    documentReference: `INV${stamp}`,
    documentType: "INVOICE",
    partNumber,
    description: partNumber,
    quantity: "1.000",
    salesAmount,
    salesMeasure: "NET_EX_VAT",
    importBatchId: batchId,
    rawSource: {},
  };
}
