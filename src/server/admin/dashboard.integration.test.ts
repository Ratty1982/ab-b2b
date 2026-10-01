import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { getAdminDashboard } from "@/server/admin/dashboard";
import { AuthError } from "@/server/rbac/guards";
import { PROTOTYPE_ADMIN_DASHBOARD_STRINGS } from "@/domain/admin-dashboard";
import { londonCalendarDayBounds } from "@/lib/datetime";
import { updateEmailSettings } from "@/server/email/settings";
import { listTransactionalEmails } from "@/server/email/transactional";

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
    expect(dash.summary.ordersToday.orderValueLabel).toContain("£");
    expect(dash.summary.openOrders.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.activeTradeCustomers.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.tradeApplicationsAttention.count).toBeGreaterThanOrEqual(1);
    expect(dash.summary.openQuotes).not.toBeNull();
    expect(dash.summary.openQuotes?.expiringSoon).toBeGreaterThanOrEqual(0);

    expect(dash.greeting.greeting).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(dash.greeting.dateLabel.length).toBeGreaterThan(10);
    expect(dash.quickActions.some((a) => a.id === "view-orders")).toBe(true);
    expect(dash.quickActions.some((a) => a.id === "trade-applications")).toBe(true);
    expect(dash.quickActions.every((a) => a.href.startsWith("/"))).toBe(true);

    expect(dash.systemHealth.some((r) => r.id === "autopart-504c")).toBe(true);
    expect(dash.systemHealth.some((r) => r.id === "sales-feed")).toBe(true);
    expect(dash.systemHealth.every((r) => r.statusLabel.length > 0 && r.href.length > 0)).toBe(true);
    // Must not invent Healthy for unconfigured 504C
    const feed504 = dash.systemHealth.find((r) => r.id === "autopart-504c");
    expect(feed504?.tone).not.toBe("healthy");

    expect(dash.ordersAttention.readyForExport.count).toBeGreaterThanOrEqual(1);
    expect(dash.ordersAttention.readyForExport.href).toContain("autopartExport=READY");
    expect(dash.ordersAttention.exportBlocked.href).toContain("autopartExport=BLOCKED");
    expect(dash.ordersAttention.backorderedOrders.href).toContain("backorders=CONTAINS");
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

    expect(dash.needsAttention.some((i) => i.id === "applications" && i.actionLabel === "REVIEW")).toBe(
      true,
    );
    expect(dash.needsAttention.some((i) => i.id === "export-ready" && i.actionLabel === "VIEW")).toBe(
      true,
    );
    expect(
      dash.needsAttention.some(
        (i) => i.id === "export-blocked" && i.severity === "critical" && i.actionLabel === "FIX",
      ),
    ).toBe(true);
    expect(dash.needsAttention.some((i) => i.id === "504c-not-configured" && i.severity === "info")).toBe(
      true,
    );
    expect(dash.recentActivity.every((a) => a.whenTimeLabel.length >= 4)).toBe(true);
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
    // Sales reps without companies.create / quotes.create should not see those quick actions
    expect(dash.quickActions.some((a) => a.id === "new-customer")).toBe(false);
    // View orders / products / applications depend on role catalogue — orders.view is typical
    expect(dash.quickActions.every((a) => ["new-customer", "new-quote", "view-orders", "products", "trade-applications"].includes(a.id))).toBe(true);
  });

  it("lists known prototype dashboard strings for source regression", () => {
    expect(PROTOTYPE_ADMIN_DASHBOARD_STRINGS).toContain("Prototype data set");
    expect(PROTOTYPE_ADMIN_DASHBOARD_STRINGS).toContain("James Whitfield");
  });
});

