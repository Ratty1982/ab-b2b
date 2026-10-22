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
  previewAutopartAccountVerification,
} from "@/server/companies/autopart-account-verification";
import {
  clearCompanyAutopartCustomerCode,
  setCompanyAutopartCustomerCode,
} from "@/server/companies/autopart-account";
import { resolveCompanyByAutopartCode } from "@/server/companies/autopart-ongoing-sales";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const eligibleCode = `00${suffix}`.toUpperCase();
const preservedCode = `KEEP${suffix}`.toUpperCase();
const duplicateCode = `DUP${suffix}A`.toUpperCase();
const invalidCode = "12.50";
const primaryCode = `PRI${suffix}`.toUpperCase();
const extraCode = `EX${suffix}`.toUpperCase();
const sharedCode = `SH${suffix}`.toUpperCase();
const preservedAt = new Date("2026-01-01T00:00:00.000Z");

let adminId = "";
let tradeId = "";
const companyIds: string[] = [];

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
  companyIds.push(
    eligible.id,
    preserved.id,
    duplicateA.id,
    duplicateB.id,
    invalid.id,
    primary.id,
    aliasHolder.id,
    shared.id,
  );

  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId: aliasHolder.id, alias: sharedCode, verifiedById: adminId },
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
    expect(unresolvedDuplicate.authority).toBe("stored-code");

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
});
