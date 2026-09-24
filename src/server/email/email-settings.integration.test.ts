/**
 * Integration: Admin Email Settings + SMTP transport (mocked) + transactional wiring.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  clearEmailDiagnosticRateLimitsForTests,
  getEmailSettingsForActor,
  getOrCreateEmailSettings,
  sendTestEmail,
  setSmtpTransportFactoryForTests,
  testSmtpConnection,
  updateEmailSettings,
} from "@/server/email/settings";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import {
  listTransactionalEmails,
  retryTransactionalEmail,
  sendOrderEmailsAfterCommit,
  sendTradeApplicationEmailsAfterSubmit,
} from "@/server/email/transactional";
import { submitTradeApplication } from "@/server/applications/service";
import { decryptSecret } from "@/server/crypto/secret";

const prisma = new PrismaClient();
let adminId = "";
let salesId = "";
let tradeId = "";

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
  adminId = await ensureUser("email.settings.admin@example.invalid", ["SUPER_ADMIN"]);
  salesId = await ensureUser("email.settings.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser("email.settings.trade@example.invalid", [], "TRADE");
});

beforeEach(async () => {
  clearEmailDiagnosticRateLimitsForTests();
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  await prisma.emailSettings.deleteMany({});
  await getOrCreateEmailSettings();
});

afterEach(() => {
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  clearEmailDiagnosticRateLimitsForTests();
});

afterAll(async () => {
  await prisma.emailSettings.updateMany({ data: { enabled: false } });
  await prisma.$disconnect();
});

describe("email settings admin access", () => {
  it("allows settings.view for admin and denies trade users", async () => {
    const dto = await getEmailSettingsForActor(adminId);
    expect(dto.smtpPasswordConfigured).toBe(false);
    expect(dto).not.toHaveProperty("smtpPassword");
    expect(dto).not.toHaveProperty("smtpPasswordEncrypted");

    await expect(getEmailSettingsForActor(tradeId)).rejects.toBeInstanceOf(AuthError);
  });

  it("denies sales users without settings permissions", async () => {
    await expect(getEmailSettingsForActor(salesId)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("email settings CRUD + password", () => {
  it("creates SMTP settings, encrypts password, never returns it", async () => {
    const saved = await updateEmailSettings(adminId, {
      enabled: true,
      smtpHost: "smtp.siteground.example",
      smtpPort: 465,
      smtpSecurity: "SSL_TLS",
      smtpUsername: "trade@powermaxed.example",
      smtpPassword: "super-secret-password",
      replacePassword: true,
      fromName: "Automotive Brands Trade",
      fromEmail: "trade@powermaxed.example",
      replyToEmail: "orders@powermaxed.example",
      tradeApplicationRecipients: ["apps@example.invalid"],
      orderNotificationRecipients: ["orders@example.invalid", "ops@example.invalid"],
    });

    expect(saved.smtpPasswordConfigured).toBe(true);
    expect(saved.status.smtpConfigured).toBe(true);
    expect(saved.status.senderConfigured).toBe(true);
    expect(saved.tradeApplicationRecipients).toEqual(["apps@example.invalid"]);
    expect(saved.orderNotificationRecipients).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toContain("super-secret-password");

    const row = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.smtpPasswordEncrypted).toBeTruthy();
    expect(row.smtpPasswordEncrypted).not.toContain("super-secret-password");
    expect(decryptSecret(row.smtpPasswordEncrypted)).toBe("super-secret-password");
  });

  it("preserves password when omitted on update", async () => {
    await updateEmailSettings(adminId, {
      smtpHost: "smtp.example.com",
      smtpUsername: "u@example.com",
      smtpPassword: "keep-me",
      replacePassword: true,
      fromEmail: "from@example.com",
    });
    const before = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });

    const updated = await updateEmailSettings(adminId, {
      smtpHost: "smtp.example.com",
      fromName: "Updated Name",
    });
    expect(updated.fromName).toBe("Updated Name");
    expect(updated.smtpPasswordConfigured).toBe(true);

    const after = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(after.smtpPasswordEncrypted).toBe(before.smtpPasswordEncrypted);
  });

  it("replaces password when requested", async () => {
    await updateEmailSettings(adminId, {
      smtpHost: "smtp.example.com",
      smtpUsername: "u@example.com",
      smtpPassword: "old-password",
      replacePassword: true,
      fromEmail: "from@example.com",
    });
    await updateEmailSettings(adminId, {
      smtpPassword: "new-password",
      replacePassword: true,
    });
    const row = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(decryptSecret(row.smtpPasswordEncrypted)).toBe("new-password");
    expect(row.lastConnectionTestOk).toBeNull();
  });

  it("rejects invalid port and invalid emails", async () => {
    await expect(
      updateEmailSettings(adminId, { smtpPort: 99999 }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      updateEmailSettings(adminId, { fromEmail: "not-valid" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("supports enable/disable delivery", async () => {
    const on = await updateEmailSettings(adminId, { enabled: true });
    expect(on.enabled).toBe(true);
    expect(on.status.deliveryEnabled).toBe(true);
    const off = await updateEmailSettings(adminId, { enabled: false });
    expect(off.enabled).toBe(false);
  });
});

describe("SMTP diagnostics (mocked)", () => {
  async function configureSmtp() {
    await updateEmailSettings(adminId, {
      enabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "SSL_TLS",
      smtpUsername: "u@example.com",
      smtpPassword: "pw",
      replacePassword: true,
      fromEmail: "from@example.com",
      fromName: "AB Trade",
    });
  }

  it("test connection success", async () => {
    await configureSmtp();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({ verifyResult: { ok: true } }),
    );
    const result = await testSmtpConnection(adminId);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("CONNECTION SUCCESSFUL");
  });

  it("test connection auth failure (sanitised)", async () => {
    await configureSmtp();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({
        verifyResult: { ok: false, error: "Authentication failed" },
      }),
    );
    const result = await testSmtpConnection(adminId);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Authentication failed");
    expect(result.message).not.toMatch(/password|pw/i);
  });

  it("test connection timeout", async () => {
    await configureSmtp();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({
        verifyResult: { ok: false, error: "Connection timed out" },
      }),
    );
    const result = await testSmtpConnection(adminId);
    expect(result.message).toBe("Connection timed out");
  });

  it("send test email success and failure", async () => {
    await configureSmtp();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({ sendResult: { ok: true, id: "msg-1" } }),
    );
    const sent = await sendTestEmail(adminId, { toEmail: "you@example.invalid", toName: "You" });
    expect(sent.ok).toBe(true);
    expect(sent.message).toBe("SENT");

    clearEmailDiagnosticRateLimitsForTests();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({
        sendResult: { ok: false, detail: "Authentication failed" },
      }),
    );
    const failed = await sendTestEmail(adminId, { toEmail: "you@example.invalid" });
    expect(failed.ok).toBe(false);
    expect(failed.message).toBe("Authentication failed");
  });
});

describe("email history + retry", () => {
  it("lists recent emails and retries failed without side effects", async () => {
    await updateEmailSettings(adminId, {
      enabled: true,
      smtpHost: "smtp.example.com",
      smtpUsername: "u@example.com",
      smtpPassword: "pw",
      replacePassword: true,
      fromEmail: "from@example.com",
      orderNotificationRecipients: ["ops@example.invalid"],
    });

    const mock = createMockSmtpTransport({
      sendResult: { ok: false, detail: "Connection timed out" },
    });
    setEmailTransportForTests(mock);
    setSmtpTransportFactoryForTests(() => mock);

    const company = await prisma.company.create({
      data: { name: "Email Test Co", status: "ACTIVE" },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-EMAIL-${Date.now()}`,
        companyId: company.id,
        status: "SUBMITTED",
        currency: "GBP",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        contactSnapshot: { name: "Buyer", email: "buyer@example.invalid", phone: null },
        deliveryAddress: {
          line1: "1 High St",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        paymentTermsSnapshot: "Net 30",
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        sku: "SKU-1",
        name: "Widget",
        qty: 1,
        unitPrice: 10,
        customerUnitPrice: 10,
        vatRate: 20,
        lineTotal: 10,
        lineVat: 2,
        lineGross: 12,
      },
    });

    await sendOrderEmailsAfterCommit(order.id);

    const history = await listTransactionalEmails(adminId, { limit: 20 });
    expect(history.length).toBeGreaterThan(0);
    const customer = history.find((e) => e.purpose === "ORDER_RECEIVED");
    expect(customer?.status).toBe("FAILED");
    expect(customer?.reference).toBe(order.orderNumber);

    const retryMock = createMockSmtpTransport({
      sendResult: { ok: true, id: "retry-1" },
    });
    setEmailTransportForTests(retryMock);
    const retried = await retryTransactionalEmail(adminId, customer!.id);
    expect(retried.status).toBe("SENT");

    // Retry must not create another order
    const orderCount = await prisma.order.count({ where: { id: order.id } });
    expect(orderCount).toBe(1);
  });
});

describe("trade application emails + deferred delivery", () => {
  it("defers emails when delivery disabled and does not roll back application", async () => {
    await updateEmailSettings(adminId, {
      enabled: false,
      smtpHost: "smtp.example.com",
      smtpUsername: "u@example.com",
      smtpPassword: "pw",
      replacePassword: true,
      fromEmail: "from@example.com",
      tradeApplicationRecipients: ["apps@example.invalid"],
    });

    const mock = createMockSmtpTransport();
    setEmailTransportForTests(mock);

    const suffix = Date.now();
    const submitted = await submitTradeApplication({
      companyName: `Email App Co ${suffix}`,
      businessType: "Motor Factor",
      tradingAddress: {
        line1: "1 Road",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      primaryContact: {
        firstName: "Sam",
        lastName: "Trader",
        email: `sam.${suffix}@example.invalid`,
        phone: "07000000000",
      },
      existingAccountClaim: "no",
      consentAccepted: true,
      brandsInterest: [],
    });

    expect(submitted.duplicate).toBe(false);
    const app = await prisma.tradeApplication.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(app.status).toBe("SUBMITTED");

    await sendTradeApplicationEmailsAfterSubmit(app.id);
    const rows = await prisma.transactionalEmail.findMany({
      where: { entityType: "TradeApplication", entityId: app.id },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "DEFERRED")).toBe(true);
    expect(mock.sent.length).toBe(0);
  });
});

describe("DTO credential absence", () => {
  it("public DTO never contains password fields", async () => {
    await updateEmailSettings(adminId, {
      smtpHost: "smtp.example.com",
      smtpUsername: "u@example.com",
      smtpPassword: "hidden",
      replacePassword: true,
      fromEmail: "from@example.com",
    });
    const dto = await getEmailSettingsForActor(adminId);
    const keys = Object.keys(dto);
    expect(keys).not.toContain("smtpPassword");
    expect(keys).not.toContain("smtpPasswordEncrypted");
    expect(dto.smtpPasswordConfigured).toBe(true);
  });
});
