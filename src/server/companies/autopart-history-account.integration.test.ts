import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { parseAutopart407p100 } from "@/domain/autopart-407p100";
import {
  previewAutopartHistoryImport,
  resolveHistoricReportAccountMatch,
  verifyAutopartAccountAlias,
} from "@/server/companies/autopart-history";
import { normaliseAccountToken } from "@/domain/autopart-report-money";

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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("hist-acct.admin@example.invalid", ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("historic report account truncation resolution", () => {
  it("MATCHED_TRUNCATED when report width 7 matches verified prefix", async () => {
    const stamp = Date.now();
    const verified = `TR${String(stamp).slice(-5)}O`; // 8 chars
    const report = verified.slice(0, 7);
    const company = await prisma.company.create({
      data: {
        name: `Trunc ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verified,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const match = await resolveHistoricReportAccountMatch({
      companyId: company.id,
      verifiedCode: verified,
      acceptedAccounts: new Set([verified]),
      detectedAccounts: [report],
      accountFieldWidth: 7,
    });
    expect(match.status).toBe("MATCHED_TRUNCATED");
    expect(match.ok).toBe(true);
    expect(match.sourceAccount).toBe(report);
  });

  it("AMBIGUOUS when two verified accounts truncate to same report form", async () => {
    const stamp = Date.now();
    const base = `AB${String(stamp).slice(-5)}`; // 7 chars
    const verifiedA = `${base}O`; // 8
    const verifiedB = `${base}X`; // 8 — same 7-char prefix
    const companyA = await prisma.company.create({
      data: {
        name: `Amb A ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verifiedA,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    await prisma.company.create({
      data: {
        name: `Amb B ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verifiedB,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const match = await resolveHistoricReportAccountMatch({
      companyId: companyA.id,
      verifiedCode: verifiedA,
      acceptedAccounts: new Set([verifiedA]),
      detectedAccounts: [base],
      accountFieldWidth: 7,
    });
    expect(match.status).toBe("AMBIGUOUS_TRUNCATED");
    expect(match.ok).toBe(false);
  });

  it("blocks unrelated verified account", async () => {
    const stamp = Date.now();
    const verified = `ZZ${String(stamp).slice(-6)}`;
    const company = await prisma.company.create({
      data: {
        name: `Unrel ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verified,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const match = await resolveHistoricReportAccountMatch({
      companyId: company.id,
      verifiedCode: verified,
      acceptedAccounts: new Set([verified]),
      detectedAccounts: ["YORKMOT"],
      accountFieldWidth: 7,
    });
    expect(match.ok).toBe(false);
    expect(match.status).toBe("ALIAS_REQUIRED");
  });

  it("407P100 does not truncated-match YORKMOT to YORKMOTO", () => {
    const text = `Customer,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
YORKMOT,3494.75,0,0,0,0,0,3494.75,5000.00
`;
    const parsed = parseAutopart407p100(text);
    expect(parsed.detectedAccounts).toEqual(["YORKMOT"]);
    const accepted = new Set(["YORKMOTO"]);
    expect(parsed.detectedAccounts.every((d) => accepted.has(d))).toBe(false);
  });

  it("MATCHED_REPORT_CUSTOMER when Start Customer equals verified (no alias)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const fixtureDir = resolve(import.meta.dirname, "../../domain/fixtures");
    const stamp = Date.now();
    // Unique 8-char verified code; 7-char row form preserves native .Acct. width.
    const verified = `RC${String(stamp).slice(-6)}`; // 8 chars
    const rowAcct = verified.slice(0, 7);
    expect(verified).toHaveLength(8);
    expect(rowAcct).toHaveLength(7);
    const file561 = readFileSync(resolve(fixtureDir, "autopart-561l-native.txt"), "utf8")
      .replaceAll("YORKMOTO", verified)
      .replaceAll("YORKMOT", rowAcct);
    const fileSlrb = readFileSync(resolve(fixtureDir, "autopart-slrb-native.txt"), "utf8")
      .replaceAll("YORKMOTO", verified)
      .replaceAll("YORKMOT", rowAcct);
    const company = await prisma.company.create({
      data: {
        name: `RptCust ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verified,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
      filename561l: "561L.txt",
      filenameSlrb: "SLRB.txt",
    });
    expect(preview.accountMatch.status).toBe("MATCHED_REPORT_CUSTOMER");
    expect(preview.accountMatch.reportCustomer).toBe(verified);
    expect(preview.accountMatch.rowAccount).toBe(rowAcct);
    expect(preview.canCommit).toBe(true);
    expect(preview.matching.matchedDocuments).toBeGreaterThanOrEqual(7);
    expect(preview.issues.some((i) => i.code === "ACCOUNT_ALIAS_REQUIRED")).toBe(false);
  });

  it("preview allows import with truncated match; alias path still works", async () => {
    const stamp = Date.now();
    const verified = `HP${String(stamp).slice(-5)}O`;
    const reportAcct = verified.slice(0, 7);
    expect(reportAcct).not.toBe(verified);

    const company = await prisma.company.create({
      data: {
        name: `HistPrev ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: verified,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });

    const file561 = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${reportAcct},I/SS306008/1,SS,Steel Seal,24,"622.80"
${reportAcct},C/SS100900/1,SS,Credit,2,"-51.90"
${reportAcct},I/SS306009/1,OLD-SKU-GONE,Gone,6,"30.00"
`;
    const fileSlrb = `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${reportAcct},INV,SS306008,06 Oct 14,683.28,136.66,819.94,819.94
${reportAcct},CRN,SS100900,10 Oct 14,-51.90,-10.38,-62.28,793.66
${reportAcct},INV,SS306009,08 Oct 14,30.00,6.00,36.00,855.94
${reportAcct},INV,SS999999,15 Oct 14,10.00,2.00,12.00,405.66
`;

    const preview = await previewAutopartHistoryImport(adminId, {
      companyId: company.id,
      file561l: file561,
      fileSlrb: fileSlrb,
      filename561l: "561L.txt",
      filenameSlrb: "SLRB.txt",
    });
    expect(preview.accountMatch.status).toBe("MATCHED_TRUNCATED");
    expect(preview.canCommit).toBe(true);
    expect(preview.detectedAccounts).toEqual([normaliseAccountToken(reportAcct)]);
    expect(preview.issues.some((i) => i.code === "SKU_NOT_IN_CATALOGUE")).toBe(true);

    const company2 = await prisma.company.create({
      data: {
        name: `AliasNeed ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: `YX${String(stamp).slice(-6)}`,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const aliasCode = `OA${String(stamp).slice(-6)}`;
    const mismatchPreview = await previewAutopartHistoryImport(adminId, {
      companyId: company2.id,
      file561l: `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${aliasCode},I/SS1/1,SS,Item,1,"10.00"
`,
      fileSlrb: `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${aliasCode},INV,SS1,06 Oct 14,10.00,2.00,12.00,12.00
`,
    });
    expect(mismatchPreview.accountMatch.status).toBe("ALIAS_REQUIRED");
    expect(mismatchPreview.canCommit).toBe(false);

    await verifyAutopartAccountAlias(adminId, {
      companyId: company2.id,
      alias: aliasCode,
      note: "test",
    });
    const afterAlias = await previewAutopartHistoryImport(adminId, {
      companyId: company2.id,
      file561l: `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${aliasCode},I/SS1/1,SS,Item,1,"10.00"
`,
      fileSlrb: `A/C,Type,Ref,Date,Tot Goods,Tot VAT,Total,Run Bal
${aliasCode},INV,SS1,06 Oct 14,10.00,2.00,12.00,12.00
`,
    });
    expect(afterAlias.accountMatch.status).toBe("MATCHED_ALIAS");
    expect(afterAlias.canCommit).toBe(true);
  });
});
