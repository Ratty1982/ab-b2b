/**
 * Alias verification reuses the shared Autopart identity rules.
 * A conflicting primary, alias, or linked 407EXP account is rejected.
 * Requires TEST_DATABASE_URL. Refuses the application database.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { verifyAutopartAccountAlias } from "@/server/companies/autopart-account-alias";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const ownCode = `OWN${suffix}`.toUpperCase();
const otherPrimary = `00PRI${suffix}`.toUpperCase();
const otherAlias = `AL${suffix}`.toUpperCase();
const linkedMaster = `MAS${suffix}`.toUpperCase();
const uniqueAlias = `UNQ${suffix}`.toUpperCase();
const ownMaster = `EX${suffix}`.toUpperCase();
const verifiedAt = new Date("2026-02-01T00:00:00.000Z");

let adminId = "";
let companyAId = "";
let companyBId = "";
let companyCId = "";
let companyDId = "";
const companyIds: string[] = [];

async function ensureAdmin(email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureAdmin(`alias.admin.${suffix}@example.invalid`);

  const companyA = await prisma.company.create({
    data: {
      name: `Alias holder ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: ownCode,
      autopartCustomerCodeVerifiedAt: verifiedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const companyB = await prisma.company.create({
    data: {
      name: `Other primary ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: otherPrimary,
      autopartCustomerCodeVerifiedAt: verifiedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const companyC = await prisma.company.create({
    data: {
      name: `Other alias ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `OC${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: verifiedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  const companyD = await prisma.company.create({
    data: {
      name: `Linked master ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `LD${suffix}`.toUpperCase(),
      autopartCustomerCodeVerifiedAt: verifiedAt,
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  companyAId = companyA.id;
  companyBId = companyB.id;
  companyCId = companyC.id;
  companyDId = companyD.id;
  companyIds.push(companyAId, companyBId, companyCId, companyDId);

  await prisma.autopartCustomerAccountAlias.create({
    data: {
      companyId: companyCId,
      alias: otherAlias.toLowerCase(),
      verifiedById: adminId,
    },
  });
  await prisma.autopartAccount.create({
    data: {
      sourceSystem: "AUTOPART",
      accountCode: linkedMaster.toLowerCase(),
      originalName: `Linked ${suffix}`,
      classification: "TRADE_CANDIDATE",
      companyId: companyDId,
    },
  });
  await prisma.autopartAccount.create({
    data: {
      sourceSystem: "AUTOPART",
      accountCode: ownMaster,
      originalName: `Own extra ${suffix}`,
      classification: "TRADE_CANDIDATE",
      companyId: companyAId,
    },
  });
});

afterAll(async () => {
  await prisma.autopartCustomerAccountAlias.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.autopartAccount.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.userRole.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
});

describe("Autopart alias verification conflicts", () => {
  it("rejects another company's primary, verified alias, and linked 407EXP account", async () => {
    await expect(
      verifyAutopartAccountAlias(adminId, { companyId: companyAId, alias: otherPrimary.toLowerCase() }),
    ).rejects.toMatchObject({ code: "AUTOPART_CODE_CONFLICT", status: 409 });
    await expect(
      verifyAutopartAccountAlias(adminId, { companyId: companyAId, alias: ` ${otherAlias.toLowerCase()} ` }),
    ).rejects.toMatchObject({ code: "AUTOPART_CODE_CONFLICT", status: 409 });
    await expect(
      verifyAutopartAccountAlias(adminId, { companyId: companyAId, alias: linkedMaster.toLowerCase() }),
    ).rejects.toMatchObject({ code: "AUTOPART_CODE_CONFLICT", status: 409 });
    await expect(
      verifyAutopartAccountAlias(adminId, { companyId: companyAId, alias: ownCode.toLowerCase() }),
    ).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
    await expect(
      verifyAutopartAccountAlias(adminId, { companyId: companyAId, alias: "12.50" }),
    ).rejects.toBeInstanceOf(AuthError);

    const aliases = await prisma.autopartCustomerAccountAlias.findMany({
      where: { companyId: companyAId },
    });
    expect(aliases).toEqual([]);

    const other = await prisma.company.findUniqueOrThrow({ where: { id: companyBId } });
    expect(other.autopartCustomerCode).toBe(otherPrimary);
    const foreignAlias = await prisma.autopartCustomerAccountAlias.findFirstOrThrow({
      where: { companyId: companyCId },
    });
    expect(foreignAlias.alias).toBe(otherAlias.toLowerCase());
    const master = await prisma.autopartAccount.findFirstOrThrow({
      where: { accountCode: linkedMaster.toLowerCase() },
    });
    expect(master.companyId).toBe(companyDId);
  });

  it("verifies a unique alias once and does not move the company's own 407EXP link", async () => {
    const created = await verifyAutopartAccountAlias(adminId, {
      companyId: companyAId,
      alias: uniqueAlias.toLowerCase(),
    });
    expect(created.alias).toBe(uniqueAlias);
    const again = await verifyAutopartAccountAlias(adminId, {
      companyId: companyAId,
      alias: ` ${uniqueAlias.toLowerCase()} `,
    });
    expect(again.id).toBe(created.id);

    const ownLink = await verifyAutopartAccountAlias(adminId, {
      companyId: companyAId,
      alias: ownMaster.toLowerCase(),
    });
    expect(ownLink.alias).toBe(ownMaster);

    const rows = await prisma.autopartCustomerAccountAlias.findMany({
      where: { companyId: companyAId },
      orderBy: { alias: "asc" },
    });
    expect(rows.map((row) => row.alias)).toEqual([ownMaster, uniqueAlias].sort());
    const account = await prisma.autopartAccount.findFirstOrThrow({ where: { accountCode: ownMaster } });
    expect(account.companyId).toBe(companyAId);
    const holder = await prisma.company.findUniqueOrThrow({ where: { id: companyAId } });
    expect(holder.autopartCustomerCode).toBe(ownCode);
  });
});
