import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany, getCompanyWorkspace, updateCompany } from "@/server/companies/service";

const prisma = new PrismaClient();
let adminId = "";

async function ensureAdmin() {
  const email = `credit-limit-admin-${Date.now()}@example.invalid`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Credit Limit Admin",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

describe("company credit limit (informational)", () => {
  beforeAll(async () => {
    adminId = await ensureAdmin();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores nullable Decimal limits, audits changes, and never invents a default", async () => {
    const stamp = Date.now();
    const created = await createCompany(adminId, {
      name: `Credit Co ${stamp}`,
      status: "PROSPECT",
    });
    expect(created.creditLimit).toBeNull();
    expect(created.creditLimitDisplay).toBeNull();

    const withZero = await updateCompany(adminId, {
      id: created.id,
      creditLimit: "0",
    });
    expect(withZero.creditLimit).toBe("0.00");
    expect(withZero.creditLimitDisplay).toBe("£0.00");

    const withLarge = await updateCompany(adminId, {
      id: created.id,
      creditLimit: "£12,500.50",
    });
    expect(withLarge.creditLimit).toBe("12500.50");
    expect(withLarge.creditLimitDisplay).toBe("£12,500.50");

    await expect(
      updateCompany(adminId, { id: created.id, creditLimit: "-10" }),
    ).rejects.toThrow(/non-negative|Credit limit/i);

    const cleared = await updateCompany(adminId, {
      id: created.id,
      creditLimit: "",
    });
    expect(cleared.creditLimit).toBeNull();
    expect(cleared.creditLimitDisplay).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "company.credit_limit_changed", entityId: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();

    const workspace = await getCompanyWorkspace(adminId, created.id);
    expect(workspace.company.creditLimit).toBeNull();
  });
});
