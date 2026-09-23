import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError, requireAdminAccess, requireTradePortalAccess } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const suffix = `hdr-${Date.now()}`;
let tradeId = "";
let adminId = "";
let companyId = "";

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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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

describe("public header route protection", () => {
  beforeAll(async () => {
    await bootstrapRbac(prisma);
    const company = await prisma.company.create({
      data: {
        name: `Header Co ${suffix}`,
        accountNumber: `HDR-${suffix.slice(-6)}`,
        status: "ACTIVE",
      },
    });
    companyId = company.id;
    tradeId = await ensureUser(`trade.header.${suffix}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId,
        userId: tradeId,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });
    adminId = await ensureUser(`admin.header.${suffix}@example.invalid`, ["SUPER_ADMIN"], "INTERNAL");
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.companyUser.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const ids = [tradeId, adminId].filter(Boolean);
    if (ids.length) {
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it("normal trade customer is denied /admin (requireAdminAccess)", async () => {
    await expect(requireAdminAccess(tradeId)).rejects.toBeInstanceOf(AuthError);
    try {
      await requireAdminAccess(tradeId);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("ADMIN_FORBIDDEN");
      expect((error as AuthError).status).toBe(403);
    }
  });

  it("admin is allowed /admin (requireAdminAccess)", async () => {
    const profile = await requireAdminAccess(adminId);
    expect(profile.userId).toBe(adminId);
    expect(profile.actorType).toBe("INTERNAL");
  });

  it("normal trade customer is allowed /portal for their company", async () => {
    const profile = await requireTradePortalAccess(tradeId);
    expect(profile.userId).toBe(tradeId);
    expect(profile.actorType).toBe("TRADE");
    expect(profile.companyMemberships.some((m) => m.companyId === companyId)).toBe(true);
  });

  it("internal admin cannot enter trade portal as a customer", async () => {
    await expect(requireTradePortalAccess(adminId)).rejects.toBeInstanceOf(AuthError);
    try {
      await requireTradePortalAccess(adminId);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("PORTAL_FORBIDDEN");
      expect((error as AuthError).status).toBe(403);
    }
  });
});
