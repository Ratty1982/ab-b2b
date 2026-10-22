import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { listCompaniesForActor } from "@/server/companies/service";

const prisma = new PrismaClient();

let adminId: string;
let salesUserId: string;
let salesRepId: string;

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
  adminId = await ensureUser("directory.admin@example.invalid", ["SUPER_ADMIN"]);
  salesUserId = await ensureUser("directory.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
  const rep = await prisma.salesRep.upsert({
    where: { userId: salesUserId },
    create: { userId: salesUserId, code: `DIR${salesUserId.slice(-6).toUpperCase()}`, active: true },
    update: { active: true },
  });
  salesRepId = rep.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admin customer directory search", () => {
  it("defaults to active, searches active and prospect, and matches account fields", async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const email = `buyer.${stamp}@directory.example.invalid`;
    const vat = `GB${stamp.slice(0, 9).toUpperCase()}`;
    const alias = `ALIAS${stamp.slice(0, 8).toUpperCase()}`;
    const code = `AP${stamp.slice(0, 8).toUpperCase()}`;
    const active = await prisma.company.create({
      data: {
        name: `Dir ${stamp} A Active`,
        tradingName: `Trade ${stamp}`,
        accountNumber: `AC${stamp}`,
        status: "ACTIVE",
        vatNumber: vat,
        primaryEmail: `office.${stamp}@directory.example.invalid`,
        autopartCustomerCode: code,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    await prisma.contact.create({
      data: {
        companyId: active.id,
        firstName: "Buyer",
        lastName: stamp,
        email,
      },
    });
    await prisma.autopartCustomerAccountAlias.create({
      data: { companyId: active.id, alias, verifiedById: adminId },
    });
    const prospect = await prisma.company.create({
      data: { name: `Dir ${stamp} B Prospect`, status: "PROSPECT" },
    });
    const closed = await prisma.company.create({
      data: { name: `Dir ${stamp} C Closed`, status: "CLOSED" },
    });
    const secondActive = await prisma.company.create({
      data: { name: `Dir ${stamp} D Active`, status: "ACTIVE" },
    });
    const assigned = await prisma.company.create({
      data: { name: `Dir ${stamp} E Assigned`, status: "ACTIVE" },
    });
    await prisma.companyAssignment.create({
      data: { companyId: assigned.id, salesRepId, isPrimary: true },
    });

    const directory = { statusScope: "DIRECTORY_DEFAULT" as const };
    const idle = await listCompaniesForActor(adminId, { ...directory, q: stamp, page: 1, pageSize: 20 });
    expect(idle.statusScope.mode).toBe("ACTIVE_AND_PROSPECT");
    expect(idle.items.map((item) => item.id)).toEqual([active.id, prospect.id, secondActive.id, assigned.id]);
    expect(idle.items.map((item) => item.id)).not.toContain(closed.id);

    const activeOnly = await listCompaniesForActor(adminId, {
      ...directory,
      page: 1,
      pageSize: 50,
      q: undefined,
    });
    const activeIds = new Set(
      (
        await prisma.company.findMany({
          where: { name: { contains: stamp }, status: "ACTIVE" },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    expect(activeOnly.statusScope.mode).toBe("ACTIVE");
    expect(activeOnly.items.filter((item) => item.name.includes(stamp)).map((item) => item.id).sort()).toEqual(
      [...activeIds].sort(),
    );

    const page = await listCompaniesForActor(adminId, { ...directory, q: stamp, page: 2, pageSize: 1 });
    expect(page.total).toBe(4);
    expect(page.items.map((item) => item.id)).toEqual([prospect.id]);

    for (const q of [`Trade ${stamp}`, `AC${stamp}`, code, alias, email, vat]) {
      const found = await listCompaniesForActor(adminId, { ...directory, q, page: 1, pageSize: 10 });
      expect(found.items.map((item) => item.id), q).toEqual([active.id]);
    }

    const explicit = await listCompaniesForActor(adminId, {
      ...directory,
      q: stamp,
      status: "CLOSED",
      page: 1,
      pageSize: 10,
    });
    expect(explicit.statusScope.mode).toBe("STATUS");
    expect(explicit.items.map((item) => item.id)).toEqual([closed.id]);

    const mine = await listCompaniesForActor(salesUserId, { ...directory, q: stamp, page: 1, pageSize: 20 });
    expect(mine.items.map((item) => item.id)).toEqual([assigned.id]);
  });
});
