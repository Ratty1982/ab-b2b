/**
 * Bulk Autopart mapping verification writes only the timestamp.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  applyAutopartAccountVerification,
  describeCompanyAutopartMapping,
  previewAutopartAccountVerification,
} from "@/server/companies/autopart-account-verification";
import {
  clearCompanyAutopartCustomerCode,
  setCompanyAutopartCustomerCode,
} from "@/server/companies/autopart-account";
import { listCompanyAutopartAccounts } from "@/server/companies/autopart-account-mapping";
import {
  confirmAutopartTrm21qcImport,
  resolveCompanyByAutopartCode,
} from "@/server/companies/autopart-ongoing-sales";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const eligibleCode = `00${suffix}`.toUpperCase();
const preservedCode = `KEEP${suffix}`.toUpperCase();
const duplicateCode = `DUP${suffix}A`.toUpperCase();
const invalidCode = "12.50";
const primaryCode = `PRI${suffix}`.toUpperCase();
const extraCode = `EX${suffix}`.toUpperCase();
const sharedCode = `SH${suffix}`.toUpperCase();
const verifiedConflictCode = `VC${suffix}`.toUpperCase();
const aliasConflictCode = `VA${suffix}`.toUpperCase();
const masterConflictCode = `VM${suffix}`.toUpperCase();
const pureAliasCode = `PA${suffix}`.toUpperCase();
const conflictInvoiceRef = `CINV${suffix}`.toUpperCase();
const conflictCreditRef = `CCR${suffix}`.toUpperCase();
const conflictUnassignedRef = `CNEW${suffix}`.toUpperCase();
const aliasImportRef = `ALN${suffix}`.toUpperCase();
const masterImportRef = `MSN${suffix}`.toUpperCase();
const pureAliasImportRef = `PAN${suffix}`.toUpperCase();
const conflictRefs = [
  conflictInvoiceRef,
  conflictCreditRef,
  conflictUnassignedRef,
  aliasImportRef,
  masterImportRef,
  pureAliasImportRef,
];
const preservedAt = new Date("2026-01-01T00:00:00.000Z");

let adminId = "";
let tradeId = "";
const companyIds: string[] = [];
let verifiedConflictId = "";
let aliasHolderConflictId = "";
let masterOwnerId = "";
let pureAliasId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE") {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType,
      emailVerified: true,
    },
  });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`verify.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"], "INTERNAL");
  tradeId = await ensureUser(`verify.trade.${suffix}@example.invalid`, [], "TRADE");

  const eligible = await prisma.company.create({
    data: {
      name: `Eligible ${suffix}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: eligibleCode,
    },
  });
  const preserved = await prisma.company.create({
    data: {
      name: `Preserved ${suffix}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: preservedCode,
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const duplicateA = await prisma.company.create({
    data: {
      name: `Duplicate A ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: duplicateCode,
    },
  });
  const duplicateB = await prisma.company.create({
    data: {
      name: `Duplicate B ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `dup${suffix}a`,
    },
  });
  const invalid = await prisma.company.create({
    data: {
      name: `Invalid ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: invalidCode,
    },
  });
  const primary = await prisma.company.create({
    data: {
      name: `Primary ${suffix}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: primaryCode,
    },
  });
  const aliasHolder = await prisma.company.create({
    data: {
      name: `Alias holder ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `OWN${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const shared = await prisma.company.create({
    data: {
      name: `Shared ${suffix}`,
      status: "PROSPECT",
      autopartCustomerCode: sharedCode,
    },
  });
  const verifiedConflict = await prisma.company.create({
    data: {
      name: `Verified conflict ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: verifiedConflictCode,
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const conflictingPrimary = await prisma.company.create({
    data: {
      name: `Conflicting primary ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: verifiedConflictCode.toLowerCase(),
    },
  });
  const aliasHolderConflict = await prisma.company.create({
    data: {
      name: `Alias conflict holder ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `VH${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const aliasClaimant = await prisma.company.create({
    data: {
      name: `Alias claimant ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: aliasConflictCode.toLowerCase(),
    },
  });
  const masterOwner = await prisma.company.create({
    data: {
      name: `Master owner ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: masterConflictCode,
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const masterClaimant = await prisma.company.create({
    data: {
      name: `Master claimant ${suffix}`,
      status: "ACTIVE",
    },
  });
  const pureAlias = await prisma.company.create({
    data: {
      name: `Pure alias ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `PAA${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const pureAliasOther = await prisma.company.create({
    data: {
      name: `Pure alias other ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `PAB${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: preservedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  verifiedConflictId = verifiedConflict.id;
  aliasHolderConflictId = aliasHolderConflict.id;
  masterOwnerId = masterOwner.id;
  pureAliasId = pureAlias.id;
  companyIds.push(
    eligible.id,
    preserved.id,
    duplicateA.id,
    duplicateB.id,
    invalid.id,
    primary.id,
    aliasHolder.id,
    shared.id,
    verifiedConflict.id,
    conflictingPrimary.id,
    aliasHolderConflict.id,
    aliasClaimant.id,
    masterOwner.id,
    masterClaimant.id,
    pureAlias.id,
    pureAliasOther.id,
  );

  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: aliasHolder.id, alias: sharedCode, verifiedById: adminId },
  });
  await prisma.autopartCustomerAccountAlias.create({
    data: {
      companyId: aliasHolderConflict.id,
      alias: aliasConflictCode,
      verifiedById: adminId,
      verifiedAt: preservedAt,
    },
  });
  await prisma.autopartCustomerAccountAlias.create({
    data: {
      companyId: pureAlias.id,
      alias: pureAliasCode,
      verifiedById: adminId,
      verifiedAt: preservedAt,
    },
  });
  await prisma.autopartCustomerAccountAlias.create({
    data: {
      companyId: pureAliasOther.id,
      alias: pureAliasCode,
      verifiedById: adminId,
      verifiedAt: preservedAt,
    },
  });
  await prisma.autopartAccount.create({
    data: {
      sourceSystem: "AUTOPART",
      accountCode: masterConflictCode,
      originalName: `Linked conflict ${suffix}`,
      classification: "TRADE_CANDIDATE",
      companyId: masterClaimant.id,
      portalEligible: false,
      historicalAccessEnabled: false,
    },
  });
  await prisma.autopartSalesDocument.createMany({
    data: [
      {
        companyId: verifiedConflict.id,
        autopartCustomerCode: verifiedConflictCode,
        documentType: "INVOICE",
        documentReference: conflictInvoiceRef,
        goodsNet: "10.00",
        source: "ONGOING_504",
        has504: true,
      },
      {
        companyId: verifiedConflict.id,
        autopartCustomerCode: verifiedConflictCode,
        documentType: "CREDIT",
        documentReference: conflictCreditRef,
        goodsNet: "-4.00",
        source: "ONGOING_504",
        has504: true,
      },
      {
        companyId: null,
        autopartCustomerCode: verifiedConflictCode,
        documentType: "INVOICE",
        documentReference: conflictUnassignedRef,
        goodsNet: "7.00",
        source: "ONGOING_504",
        has504: true,
      },
    ],
  });
  await prisma.autopartAccount.create({
    data: {
      sourceSystem: "AUTOPART",
      accountCode: extraCode,
      originalName: `Extra ${suffix}`,
      classification: "TRADE_CANDIDATE",
      companyId: primary.id,
      portalEligible: false,
      historicalAccessEnabled: false,
    },
  });
  await prisma.autopartSalesDocument.create({
    data: {
      companyId: preserved.id,
      autopartCustomerCode: eligibleCode,
      documentType: "INVOICE",
      documentReference: `DOC${suffix}`.toUpperCase(),
      goodsNet: "10.00",
      source: "ONGOING_504",
      has504: true,
    },
  });
});

afterAll(async () => {
  await prisma.autopartSalesLine.deleteMany({ where: { documentReference: { in: conflictRefs } } });
  await prisma.autopartSalesDocument.deleteMany({ where: { documentReference: { in: conflictRefs } } });
  await prisma.autopartImportDiagnostic.deleteMany({ where: { documentReference: { in: conflictRefs } } });
  await prisma.autopartAccount.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [adminId, tradeId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, tradeId] } } });
  await prisma.$disconnect();
});

describe("automatic Autopart account verification", () => {
  it("previews eligible mappings and records only their timestamps", async () => {
    await expect(previewAutopartAccountVerification(tradeId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      applyAutopartAccountVerification(adminId, { confirmation: "VERIFY" }),
    ).rejects.toBeInstanceOf(AuthError);

    const preview = await previewAutopartAccountVerification(adminId);
    expect(preview.eligible).toBeGreaterThanOrEqual(2);
    expect(preview.companiesWithAssignedIds).toBeGreaterThanOrEqual(8);
    expect(preview.alreadyVerified).toBeGreaterThanOrEqual(2);
    expect(preview.conflicts).toBeGreaterThanOrEqual(3);
    expect(preview.manualReview).toBeGreaterThanOrEqual(1);
    expect(preview.linked407exp).toBeGreaterThanOrEqual(1);
    expect(preview.samples.eligible.map((row) => row.code)).toContain(eligibleCode);
    expect(preview.samples.manualReview.map((row) => row.code)).toContain(invalidCode);

    const first = await applyAutopartAccountVerification(adminId, {
      confirmation: "VERIFY_UNAMBIGUOUS_AUTOPART_ACCOUNTS",
    });
    expect(first.attribution).toBe("automatic");
    expect(first.applied).toBeGreaterThanOrEqual(2);

    const stamped = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: eligibleCode },
    });
    expect(stamped.autopartCustomerCodeVerifiedAt).toBeTruthy();
    expect(stamped.autopartCustomerCodeVerifiedById).toBeNull();
    expect(stamped.status).toBe("ACTIVE");
    expect(stamped.paymentTerms).toBe("30 Days");

    const kept = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: preservedCode },
    });
    expect(kept.autopartCustomerCodeVerifiedAt?.toISOString()).toBe(preservedAt.toISOString());
    expect(kept.autopartCustomerCodeVerifiedById).toBe(adminId);

    const duplicates = await prisma.company.findMany({
      where: { autopartCustomerCode: { in: [duplicateCode, `dup${suffix}a`] } },
    });
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((row) => row.autopartCustomerCodeVerifiedAt == null)).toBe(true);

    const invalid = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: invalidCode },
    });
    expect(invalid.autopartCustomerCodeVerifiedAt).toBeNull();

    const primary = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: primaryCode },
    });
    expect(primary.autopartCustomerCode).toBe(primaryCode);
    expect(primary.autopartCustomerCodeVerifiedAt).toBeTruthy();
    expect(primary.autopartCustomerCodeVerifiedById).toBeNull();
    expect(primary.status).toBe("ACTIVE");

    const linked = await prisma.autopartAccount.findUniqueOrThrow({
      where: { sourceSystem_accountCode: { sourceSystem: "AUTOPART", accountCode: extraCode } },
    });
    expect(linked.companyId).toBe(primary.id);
    expect(linked.portalEligible).toBe(false);
    expect(linked.historicalAccessEnabled).toBe(false);

    const shared = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: sharedCode },
    });
    expect(shared.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(shared.status).toBe("PROSPECT");

    const document = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: `DOC${suffix}`.toUpperCase() },
    });
    expect(document.companyId).toBe(kept.id);

    const resolved = await resolveCompanyByAutopartCode(eligibleCode);
    expect(resolved.authority).toBe("verified-code");
    expect(resolved.companyId).toBe(stamped.id);
    const unresolvedDuplicate = await resolveCompanyByAutopartCode(duplicateCode);
    expect(unresolvedDuplicate.companyId).toBeNull();
    expect(unresolvedDuplicate.authority).toBe("ambiguous");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "company.autopart_account.bulk_verified", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ attribution: "automatic" });

    const again = await applyAutopartAccountVerification(adminId, {
      confirmation: "VERIFY_UNAMBIGUOUS_AUTOPART_ACCOUNTS",
    });
    expect(again.applied).toBe(0);
    const restamped = await prisma.company.findUniqueOrThrow({
      where: { autopartCustomerCode: eligibleCode },
    });
    expect(restamped.autopartCustomerCodeVerifiedAt?.toISOString()).toBe(
      stamped.autopartCustomerCodeVerifiedAt?.toISOString(),
    );
  });

  it("verifies a new unambiguous assignment and clears verification with the ID", async () => {
    const company = await prisma.company.create({
      data: { name: `Future ${suffix}`, status: "PROSPECT", paymentTerms: "7 Days" },
    });
    companyIds.push(company.id);
    const assigned = await setCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code: ` 0${suffix} `,
    });
    expect(assigned.code).toBe(`0${suffix}`);
    expect(assigned.verified).toBe(true);
    expect(assigned.verifiedBy).toBeNull();
    const row = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(row.status).toBe("PROSPECT");
    expect(row.paymentTerms).toBe("7 Days");

    await expect(
      setCompanyAutopartCustomerCode(adminId, { companyId: company.id, code: duplicateCode }),
    ).rejects.toMatchObject({ code: "AUTOPART_CODE_CONFLICT" });
    const unchanged = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(unchanged.autopartCustomerCode).toBe(`0${suffix}`);

    const cleared = await clearCompanyAutopartCustomerCode(adminId, { companyId: company.id });
    expect(cleared.code).toBeNull();
    expect(cleared.verified).toBe(false);
  });

  it("keeps a conflicting verified ID as Needs review and does not claim documents", async () => {
    const companies = [verifiedConflictId, aliasHolderConflictId, masterOwnerId, pureAliasId];
    const auditsBefore = await Promise.all(
      companies.map((companyId) =>
        prisma.auditEvent.count({ where: { OR: [{ companyId }, { entityId: companyId }] } }),
      ),
    );

    const primary = await describeCompanyAutopartMapping({
      companyId: verifiedConflictId,
      code: verifiedConflictCode,
      verifiedAt: preservedAt.toISOString(),
      verifiedByName: "Alex",
    });
    expect(primary.verified).toBe(false);
    expect(primary.verificationRecorded).toBe(true);
    expect(primary.attention).toMatch(/another company already has this Autopart ID/i);
    expect(primary.verifiedByLabel).toBe("Alex");

    const aliasList = await listCompanyAutopartAccounts(adminId, aliasHolderConflictId);
    const alias = aliasList.accounts.find((row) => row.kind === "ALIAS" && row.accountCode === aliasConflictCode);
    expect(alias?.verified).toBe(false);
    expect(alias?.attention).toMatch(/another company already has this Autopart ID/i);
    expect(alias?.verifiedAt).toBe(preservedAt.toISOString());

    const pureAliasList = await listCompanyAutopartAccounts(adminId, pureAliasId);
    const pureAliasRow = pureAliasList.accounts.find((row) => row.kind === "ALIAS" && row.accountCode === pureAliasCode);
    expect(pureAliasRow?.verified).toBe(false);
    expect(pureAliasRow?.attention).toMatch(/verified alias/i);
    expect(pureAliasRow?.verifiedAt).toBe(preservedAt.toISOString());

    const master = await describeCompanyAutopartMapping({
      companyId: masterOwnerId,
      code: masterConflictCode,
      verifiedAt: preservedAt.toISOString(),
      verifiedByName: "Alex",
    });
    expect(master.verified).toBe(false);
    expect(master.verificationRecorded).toBe(true);
    expect(master.attention).toMatch(/407EXP/i);
    const masterList = await listCompanyAutopartAccounts(adminId, masterOwnerId);
    const masterPrimary = masterList.accounts.find((row) => row.kind === "PRIMARY");
    expect(masterPrimary?.verified).toBe(false);
    expect(masterPrimary?.attention).toMatch(/407EXP/i);
    expect(masterPrimary?.verifiedAt).toBe(preservedAt.toISOString());

    for (const code of [verifiedConflictCode, aliasConflictCode, masterConflictCode, pureAliasCode]) {
      const resolved = await resolveCompanyByAutopartCode(code.toLowerCase());
      expect(resolved.companyId).toBeNull();
      expect(resolved.authority).toBe("ambiguous");
    }

    await applyAutopartAccountVerification(adminId, {
      confirmation: "VERIFY_UNAMBIGUOUS_AUTOPART_ACCOUNTS",
    });

    for (const companyId of companies) {
      const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      expect(row.autopartCustomerCodeVerifiedAt?.toISOString()).toBe(preservedAt.toISOString());
      expect(row.autopartCustomerCodeVerifiedById).toBe(adminId);
    }
    const aliasRow = await prisma.autopartCustomerAccountAlias.findFirstOrThrow({
      where: { companyId: aliasHolderConflictId, alias: aliasConflictCode },
    });
    expect(aliasRow.verifiedAt.toISOString()).toBe(preservedAt.toISOString());
    expect(aliasRow.verifiedById).toBe(adminId);
    const pureAliasStored = await prisma.autopartCustomerAccountAlias.findFirstOrThrow({
      where: { companyId: pureAliasId, alias: pureAliasCode },
    });
    expect(pureAliasStored.verifiedAt.toISOString()).toBe(preservedAt.toISOString());
    expect(pureAliasStored.verifiedById).toBe(adminId);

    const imported = await confirmAutopartTrm21qcImport(adminId, {
      text: [
        "Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%",
        `${verifiedConflictCode.toLowerCase()},GRP,${conflictInvoiceRef},14/10/2026,PAD,Pad,9,99.00,4.00,1.00,10.000`,
        `${verifiedConflictCode},GRP,${conflictCreditRef},14/10/2026,PAD,Pad,-2,-20.00,4.00,1.00,10.000`,
        `${aliasConflictCode},GRP,${aliasImportRef},14/10/2026,PAD,Pad,1,10.00,4.00,1.00,10.000`,
        `${masterConflictCode},GRP,${masterImportRef},14/10/2026,PAD,Pad,-1,-8.00,4.00,1.00,10.000`,
        `${pureAliasCode},GRP,${pureAliasImportRef},14/10/2026,PAD,Pad,1,12.00,4.00,1.00,10.000`,
        `${verifiedConflictCode},GRP,${conflictUnassignedRef},14/10/2026,PAD,Pad,3,15.00,4.00,1.00,10.000`,
      ].join("\n"),
      filename: `conflict-${suffix}.csv`,
      source: "MANUAL",
    });
    expect(imported.status).toBe("COMMITTED");

    const invoice = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: conflictInvoiceRef, documentType: "INVOICE" },
      include: { lines: true },
    });
    expect(invoice.companyId).toBe(verifiedConflictId);
    expect(invoice.goodsNet?.toString()).toBe("10");
    expect(invoice.lines).toHaveLength(0);
    const credit = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: conflictCreditRef, documentType: "CREDIT" },
    });
    expect(credit.companyId).toBe(verifiedConflictId);
    expect(credit.goodsNet?.toString()).toBe("-4");
    const unassigned = await prisma.autopartSalesDocument.findFirstOrThrow({
      where: { documentReference: conflictUnassignedRef },
      include: { lines: true },
    });
    expect(unassigned.companyId).toBeNull();
    expect(unassigned.goodsNet?.toString()).toBe("7");
    expect(unassigned.lines).toHaveLength(0);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: aliasImportRef } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: masterImportRef } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { documentReference: pureAliasImportRef } })).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({
        where: { documentReference: { in: conflictRefs } },
      }),
    ).toBe(0);

    const auditsAfter = await Promise.all(
      companies.map((companyId) =>
        prisma.auditEvent.count({ where: { OR: [{ companyId }, { entityId: companyId }] } }),
      ),
    );
    expect(auditsAfter).toEqual(auditsBefore);
  });
});
