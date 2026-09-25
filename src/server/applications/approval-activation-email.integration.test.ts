/**
 * Approval → TRADE_APPLICATION_APPROVED delivery, retry, and token-safety.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import {
  clearEmailDiagnosticRateLimitsForTests,
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";
import {
  acceptTradeInvitation,
  approveTradeApplication,
  getTradeApplication,
  resendTradeApplicationActivationEmail,
  submitTradeApplication,
} from "@/server/applications/service";
import {
  loadApprovedActivationToken,
  validTradeApplicationInput,
} from "@/server/applications/test-fixtures";
import { hashInviteToken } from "@/domain/invitation";
import { buildTradeApplicationApprovedBodies } from "@/server/email/application-templates";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let adminId = "";

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

async function enableSmtp(ok = true) {
  const mock = createMockSmtpTransport({
    sendResult: ok ? { ok: true, id: "mock-ok" } : { ok: false, detail: "smtp refused" },
  });
  setEmailTransportForTests(mock);
  setSmtpTransportFactoryForTests(() => mock);
  await updateEmailSettings(adminId, {
    enabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecurity: "STARTTLS",
    smtpUsername: "noreply@example.com",
    smtpPassword: "secret",
    replacePassword: true,
    fromName: "Automotive Brands",
    fromEmail: "noreply@example.com",
  });
  return mock;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`approve.mail.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("approval activation email", () => {
  it("sends TRADE_APPLICATION_APPROVED and never returns raw token", async () => {
    await enableSmtp(true);
    const email = `ok.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `OK Co ${suffix}`,
        email,
      }),
    );

    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);
    expect(approved.emailSent).toBe(true);
    expect(approved.emailStatus).toBe("SENT");
    expect(approved.contactEmail).toBe(email);
    expect(approved.sentAt).toBeTruthy();
    expect(JSON.stringify(approved)).not.toContain("/activate?token=");
    expect(JSON.stringify(approved)).not.toMatch(/inviteToken/);

    const mail = await prisma.transactionalEmail.findFirstOrThrow({
      where: { entityId: submitted.id, purpose: "TRADE_APPLICATION_APPROVED" },
    });
    expect(mail.status).toBe("SENT");
    expect(mail.toEmail).toBe(email);
    expect(mail.subject).toContain("trade account is ready");
    expect(mail.htmlBody).toContain("Activate your account");
    expect(mail.textBody).toContain("/activate?token=");
    // History metadata must not store a separate raw token field
    expect(JSON.stringify({ subject: mail.subject, toEmail: mail.toEmail, entityId: mail.entityId })).not.toContain(
      "token=",
    );

    const detail = await getTradeApplication(adminId, submitted.id);
    expect(detail.activation?.emailStatus).toBe("SENT");
    expect(detail.activation?.canResendActivation).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("/activate?token=");

    const audits = await prisma.auditEvent.findMany({
      where: { entityId: submitted.id, action: { in: ["application.approved", "application.activation_initiated"] } },
    });
    for (const a of audits) {
      expect(JSON.stringify(a)).not.toContain("/activate?token=");
      expect(JSON.stringify(a.after ?? {})).not.toMatch(/inviteToken/);
    }

    const token = await loadApprovedActivationToken(prisma, submitted.id);
    const activated = await acceptTradeInvitation({
      token,
      password: "ApproveMailPass1!",
      confirmPassword: "ApproveMailPass1!",
    });
    expect(activated.userId).toBeTruthy();

    const welcome = await prisma.transactionalEmail.findFirst({
      where: { purpose: "TRADE_ACCOUNT_ACTIVATED", entityId: activated.userId },
    });
    expect(welcome).toBeTruthy();

    await expect(
      acceptTradeInvitation({
        token,
        password: "ApproveMailPass1!",
        confirmPassword: "ApproveMailPass1!",
      }),
    ).rejects.toThrow();
  });

  it("leaves approval intact when SMTP fails and retry sends only email", async () => {
    await enableSmtp(false);
    const email = `fail.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Fail Co ${suffix}`,
        email,
      }),
    );

    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);
    expect(approved.companyId).toBeTruthy();
    expect(approved.emailSent).toBe(false);
    expect(approved.emailStatus).toBe("FAILED");
    expect(approved.emailDeferred).toBe(false);
    expect(approved.canResendActivation).toBe(true);

    const companiesBefore = await prisma.company.count({ where: { name: `Fail Co ${suffix}` } });
    const usersBefore = await prisma.user.count({ where: { email } });

    await enableSmtp(true);
    const resent = await resendTradeApplicationActivationEmail(adminId, { id: submitted.id });
    expect(resent.emailSent).toBe(true);
    expect(resent.emailStatus).toBe("SENT");

    expect(await prisma.company.count({ where: { name: `Fail Co ${suffix}` } })).toBe(companiesBefore);
    expect(await prisma.user.count({ where: { email } })).toBe(usersBefore);

    const token = await loadApprovedActivationToken(prisma, submitted.id);
    await acceptTradeInvitation({
      token,
      password: "RetryMailPass1!",
      confirmPassword: "RetryMailPass1!",
    });
  });

  it("shows DEFERRED when delivery is disabled", async () => {
    await enableSmtp(true);
    await updateEmailSettings(adminId, { enabled: false });

    const email = `def.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Def Co ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);
    expect(approved.emailStatus).toBe("DEFERRED");
    expect(approved.emailDeferred).toBe(true);
    expect(approved.emailSent).toBe(false);

    const mail = await prisma.transactionalEmail.findFirstOrThrow({
      where: { entityId: submitted.id, purpose: "TRADE_APPLICATION_APPROVED" },
    });
    expect(mail.status).toBe("DEFERRED");
    expect(mail.lastError).toContain("disabled");
  });

  it("reissues expired invitation on resend for legacy approved accounts", async () => {
    await enableSmtp(true);
    const email = `legacy.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Legacy Co ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const oldToken = await loadApprovedActivationToken(prisma, submitted.id);

    await prisma.userInvitation.updateMany({
      where: {
        companyId: approved.companyId,
        email,
        status: "PENDING",
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
        emailDeferred: true,
      },
    });

    const resent = await resendTradeApplicationActivationEmail(adminId, { id: submitted.id });
    expect(resent.emailSent).toBe(true);

    const newToken = await loadApprovedActivationToken(prisma, submitted.id);
    expect(newToken).not.toBe(oldToken);
    expect(hashInviteToken(newToken)).not.toBe(hashInviteToken(oldToken));

    await expect(
      acceptTradeInvitation({
        token: oldToken,
        password: "LegacyPass99!",
        confirmPassword: "LegacyPass99!",
      }),
    ).rejects.toThrow();

    await acceptTradeInvitation({
      token: newToken,
      password: "LegacyPass99!",
      confirmPassword: "LegacyPass99!",
    });
  });

  it("builds branded activation copy without requiring staff copy/paste", () => {
    const bodies = buildTradeApplicationApprovedBodies({
      applicationId: "app1",
      reference: "APP-TEST",
      companyName: "Street Rhino Ltd",
      contactName: "Alex",
      contactEmail: "info@streetrhino.co.uk",
      activationPath: "/activate?token=secret-token-value",
      adminApplicationUrl: "https://example.test/admin/applications/app1",
    });
    expect(bodies.subject).toBe("Your Automotive Brands trade account is ready");
    expect(bodies.text).toContain("Street Rhino Ltd");
    expect(bodies.text).toContain("has been approved");
    expect(bodies.html).toContain("Activate your account");
    expect(bodies.html).toContain("/activate?token=secret-token-value");
  });
});
