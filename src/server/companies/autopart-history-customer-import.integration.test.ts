/**
 * Customer-by-customer historical import: isolation, credits, repeated lines,
 * duplicate uploads, wrong account, aliases, undated rows, and stored files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  confirmAutopartHistoryImport,
  getCompanyAutopartHistoryWorkspace,
  previewAutopartHistoryImport,
  verifyAutopartAccountAlias,
} from "@/server/companies/autopart-history";

const prisma = new PrismaClient();
let adminId = "";
let outsiderId = "";

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

function files(account: string, other?: string) {
  const lines = [
    `${account},I/SS100/1,BOLT,Bolt,2,"10.00"`,
    `${account},I/SS100/1,WASHER,Washer,4,"8.00"`,
    `${account},C/SS200/1,BOLT,Bolt credit,1,"-3.00"`,
    `${account},I/SS300/1,BOLT,No date,1,"5.00"`,
  ];
  const docs = [
    `${account},INV,SS100,06 Oct 14,18.00,3.60,21.60,21.60`,
    `${account},CRN,SS200,07 Oct 14,-3.00,-0.60,-3.60,18.00`,
  ];
  if (other) {
    lines.push(`${other},I/SS900/1,OTHER,Other,1,"99.00"`);
    docs.push(`${other},INV,SS900,08 Oct 14,99.00,19.80,118.80,118.80`);
  }
  return {
    file561l: `Acct.,Inv & Ln,Part Number,Description,Units,Sales\n${lines.join("\n")}\n`,
    fileSlrb: `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal\n${docs.join("\n")}\n`,
  };
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("hist-rebuild.admin@example.invalid", ["SUPER_ADMIN"]);
  outsiderId = await ensureUser("hist-rebuild.none@example.invalid", []);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer historical sales import", () => {
  it("imports invoices and credits once, keeps repeated lines, and stores the files", async () => {
    const stamp = Date.now();
    const account = `RB${String(stamp).slice(-6)}`;
    const company = await prisma.company.create({
      data: {
        name: `Rebuild ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: account,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const reports = files(account);
    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...reports,
      filename561l: "lines.csv",
      filenameSlrb: "invoices.csv",
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.matching.linesWithoutDates).toBe(1);

    const first = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...reports,
      filename561l: "lines.csv",
      filenameSlrb: "invoices.csv",
    });
    expect(first.imported).toBeGreaterThan(0);
    const lineCount = await prisma.autopartSalesLine.count({ where: { companyId: company.id } });
    expect(lineCount).toBe(4);
    const credit = await prisma.autopartSalesLine.findFirst({
      where: { companyId: company.id, documentReference: "SS200" },
    });
    expect(Number(credit?.salesNet)).toBeCloseTo(-3, 2);
    const undated = await prisma.autopartSalesDocument.findFirst({
      where: { companyId: company.id, documentReference: "SS300" },
    });
    expect(undated?.documentDate).toBeNull();

    const second = await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...reports,
      filename561l: "lines.csv",
      filenameSlrb: "invoices.csv",
    });
    expect(second.updated).toBeGreaterThan(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company.id } })).toBe(lineCount);

    const stored = await prisma.autopartCustomerImportRun.findFirst({
      where: { companyId: company.id, status: "COMMITTED", dryRun: false },
      orderBy: { completedAt: "desc" },
    });
    expect(stored?.filename).toBe("lines.csv");
    expect(Buffer.from(stored?.fileBody561l ?? []).toString("utf8")).toBe(reports.file561l);
    expect(Buffer.from(stored?.fileBodySlrb ?? []).toString("utf8")).toBe(reports.fileSlrb);

    const workspace = await getCompanyAutopartHistoryWorkspace(adminId, company.id);
    expect(workspace.historyStatus.label).toContain("saved");
    expect(workspace.historyStatus.undatedDocuments).toBe(1);
    expect(workspace.showAdvanced).toBe(true);
    expect(workspace.importHistory[0]?.productReportCheck).toBeTruthy();

    await expect(
      previewAutopartHistoryImport(outsiderId, { companyId: company.id, ...reports }),
    ).rejects.toThrow(/permission|forbidden/i);
  });

  it("keeps hundreds of repeated lines on one invoice and does not duplicate them", async () => {
    const stamp = Date.now();
    const account = `FB${String(stamp).slice(-6)}`;
    const company = await prisma.company.create({
      data: {
        name: `FBA ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: account,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const body = Array.from({ length: 200 }, (_, index) => {
      const sku = index % 2 === 0 ? "BOLT" : "WASHER";
      return `${account},I/FBA1/1,${sku},Line ${index},1,"1.00"`;
    }).join("\n");
    const reports = {
      file561l: `Acct.,Inv & Ln,Part Number,Description,Units,Sales\n${body}\n`,
      fileSlrb: `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal\n${account},INV,FBA1,01 Oct 14,200.00,40.00,240.00,240.00\n`,
    };
    await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...reports,
      filename561l: "fba.csv",
      filenameSlrb: "fba-dates.csv",
    });
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: company.id, documentReference: "FBA1" },
      }),
    ).toBe(200);
    await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...reports,
      filename561l: "fba.csv",
      filenameSlrb: "fba-dates.csv",
    });
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: company.id, documentReference: "FBA1" },
      }),
    ).toBe(200);
  });

  it("imports only the selected account from a mixed file and blocks the wrong account", async () => {
    const stamp = Date.now();
    const account = `MX${String(stamp).slice(-6)}`;
    const other = `OT${String(stamp).slice(-6)}`;
    const alias = `${account}B`;
    const company = await prisma.company.create({
      data: {
        name: `Mixed ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: account,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const wrong = files(other);
    const blocked = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...wrong,
    });
    expect(blocked.canCommit).toBe(false);

    const mixed = files(account, other);
    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...mixed,
      filename561l: "mixed.csv",
      filenameSlrb: "mixed-dates.csv",
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.customerSlice.mode).toBe("isolated");
    expect(preview.customerSlice.excludedAccounts).toContain(other);
    expect(preview.issues.some((issue) => issue.code === "OTHER_CUSTOMERS_LEFT_OUT")).toBe(true);

    await confirmAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...mixed,
      filename561l: "mixed.csv",
      filenameSlrb: "mixed-dates.csv",
    });
    const refs = await prisma.autopartSalesDocument.findMany({
      where: { companyId: company.id },
      select: { documentReference: true },
    });
    expect(refs.map((row) => row.documentReference).sort()).toEqual(["SS100", "SS200", "SS300"]);

    await verifyAutopartAccountAlias(adminId, {
      companyId: company.id,
      alias,
      note: "Second branch",
    });
    const aliasReports = files(alias);
    const aliasPreview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      ...aliasReports,
    });
    expect(aliasPreview.canCommit).toBe(true);
  });
});
