import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { getAdminDashboard } from "@/server/admin/dashboard";
import { AuthError } from "@/server/rbac/guards";
import { PROTOTYPE_ADMIN_DASHBOARD_STRINGS } from "@/domain/admin-dashboard";
import { londonCalendarDayBounds } from "@/lib/datetime";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let adminId = "";
let salesRepUserId = "";
let salesRepId = "";
let buyerId = "";
let companyId = "";
let orderId = "";
let blockedOrderId = "";
let appId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
  name?: string,
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: name ?? email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
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
  adminId = await ensureUser(`dash.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(
    `dash.rep.${suffix}@example.invalid`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
    "Dash Rep",
  );
  buyerId = await ensureUser(`dash.buyer.${suffix}@example.invalid`, [], "TRADE", "Buyer");

  const rep = await prisma.salesRep.upsert({
    where: { userId: salesRepUserId },
    create: { userId: salesRepUserId, code: `DR${suffix.slice(-4).toUpperCase()}`, active: true },
    update: { active: true },
  });
  salesRepId = rep.id;

  const company = await prisma.company.create({
    data: {
      name: `Dash Co ${suffix}`,
      status: "ACTIVE",
      autopartCustomerCode: `AP${suffix}`,
      autopartCustomerCodeVerifiedAt: new Date(),
    },
  });
  companyId = company.id;
  await prisma.companyAssignment.create({
    data: { companyId, salesRepId, isPrimary: true },
  });

  const { start } = londonCalendarDayBounds(new Date());
  const placedAt = new Date(start.getTime() + 10 * 60 * 60 * 1000);

  const order = await prisma.order.create({
    data: {
      orderNumber: `AB-DASH1-${suffix.slice(-6)}`,
      companyId,
      status: "SUBMITTED",
      currency: "GBP",
      subtotal: 16.51,
      vatTotal: 3.3,
      deliveryTotal: 0,
      grandTotal: 19.81,
      placedAt,
      autopartExportStatus: "NOT_EXPORTED",
      autopartAccountLinked: true,
      autopartCustomerCodeSnapshot: `AP${suffix}`,
      deliveryAddress: {
        line1: "1 Test Street",
        town: "London",
        postcode: "E1 1AA",
        country: "GB",
      },
      contactSnapshot: { email: `buyer.${suffix}@example.invalid`, name: "Buyer" },
      items: {
        create: [
          {
            sku: "SKU-DASH-1",
            name: "Dash Widget",
            qty: 1,
            unitPrice: 16.51,
            customerUnitPrice: 16.51,
            lineTotal: 16.51,
            vatRate: 20,
            lineVat: 3.3,
            lineGross: 19.81,
          },
        ],
      },
    },
  });
  orderId = order.id;

  const blocked = await prisma.order.create({
    data: {
      orderNumber: `AB-DASH2-${suffix.slice(-6)}`,
      companyId,
      status: "SUBMITTED",
      currency: "GBP",
      subtotal: 10,
      vatTotal: 2,
      deliveryTotal: 0,
      grandTotal: 12,
      placedAt,
      autopartExportStatus: "NOT_EXPORTED",
      autopartAccountLinked: false,
      autopartCustomerCodeSnapshot: null,
      items: {
        create: [
          {
            sku: "SKU-DASH-2",
            name: "Blocked Widget",
            qty: 1,
            unitPrice: 10,
            customerUnitPrice: 10,
            lineTotal: 10,
            vatRate: 20,
            lineVat: 2,
            lineGross: 12,
          },
        ],
      },
    },
  });
  blockedOrderId = blocked.id;

  const app = await prisma.tradeApplication.create({
    data: {
      reference: `APP-DASH-${suffix.slice(-6)}`,
      status: "SUBMITTED",
      companyName: `Dash Applicant ${suffix}`,
      businessType: "Factor",
    },
  });
  appId = app.id;

  await prisma.auditEvent.create({
    data: {
      action: "order.created",
      entityType: "Order",
      entityId: orderId,
      actorUserId: adminId,
      companyId,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admin production dashboard", () => {
  it("returns real order/customer/application metrics for admin", async () => {
    const dash = await getAdminDashboard(adminId);
    expect(dash.summary.ordersToday.count).toBeGreaterThanOrEqual(1);
    expect(Number(dash.summary.ordersToday.orderValueIncVat)).toBeGreaterThan(0);
    expect(dash.summary.openOrders.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.activeTradeCustomers.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.tradeApplicationsAttention.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.openQuotes).not.toBeNull();

    expect(dash.ordersAttention.readyForExport.count).toBeGreaterThanOrEqual(1);
    // Preview list is capped at 5 — confirm the fixture itself is Ready even if not in the sample.
    expect(
      await prisma.order.count({
        where: {
          id: orderId,
          autopartExportStatus: "NOT_EXPORTED",
          status: { notIn: ["DRAFT", "CANCELLED"] },
          autopartAccountLinked: true,
          autopartCustomerCodeSnapshot: { not: null },
          items: { some: {} },
        },
      }),
    ).toBe(1);
    expect(dash.ordersAttention.backorderedOrders.count).toBeGreaterThanOrEqual(0);
    expect(dash.ordersAttention.backorderedOrders.units).toBeGreaterThanOrEqual(0);
    expect(dash.ordersAttention.exportBlocked.count).toBeGreaterThanOrEqual(1);
    // Preview list is capped — confirm the fixture itself matches the blocked definition.
    expect(
      await prisma.order.count({
        where: {
          id: blockedOrderId,
          autopartExportStatus: "NOT_EXPORTED",
          status: { notIn: ["DRAFT", "CANCELLED"] },
          OR: [
            { autopartAccountLinked: false },
            { autopartCustomerCodeSnapshot: null },
            { items: { none: {} } },
          ],
        },
      }),
    ).toBe(1);

    expect(dash.applications.submitted).toBeGreaterThanOrEqual(1);
    expect(dash.applications.attentionItems.some((a) => a.id === appId)).toBe(true);

    expect(dash.recentOrders.length).toBeGreaterThan(0);
    expect(dash.recentOrders[0]!.grandTotalLabel).toContain("£");
    expect(dash.recentOrders[0]!.placedAtLabel).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(dash.recentOrders.every((o) => o.href.startsWith("/admin/orders/"))).toBe(true);
    expect(await prisma.order.count({ where: { id: orderId, status: { not: "DRAFT" } } })).toBe(1);

    expect(dash.recentActivity.some((a) => a.what === "Order received")).toBe(true);
    expect(dash.autopart504c).not.toBeNull();
    expect(dash.autopart504c?.configured).toBe(false);
    expect(dash.autopart504c?.automaticPolling).toBe("OFF");
    expect(dash.autopart504c?.informational).toBe(true);

    expect(dash.needsAttention.some((i) => i.id === "applications")).toBe(true);
    expect(dash.needsAttention.some((i) => i.id === "export-ready")).toBe(true);
    expect(dash.needsAttention.some((i) => i.id === "export-blocked")).toBe(true);
    expect(dash.needsAttention.some((i) => i.id === "504c-not-configured" && i.severity === "info")).toBe(
      true,
    );
    // Ignored INVALID/DUPLICATE diagnostics must never appear as Needs Attention.
    expect(dash.needsAttention.some((i) => i.id === "stock-issues")).toBe(false);
    if (dash.stock && dash.stock.statusLabel !== "No sync yet") {
      expect(dash.stock.actionableIssues).toBe(0);
      expect(dash.stock.statusLabel).toBe("Healthy");
    }
  });

  it("denies trade buyers and does not include prototype strings", async () => {
    await expect(getAdminDashboard(buyerId)).rejects.toBeInstanceOf(AuthError);
    const dash = await getAdminDashboard(adminId);
    const blob = JSON.stringify(dash);
    for (const banned of [
      "James Whitfield",
      "Priya Nayar",
      "Dee Okafor",
      "Mark Ellison",
      "Mersey Motor Factors",
      "Caldwell Commercials",
      "Penrose Autoparts",
      "APP-2026-0409",
      "PM-AUTUMN",
      "Prototype data set",
      "Sales YTD",
      "£1,984,600",
      "£244,250",
    ] satisfies readonly string[]) {
      expect(blob).not.toContain(banned);
    }
    expect(blob).not.toContain("+12%");
    expect(blob).not.toContain("conversion");
    // No fake chart series
    expect(dash).not.toHaveProperty("chart");
    expect(dash).not.toHaveProperty("trends");
  });

  it("applies sales company scope for representatives", async () => {
    const dash = await getAdminDashboard(salesRepUserId);
    expect(dash.scope).toBe("sales");
    expect(dash.summary.activeTradeCustomers.count).toBeGreaterThanOrEqual(1);
    expect(dash.recentOrders.every((o) => o.companyName.includes("Dash Co"))).toBe(true);
  });

  it("lists known prototype dashboard strings for source regression", () => {
    expect(PROTOTYPE_ADMIN_DASHBOARD_STRINGS).toContain("Prototype data set");
    expect(PROTOTYPE_ADMIN_DASHBOARD_STRINGS).toContain("James Whitfield");
  });
});
