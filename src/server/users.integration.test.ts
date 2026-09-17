import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { createStaffUser, listStaffUsers, resetStaffUserPassword, updateStaffUser } from "@/server/users/service";

const prisma = new PrismaClient();
let adminId = "";
let salesRepUserId = "";

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
  adminId = await ensureUser("staff.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser("staff.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("staff users", () => {
  it("denies list without users.manage", async () => {
    await expect(listStaffUsers(salesRepUserId)).rejects.toBeInstanceOf(AuthError);
  });

  it("creates an internal user with a generated password and lists them", async () => {
    const stamp = Date.now();
    const email = `staff.created.${stamp}@example.invalid`;
    const created = await createStaffUser(adminId, {
      name: "Workshop Tester",
      email,
      role: "MARKETING",
    });
    expect(created.user.email).toBe(email);
    expect(created.user.role).toBe("MARKETING");
    expect(created.user.status).toBe("ACTIVE");
    expect(created.temporaryPassword).toMatch(/^Ab-/);

    const listed = await listStaffUsers(adminId);
    expect(listed.items.some((u) => u.email === email)).toBe(true);
    expect(listed.canGrantSuperAdmin).toBe(true);

    const account = await prisma.authAccount.findFirst({
      where: { userId: created.user.id, providerId: "credential" },
    });
    expect(account?.password).toBeTruthy();
  });

  it("rejects a duplicate email and a sales rep creating users", async () => {
    const email = `staff.dup.${Date.now()}@example.invalid`;
    await createStaffUser(adminId, {
      name: "Dup",
      email,
      role: "ACCOUNTS",
      password: "long-enough-password",
    });
    await expect(
      createStaffUser(adminId, { name: "Dup 2", email, role: "ACCOUNTS" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      createStaffUser(salesRepUserId, {
        name: "Nope",
        email: `staff.nope.${Date.now()}@example.invalid`,
        role: "ACCOUNTS",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("updates role/status, creates a sales-rep record, and refuses self-disable", async () => {
    const created = await createStaffUser(adminId, {
      name: "To Manage",
      email: `staff.manage.${Date.now()}@example.invalid`,
      role: "CUSTOMER_SERVICE",
      password: "long-enough-password",
    });
    expect(created.temporaryPassword).toBeNull();

    const updated = await updateStaffUser(adminId, {
      id: created.user.id,
      name: "To Manage Updated",
      role: "SALES_REPRESENTATIVE",
      status: "ACTIVE",
    });
    expect(updated.name).toBe("To Manage Updated");
    expect(updated.role).toBe("SALES_REPRESENTATIVE");
    const rep = await prisma.salesRep.findUnique({ where: { userId: created.user.id } });
    expect(rep?.active).toBe(true);

    await expect(
      updateStaffUser(adminId, { id: adminId, status: "DISABLED" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("resets a staff password, creates a credential account if missing, and signs them out", async () => {
    const created = await createStaffUser(adminId, {
      name: "Reset Me",
      email: `staff.reset.${Date.now()}@example.invalid`,
      role: "MARKETING",
      password: "long-enough-password",
    });
    const before = await prisma.authAccount.findFirst({
      where: { userId: created.user.id, providerId: "credential" },
    });
    expect(before?.password).toBeTruthy();

    await prisma.authSession.create({
      data: {
        userId: created.user.id,
        token: `tok-${created.user.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const generated = await resetStaffUserPassword(adminId, { id: created.user.id });
    expect(generated.email).toBe(created.user.email);
    expect(generated.temporaryPassword).toMatch(/^Ab-/);

    const afterGenerated = await prisma.authAccount.findFirst({
      where: { userId: created.user.id, providerId: "credential" },
    });
    expect(afterGenerated?.password).toBeTruthy();
    expect(afterGenerated?.password).not.toBe(before?.password);
    expect(
      await prisma.authSession.count({ where: { userId: created.user.id } }),
    ).toBe(0);

    const custom = await resetStaffUserPassword(adminId, {
      id: created.user.id,
      password: "another-long-password",
    });
    expect(custom.temporaryPassword).toBe("another-long-password");

    await prisma.authAccount.deleteMany({
      where: { userId: created.user.id, providerId: "credential" },
    });
    const recreated = await resetStaffUserPassword(adminId, { id: created.user.id });
    expect(recreated.temporaryPassword).toMatch(/^Ab-/);
    expect(
      await prisma.authAccount.findFirst({
        where: { userId: created.user.id, providerId: "credential" },
      }),
    ).toBeTruthy();

    await expect(resetStaffUserPassword(salesRepUserId, { id: created.user.id })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
