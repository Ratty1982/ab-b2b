/**
 * Portal dashboard — live company data, no prototype fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { getPortalDashboard } from "@/server/portal/dashboard";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let companyAId = "";
let companyBId = "";
let buyerAId = "";
let buyerBId = "";
let salesRepUserId = "";
let salesRepId = "";

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

beforeAll(async () => {
  await bootstrapRbac(prisma);

  const companyA = await prisma.company.create({
    data: {
      name: `Portal Dash A ${suffix}`,
      status: "ACTIVE",
      paymentTerms: "Pro Forma",
      creditLimit: 2500,
    },
  });
  companyAId = companyA.id;

  const companyB = await prisma.company.create({
    data: {
      name: `Portal Dash B ${suffix}`,
      status: "ACTIVE",
      paymentTerms: "30 Days Net",
    },
  });
  companyBId = companyB.id;

  buyerAId = await ensureUser(`portal.dash.a.${suffix}@example.invalid`, [], "TRADE");
  buyerBId = await ensureUser(`portal.dash.b.${suffix}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId: companyAId,
      userId: buyerAId,
      role: "TRADE_ADMIN",
      status: "ACTIVE",
      isDefault: true,
    },
  });
  await prisma.companyUser.create({
    data: {
      companyId: companyBId,
      userId: buyerBId,
      role: "TRADE_ADMIN",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  salesRepUserId = await ensureUser(
    `portal.dash.rep.${suffix}@example.invalid`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
  );
  await prisma.user.update({
    where: { id: salesRepUserId },
    data: { name: `Live Rep ${suffix}` },
  });
  const rep = await prisma.salesRep.create({
    data: { userId: salesRepUserId, code: `REP${suffix.slice(-4).toUpperCase()}`, active: true },
  });
  salesRepId = rep.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getPortalDashboard", () => {
  it("shows real company data with empty orders and no invented finance", async () => {
    const dash = await getPortalDashboard(buyerAId);
    expect(dash.company.name).toBe(`Portal Dash A ${suffix}`);
    expect(dash.company.status).toBe("ACTIVE");
    expect(dash.company.paymentTerms).toBe("Pro Forma");
    expect(dash.company.autopartCustomerCode).toBeNull();
    expect(dash.creditLimit).toBe(2500);
    expect(dash.availableCredit).toBeNull();
    expect(dash.outstandingBalance).toBeNull();
    expect(dash.openQuotesValue).toBeNull();
    expect(dash.openOrderCount).toBe(0);
    expect(dash.totalOrderCount).toBe(0);
    expect(dash.openOrders).toEqual([]);
    expect(dash.recentOrders).toEqual([]);
    expect(dash.basket.lineCount).toBe(0);
    expect(dash.accountManager).toBeNull();
    expect(dash.features.quotes).toBe(false);
    expect(dash.features.invoices).toBe(false);

    const serialized = JSON.stringify(dash);
    expect(serialized).not.toContain("ABC001");
    expect(serialized).not.toContain("James Whitfield");
    expect(serialized).not.toContain("AB-9840");
    expect(serialized).not.toContain("INV-88214");
    expect(serialized).not.toContain("15000");
    expect(serialized).not.toContain("ABC MOTOR");
  });

  it("omits unverified Autopart codes and shows verified ones", async () => {
    await prisma.company.update({
      where: { id: companyAId },
      data: {
        autopartCustomerCode: "CLAIMED999",
        autopartCustomerCodeVerifiedAt: null,
      },
    });
    let dash = await getPortalDashboard(buyerAId);
    expect(dash.company.autopartCustomerCode).toBeNull();
    expect(dash.company.autopartVerified).toBe(false);

    await prisma.company.update({
      where: { id: companyAId },
      data: { autopartCustomerCodeVerifiedAt: new Date() },
    });
    dash = await getPortalDashboard(buyerAId);
    expect(dash.company.autopartCustomerCode).toBe("CLAIMED999");
    expect(dash.company.autopartVerified).toBe(true);

    await prisma.company.update({
      where: { id: companyAId },
      data: {
        autopartCustomerCode: null,
        autopartCustomerCodeVerifiedAt: null,
      },
    });
  });

  it("surfaces assigned account manager and clears when unassigned", async () => {
    await prisma.companyAssignment.create({
      data: { companyId: companyAId, salesRepId, isPrimary: true },
    });
    let dash = await getPortalDashboard(buyerAId);
    expect(dash.accountManager?.name).toContain(`Live Rep ${suffix}`);
    expect(dash.accountManager?.email).toContain(`portal.dash.rep.${suffix}`);

    await prisma.companyAssignment.deleteMany({ where: { companyId: companyAId } });
    dash = await getPortalDashboard(buyerAId);
    expect(dash.accountManager).toBeNull();
  });

  it("never leaks another company's orders (IDOR)", async () => {
    await prisma.order.create({
      data: {
        companyId: companyBId,
        orderNumber: `AB-B-${suffix}`,
        status: "SUBMITTED",
        placedAt: new Date(),
        currency: "GBP",
        subtotal: 100,
        vatTotal: 20,
        deliveryTotal: 0,
        grandTotal: 120,
            orderedByUserId: buyerBId,
      },
    });

    const dashA = await getPortalDashboard(buyerAId);
    expect(dashA.totalOrderCount).toBe(0);
    expect(dashA.recentOrders).toHaveLength(0);

    const dashB = await getPortalDashboard(buyerBId);
    expect(dashB.company.id).toBe(companyBId);
    expect(dashB.totalOrderCount).toBe(1);
    expect(dashB.recentOrders[0]?.orderNumber).toBe(`AB-B-${suffix}`);
    expect(dashB.openOrderCount).toBe(1);
  });

  it("shows Not-set-friendly null payment terms without inventing 30 Days Net", async () => {
    await prisma.company.update({
      where: { id: companyAId },
      data: { paymentTerms: null },
    });
    const dash = await getPortalDashboard(buyerAId);
    expect(dash.company.paymentTerms).toBeNull();
  });
});

describe("portal production sources", () => {
  it("does not import mock fixtures from live portal routes", () => {
    const files = [
      "src/routes/portal.index.tsx",
      "src/routes/portal.support.tsx",
      "src/routes/portal.quotes.tsx",
      "src/routes/portal.invoices.tsx",
      "src/routes/portal.favourites.tsx",
      "src/routes/portal.users.tsx",
      "src/routes/portal.quick-order.tsx",
      "src/server/portal/dashboard.ts",
    ];
    const banned = [
      'from "@/lib/data"',
      "from '@/lib/data'",
      'from "@/lib/crm-data"',
      "from '@/lib/crm-data'",
      "James Whitfield",
      "ABC001",
      "AB-9840",
      "INV-88214",
      "ABC MOTOR FACTORS",
    ];
    for (const file of files) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      for (const needle of banned) {
        expect(text, `${file} must not contain ${needle}`).not.toContain(needle);
      }
    }
  });
});
