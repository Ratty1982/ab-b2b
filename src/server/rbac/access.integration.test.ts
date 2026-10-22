/**
 * Access checks for trade, sales, and admin roles.
 * Creates its own fixture in the dedicated test database. Does not use production
 * and does not require `bun run db:seed`.
 */
import "@/server/testing/use-protect-integration-database";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";

import { loadAccessProfile, hasPermission } from "@/server/rbac/access";
import {
  requireAdminAccess,
  requireCompanyAccess,
  requireCompanyPermission,
  requireTradePortalAccess,
  requireInternalSalesAccess,
  requireCrmAccess,
  requireSystemPermission,
  AuthError,
} from "@/server/rbac/guards";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import {
  startActingContext,
  requireActingForCompany,
  endActingContext,
} from "@/server/acting-context";

const prisma = new PrismaClient();

async function userIdByEmail(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return u.id;
}

async function companyIdByAccount(accountNumber: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { accountNumber } });
  return c.id;
}

async function ensureUser(
  email: string,
  name: string,
  actorType: "INTERNAL" | "TRADE",
  roles: string[],
) {
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      status: "ACTIVE",
      actorType,
      emailVerified: true,
    },
    update: { name, status: "ACTIVE", actorType },
  });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user;
}

async function ensureCompany(accountNumber: string, name: string) {
  return prisma.company.upsert({
    where: { accountNumber },
    create: { accountNumber, name, status: "ACTIVE" },
    update: { name, status: "ACTIVE" },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  const assigned = await ensureCompany("ABC001", "ABC Motor Factors Ltd");
  await ensureCompany("XYZ999", "Unassigned Factors Ltd");

  const tradeAdmin = await ensureUser("trade.admin@example.invalid", "Trade admin", "TRADE", []);
  const tradeBuyer = await ensureUser("trade.buyer@example.invalid", "Trade buyer", "TRADE", []);
  await ensureUser("marketing@example.invalid", "Marketing", "INTERNAL", ["MARKETING"]);
  await ensureUser("accounts@example.invalid", "Accounts", "INTERNAL", ["ACCOUNTS"]);
  await ensureUser("superadmin@example.invalid", "Super admin", "INTERNAL", ["SUPER_ADMIN"]);
  const salesManager = await ensureUser("sales.manager@example.invalid", "Sales manager", "INTERNAL", [
    "SALES_MANAGER",
  ]);
  const salesRep = await ensureUser("sales.rep@example.invalid", "Sales rep", "INTERNAL", [
    "SALES_REPRESENTATIVE",
  ]);

  for (const membership of [
    { userId: tradeAdmin.id, role: "TRADE_ADMIN" as const },
    { userId: tradeBuyer.id, role: "TRADE_BUYER" as const },
  ]) {
    await prisma.companyUser.upsert({
      where: { companyId_userId: { companyId: assigned.id, userId: membership.userId } },
      create: {
        companyId: assigned.id,
        userId: membership.userId,
        role: membership.role,
        status: "ACTIVE",
        isDefault: true,
      },
      update: { role: membership.role, status: "ACTIVE" },
    });
  }

  const managerRep = await prisma.salesRep.upsert({
    where: { userId: salesManager.id },
    create: { userId: salesManager.id, code: "RBAC-SM", region: "UK South", active: true },
    update: { active: true },
  });
  const rep = await prisma.salesRep.upsert({
    where: { userId: salesRep.id },
    create: {
      userId: salesRep.id,
      code: "RBAC-SR",
      region: "UK South",
      managerId: managerRep.id,
      active: true,
    },
    update: { managerId: managerRep.id, active: true },
  });
  const existingPrimary = await prisma.companyAssignment.findFirst({
    where: { companyId: assigned.id, isPrimary: true, salesRepId: { not: rep.id } },
    select: { id: true },
  });
  await prisma.companyAssignment.upsert({
    where: { companyId_salesRepId: { companyId: assigned.id, salesRepId: rep.id } },
    create: {
      companyId: assigned.id,
      salesRepId: rep.id,
      isPrimary: !existingPrimary,
    },
    update: {},
  });
});

describe("anonymous / missing user", () => {
  it("cannot access portal", async () => {
    await expect(requireTradePortalAccess(null)).rejects.toBeInstanceOf(AuthError);
  });
  it("cannot access sales", async () => {
    await expect(requireInternalSalesAccess(null)).rejects.toBeInstanceOf(AuthError);
  });
  it("cannot access CRM", async () => {
    await expect(requireCrmAccess(null)).rejects.toBeInstanceOf(AuthError);
  });
  it("cannot access admin", async () => {
    await expect(requireAdminAccess(null)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("trade buyer", () => {
  it("can access own portal profile", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    const profile = await requireTradePortalAccess(id);
    expect(profile.companyMemberships.length).toBeGreaterThan(0);
  });

  it("cannot access admin", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    await expect(requireAdminAccess(id)).rejects.toBeInstanceOf(AuthError);
  });

  it("cannot access another company", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    const other = await companyIdByAccount("XYZ999");
    await expect(requireCompanyAccess(id, other)).rejects.toBeInstanceOf(AuthError);
  });

  it("can access own company", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    const own = await companyIdByAccount("ABC001");
    await expect(requireCompanyAccess(id, own)).resolves.toBeTruthy();
  });

  it("cannot manage company users", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    const own = await companyIdByAccount("ABC001");
    await expect(
      requireCompanyPermission(id, own, "companies.manage_users"),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("trade account admin", () => {
  it("can manage company users on own company", async () => {
    const id = await userIdByEmail("trade.admin@example.invalid");
    const own = await companyIdByAccount("ABC001");
    await expect(requireCompanyPermission(id, own, "companies.manage_users")).resolves.toBeTruthy();
  });
});

describe("sales representative", () => {
  it("can access assigned customer", async () => {
    const id = await userIdByEmail("sales.rep@example.invalid");
    const assigned = await companyIdByAccount("ABC001");
    const profile = await loadAccessProfile(id);
    expect(profile).toBeTruthy();
    expect(await canAccessCompanyAsSales(profile!, assigned)).toBe(true);
    await expect(requireCompanyAccess(id, assigned)).resolves.toBeTruthy();
  });

  it("cannot access unassigned customer", async () => {
    const id = await userIdByEmail("sales.rep@example.invalid");
    const other = await companyIdByAccount("XYZ999");
    const profile = await loadAccessProfile(id);
    expect(await canAccessCompanyAsSales(profile!, other)).toBe(false);
    await expect(requireCompanyAccess(id, other)).rejects.toBeInstanceOf(AuthError);
  });

  it("cannot manage users", async () => {
    const id = await userIdByEmail("sales.rep@example.invalid");
    await expect(requireSystemPermission(id, "users.manage")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("sales manager", () => {
  it("has team access to rep-assigned company", async () => {
    const id = await userIdByEmail("sales.manager@example.invalid");
    const assigned = await companyIdByAccount("ABC001");
    const profile = await loadAccessProfile(id);
    expect(profile).toBeTruthy();
    expect(hasPermission(profile!, "sales.view_team_accounts")).toBe(true);
    expect(await canAccessCompanyAsSales(profile!, assigned)).toBe(true);
  });
});

describe("marketing / accounts", () => {
  it("marketing cannot access invoices permissions", async () => {
    const id = await userIdByEmail("marketing@example.invalid");
    const profile = await loadAccessProfile(id);
    expect(hasPermission(profile!, "invoices.view")).toBe(false);
    expect(hasPermission(profile!, "cms.publish")).toBe(true);
  });

  it("accounts cannot publish CMS but can view invoices", async () => {
    const id = await userIdByEmail("accounts@example.invalid");
    const profile = await loadAccessProfile(id);
    expect(hasPermission(profile!, "cms.publish")).toBe(false);
    expect(hasPermission(profile!, "invoices.view")).toBe(true);
  });
});

describe("super admin", () => {
  it("receives intended access", async () => {
    const id = await userIdByEmail("superadmin@example.invalid");
    await expect(requireAdminAccess(id)).resolves.toBeTruthy();
    await expect(requireSystemPermission(id, "roles.manage")).resolves.toBeTruthy();
    await expect(requireSystemPermission(id, "audit.view")).resolves.toBeTruthy();
  });
});

describe("acting context", () => {
  it("requires both permission and company access", async () => {
    const id = await userIdByEmail("sales.rep@example.invalid");
    const assigned = await companyIdByAccount("ABC001");
    const unassigned = await companyIdByAccount("XYZ999");
    const profile = await loadAccessProfile(id);
    expect(profile).toBeTruthy();

    await expect(
      startActingContext({ profile: profile!, onBehalfOfCompanyId: unassigned }),
    ).rejects.toBeInstanceOf(AuthError);

    const ctx = await startActingContext({
      profile: profile!,
      onBehalfOfCompanyId: assigned,
    });
    expect(ctx.onBehalfOfCompanyId).toBe(assigned);

    await expect(requireActingForCompany(profile!, assigned)).resolves.toBeTruthy();
    await endActingContext({ profile: profile! });
  });

  it("trade buyer cannot start acting context", async () => {
    const id = await userIdByEmail("trade.buyer@example.invalid");
    const own = await companyIdByAccount("ABC001");
    const profile = await loadAccessProfile(id);
    await expect(
      startActingContext({ profile: profile!, onBehalfOfCompanyId: own }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