describe("admin dashboard email health excludes EMAIL_TEST diagnostics", () => {
  const marker = `dash-email-health-${suffix}`;

  async function ensureSmtpReady() {
    await updateEmailSettings(adminId, {
      enabled: true,
      smtpHost: "smtp.dashboard-health.example",
      smtpPort: 465,
      smtpSecurity: "SSL_TLS",
      smtpUsername: "health@example.invalid",
      smtpPassword: "dashboard-health-secret",
      replacePassword: true,
      fromName: "Automotive Brands",
      fromEmail: "trade@example.invalid",
    });
  }

  async function insertMail(input: {
    purpose: "EMAIL_TEST" | "PASSWORD_RESET" | "ORDER_RECEIVED";
    status: "FAILED" | "SENT";
    key: string;
  }) {
    return prisma.transactionalEmail.create({
      data: {
        purpose: input.purpose,
        status: input.status,
        toEmail: `recipient.${marker}@example.invalid`,
        subject: `${input.purpose} ${input.status}`,
        textBody: "body",
        entityType: "Diagnostic",
        entityId: input.key,
        idempotencyKey: `${marker}:${input.key}`,
        attemptCount: 1,
        lastError: input.status === "FAILED" ? "smtp rejected" : null,
        sentAt: input.status === "SENT" ? new Date() : null,
      },
    });
  }

  async function cleanupMarkedMails() {
    await prisma.transactionalEmail.deleteMany({
      where: { idempotencyKey: { startsWith: `${marker}:` } },
    });
  }

  beforeAll(async () => {
    await ensureSmtpReady();
  });

  afterAll(async () => {
    await cleanupMarkedMails();
  });

  it("FAILED EMAIL_TEST alone does not increase operational failures or Needs Attention", async () => {
    await cleanupMarkedMails();
    // Isolate from other suites' FAILED operational rows in the shared DB.
    await prisma.transactionalEmail.deleteMany({
      where: {
        status: "FAILED",
        purpose: { not: "EMAIL_TEST" },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const before = await getAdminDashboard(adminId);
    expect(before.email?.recentFailures).toBe(0);

    await insertMail({ purpose: "EMAIL_TEST", status: "FAILED", key: "test-fail-only" });

    const dash = await getAdminDashboard(adminId);
    expect(dash.email).not.toBeNull();
    expect(dash.email?.configured).toBe(true);
    expect(dash.email?.enabled).toBe(true);
    expect(dash.email?.recentFailures).toBe(0);
    const emailHealth = dash.systemHealth.find((r) => r.id === "email");
    expect(emailHealth?.statusLabel).toBe("Healthy");
    expect(emailHealth?.tone).toBe("healthy");
    expect(dash.needsAttention.some((i) => i.id === "email-failures")).toBe(false);

    // Diagnostic history remains visible in Settings → Recent Emails
    const history = await listTransactionalEmails(adminId, {
      purpose: "EMAIL_TEST",
      status: "FAILED",
      limit: 50,
    });
    expect(
      history.some(
        (r) => r.purpose === "EMAIL_TEST" && r.status === "FAILED" && r.entityId === "test-fail-only",
      ),
    ).toBe(true);
  });

  it("SENT EMAIL_TEST leaves email Healthy", async () => {
    await cleanupMarkedMails();
    await prisma.transactionalEmail.deleteMany({
      where: {
        status: "FAILED",
        purpose: { not: "EMAIL_TEST" },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    await insertMail({ purpose: "EMAIL_TEST", status: "SENT", key: "test-sent" });
    const dash = await getAdminDashboard(adminId);
    expect(dash.email?.recentFailures).toBe(0);
    expect(dash.systemHealth.find((r) => r.id === "email")?.statusLabel).toBe("Healthy");
    expect(dash.needsAttention.some((i) => i.id === "email-failures")).toBe(false);
  });

  it("FAILED PASSWORD_RESET marks Failures and Needs Attention", async () => {
    await cleanupMarkedMails();
    const before = (await getAdminDashboard(adminId)).email?.recentFailures ?? 0;
    await insertMail({ purpose: "PASSWORD_RESET", status: "FAILED", key: "reset-fail" });
    const dash = await getAdminDashboard(adminId);
    expect(dash.email?.recentFailures).toBe(before + 1);
    expect(dash.systemHealth.find((r) => r.id === "email")?.statusLabel).toBe("Failures");
    expect(dash.needsAttention.some((i) => i.id === "email-failures" && (i.count ?? 0) >= 1)).toBe(
      true,
    );
  });

  it("FAILED ORDER_RECEIVED marks Failures", async () => {
    await cleanupMarkedMails();
    const before = (await getAdminDashboard(adminId)).email?.recentFailures ?? 0;
    await insertMail({ purpose: "ORDER_RECEIVED", status: "FAILED", key: "order-fail" });
    const dash = await getAdminDashboard(adminId);
    expect(dash.email?.recentFailures).toBe(before + 1);
    expect(dash.systemHealth.find((r) => r.id === "email")?.statusLabel).toBe("Failures");
  });

  it("historical FAILED EMAIL_TEST plus successful genuine mail stays Healthy", async () => {
    await cleanupMarkedMails();
    await prisma.transactionalEmail.deleteMany({
      where: {
        status: "FAILED",
        purpose: { not: "EMAIL_TEST" },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    await insertMail({ purpose: "EMAIL_TEST", status: "FAILED", key: "old-test-fail" });
    await insertMail({ purpose: "PASSWORD_RESET", status: "SENT", key: "reset-ok" });
    await insertMail({ purpose: "ORDER_RECEIVED", status: "SENT", key: "order-ok" });

    const dash = await getAdminDashboard(adminId);
    expect(dash.email?.recentFailures).toBe(0);
    expect(dash.systemHealth.find((r) => r.id === "email")?.statusLabel).toBe("Healthy");
    expect(dash.needsAttention.some((i) => i.id === "email-failures")).toBe(false);

    const history = await listTransactionalEmails(adminId, { limit: 50 });
    expect(
      history.some(
        (r) => r.purpose === "EMAIL_TEST" && r.status === "FAILED" && r.entityId === "old-test-fail",
      ),
    ).toBe(true);
    expect(
      history.some(
        (r) => r.purpose === "PASSWORD_RESET" && r.status === "SENT" && r.entityId === "reset-ok",
      ),
    ).toBe(true);
  });
});
