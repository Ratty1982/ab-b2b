/**
 * Integration tests against the development database.
 * Requires: migrated DB + `bun run db:seed`
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

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

beforeAll(async () => {
  const count = await prisma.user.count({
    where: { email: "trade.buyer@example.invalid" },
  });
  if (count === 0) {
    throw new Error("Seed data missing — run `bun run db:seed` before integration tests");
  }
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

  it("cannot edit credit", async () => {
    const id = await userIdByEmail("sales.rep@example.invalid");
    await expect(requireSystemPermission(id, "credit.edit")).rejects.toBeInstanceOf(AuthError);
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
  it("marketing cannot access invoices/credit permissions", async () => {
    const id = await userIdByEmail("marketing@example.invalid");
    const profile = await loadAccessProfile(id);
    expect(hasPermission(profile!, "invoices.view")).toBe(false);
    expect(hasPermission(profile!, "credit.edit")).toBe(false);
    expect(hasPermission(profile!, "cms.publish")).toBe(true);
  });

  it("accounts cannot publish CMS", async () => {
    const id = await userIdByEmail("accounts@example.invalid");
    const profile = await loadAccessProfile(id);
    expect(hasPermission(profile!, "cms.publish")).toBe(false);
    expect(hasPermission(profile!, "credit.edit")).toBe(true);
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
