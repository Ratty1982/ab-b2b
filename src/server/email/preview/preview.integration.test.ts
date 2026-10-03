/**
 * Super Admin template preview/test — RBAC, recipient safety, no business writes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import {
  clearEmailDiagnosticRateLimitsForTests,
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";
import {
  clearEmailPreviewRateLimitsForTests,
  getEmailPreviewCentre,
  previewEmailTemplate,
  sendEmailTemplateTest,
} from "@/server/email/preview/service";
import { TEST_EMAIL_CALLOUT_TITLE, TEST_EMAIL_SUBJECT_PREFIX } from "@/server/email/shell";
import { isOperationalEmailFailurePurpose } from "@/domain/admin-dashboard";
import { PREVIEW_CUSTOMER } from "@/server/email/preview/fixtures";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
let adminId = "";
let salesId = "";
let managementId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
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
  adminId = await ensureUser(`preview.sa.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`preview.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  managementId = await ensureUser(`preview.mgmt.${stamp}@example.invalid`, ["MANAGEMENT"]);
});

beforeEach(async () => {
  clearEmailDiagnosticRateLimitsForTests();
  clearEmailPreviewRateLimitsForTests();
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
  clearEmailPreviewRateLimitsForTests();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("email template preview RBAC", () => {
  it("allows Super Admin and rejects Sales / Management", async () => {
    const centre = await getEmailPreviewCentre(adminId);
    expect(centre.templates.length).toBeGreaterThan(10);
    expect(centre.actorEmail).toContain("@");

    await expect(getEmailPreviewCentre(salesId)).rejects.toBeInstanceOf(AuthError);
    await expect(previewEmailTemplate(salesId, "order-received")).rejects.toBeInstanceOf(AuthError);
    await expect(
      sendEmailTemplateTest(salesId, {
        templateId: "order-received",
        toEmail: "sales@example.invalid",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(getEmailPreviewCentre(managementId)).rejects.toBeInstanceOf(AuthError);
    await expect(previewEmailTemplate(managementId, "order-received")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("email template test send safety", () => {
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
      fromName: "Automotive Brands",
      orderNotificationRecipients: ["ops-alerts@example.invalid"],
    });
  }

  it("sends only to the explicit recipient with [TEST] subject and callout", async () => {
    await configureSmtp();
    const sentTo: string[] = [];
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({
        sendResult: { ok: true, id: "preview-1" },
        onSend: (msg) => {
          sentTo.push(msg.to);
        },
      }),
    );

    const orderCount = await prisma.order.count();
    const appCount = await prisma.tradeApplication.count();
    const quoteCount = await prisma.quote.count();

    const result = await sendEmailTemplateTest(adminId, {
      templateId: "order-received",
      scenarioId: "backorder",
      toEmail: "wayne.radford@example.invalid",
    });
    expect(result.ok).toBe(true);
    if (!result.emailId) throw new Error("expected emailId");
    expect(result.toEmail).toBe("wayne.radford@example.invalid");
    expect(sentTo).toEqual(["wayne.radford@example.invalid"]);
    expect(sentTo).not.toContain(PREVIEW_CUSTOMER.email);
    expect(sentTo).not.toContain("ops-alerts@example.invalid");
    expect(sentTo).not.toContain("luke.preview@example.invalid");

    const row = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: result.emailId } });
    expect(row.purpose).toBe("EMAIL_TEST");
    expect(row.entityType).toBe("EmailTemplatePreview");
    expect(row.toEmail).toBe("wayne.radford@example.invalid");
    expect(row.subject.startsWith(`${TEST_EMAIL_SUBJECT_PREFIX} `)).toBe(true);
    expect(row.htmlBody).toContain(TEST_EMAIL_CALLOUT_TITLE);
    expect(isOperationalEmailFailurePurpose(row.purpose)).toBe(false);

    expect(await prisma.order.count()).toBe(orderCount);
    expect(await prisma.tradeApplication.count()).toBe(appCount);
    expect(await prisma.quote.count()).toBe(quoteCount);
  });

  it("failed template tests stay EMAIL_TEST and do not count as operational failures", async () => {
    await configureSmtp();
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({ sendResult: { ok: false, detail: "Authentication failed" } }),
    );
    const result = await sendEmailTemplateTest(adminId, {
      templateId: "quote-sent",
      toEmail: "qa@example.invalid",
    });
    expect(result.ok).toBe(false);
    if (!result.emailId) throw new Error("expected emailId");
    const row = await prisma.transactionalEmail.findUniqueOrThrow({ where: { id: result.emailId } });
    expect(row.status).toBe("FAILED");
    expect(row.purpose).toBe("EMAIL_TEST");
    expect(isOperationalEmailFailurePurpose("EMAIL_TEST")).toBe(false);
  });
});
