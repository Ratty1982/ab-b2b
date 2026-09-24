/**
 * Admin Email Settings — SiteGround SMTP configuration stored in DB.
 * Passwords are AES-256-GCM encrypted with AUTH_SECRET. Never returned to clients.
 */

import type { Prisma, SmtpSecurity } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret";
import { createSmtpEmailTransport, sanitiseSmtpError } from "@/infra/email/smtp";
import type { EmailTransport, SmtpTransportConfig } from "@/infra/email/transport";
import {
  emailSettingsUpdateSchema,
  isSenderConfigured,
  isSmtpConfigured,
  normalizeRecipientList,
  sendTestEmailInputSchema,
  validateEmailSettingsSave,
  type EmailSettingsUpdateInput,
} from "@/domain/email-settings";
import { buildDiagnosticTestEmailBodies } from "@/server/email/test-template";
import { buildSmtpMailAddresses } from "@/server/email/addresses";

export const EMAIL_SETTINGS_ID = "singleton";

/** Test-only: inject SMTP transport factory (mock SiteGround). */
let smtpTransportFactoryForTests:
  | ((config: SmtpTransportConfig) => EmailTransport)
  | null = null;

export function setSmtpTransportFactoryForTests(
  factory: ((config: SmtpTransportConfig) => EmailTransport) | null,
) {
  smtpTransportFactoryForTests = factory;
}

function buildSmtpTransport(config: SmtpTransportConfig): EmailTransport {
  if (smtpTransportFactoryForTests) return smtpTransportFactoryForTests(config);
  return createSmtpEmailTransport(config);
}

/** Used by resolveEmailAdapter so business sends honour the same mock factory as diagnostics. */
export function buildSmtpTransportForAdapter(config: SmtpTransportConfig): EmailTransport {
  return buildSmtpTransport(config);
}

export type EmailSettingsPublicDto = {
  enabled: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string | null;
  smtpPasswordConfigured: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyToName: string | null;
  replyToEmail: string | null;
  tradeApplicationRecipients: string[];
  orderNotificationRecipients: string[];
  motorsportEnquiryRecipients: string[];
  status: {
    smtpConfigured: boolean;
    passwordConfigured: boolean;
    deliveryEnabled: boolean;
    senderConfigured: boolean;
    applicationAlertsConfigured: boolean;
    orderAlertsConfigured: boolean;
    motorsportAlertsConfigured: boolean;
  };
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestError: string | null;
  lastTestEmailAt: string | null;
  lastTestEmailOk: boolean | null;
  lastTestEmailError: string | null;
  updatedAt: string;
};

function parseRecipients(raw: Prisma.JsonValue): string[] {
  return normalizeRecipientList(raw);
}

export async function getOrCreateEmailSettings() {
  return prisma.emailSettings.upsert({
    where: { id: EMAIL_SETTINGS_ID },
    create: { id: EMAIL_SETTINGS_ID },
    update: {},
  });
}

function toPublicDto(row: Awaited<ReturnType<typeof getOrCreateEmailSettings>>): EmailSettingsPublicDto {
  const tradeApplicationRecipients = parseRecipients(row.tradeApplicationRecipients);
  const orderNotificationRecipients = parseRecipients(row.orderNotificationRecipients);
  const motorsportEnquiryRecipients = parseRecipients(row.motorsportEnquiryRecipients);
  const smtpPasswordConfigured = Boolean(row.smtpPasswordEncrypted);
  const smtpConfigured = isSmtpConfigured({
    smtpHost: row.smtpHost,
    smtpUsername: row.smtpUsername,
    smtpPasswordConfigured,
  });
  const senderConfigured = isSenderConfigured({ fromEmail: row.fromEmail, fromName: row.fromName });

  return {
    enabled: row.enabled,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecurity: row.smtpSecurity,
    smtpUsername: row.smtpUsername,
    smtpPasswordConfigured,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyToName: row.replyToName,
    replyToEmail: row.replyToEmail,
    tradeApplicationRecipients,
    orderNotificationRecipients,
    motorsportEnquiryRecipients,
    status: {
      smtpConfigured,
      passwordConfigured: smtpPasswordConfigured,
      deliveryEnabled: row.enabled,
      senderConfigured,
      applicationAlertsConfigured: tradeApplicationRecipients.length > 0,
      orderAlertsConfigured: orderNotificationRecipients.length > 0,
      motorsportAlertsConfigured: motorsportEnquiryRecipients.length > 0,
    },
    lastConnectionTestAt: row.lastConnectionTestAt?.toISOString() ?? null,
    lastConnectionTestOk: row.lastConnectionTestOk,
    lastConnectionTestError: row.lastConnectionTestError,
    lastTestEmailAt: row.lastTestEmailAt?.toISOString() ?? null,
    lastTestEmailOk: row.lastTestEmailOk,
    lastTestEmailError: row.lastTestEmailError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireSettingsView(actorUserId: string) {
  const profile = await requireSystemPermission(actorUserId, "settings.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot view email settings", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireSettingsEdit(actorUserId: string) {
  const profile = await requireSystemPermission(actorUserId, "settings.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot change email settings", "FORBIDDEN", 403);
  }
  return profile;
}

export async function getEmailSettingsForActor(actorUserId: string): Promise<EmailSettingsPublicDto> {
  await requireSettingsView(actorUserId);
  const row = await getOrCreateEmailSettings();
  return toPublicDto(row);
}

export async function updateEmailSettings(
  actorUserId: string,
  raw: unknown,
): Promise<EmailSettingsPublicDto> {
  await requireSettingsEdit(actorUserId);
  const parsed = emailSettingsUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid email settings", "VALIDATION", 400);
  }
  const input: EmailSettingsUpdateInput = parsed.data;
  const existing = await getOrCreateEmailSettings();
  const hasPassword = Boolean(existing.smtpPasswordEncrypted);

  const invalid = validateEmailSettingsSave(input, { hasPassword });
  if (invalid) throw new AuthError(invalid, "VALIDATION", 400);

  let smtpPasswordEncrypted = existing.smtpPasswordEncrypted;
  let credentialsReplaced = false;
  const replacing =
    Boolean(input.replacePassword) ||
    (typeof input.smtpPassword === "string" && input.smtpPassword.length > 0);
  if (replacing && input.smtpPassword) {
    smtpPasswordEncrypted = encryptSecret(input.smtpPassword);
    credentialsReplaced = true;
  }

  const wasEnabled = existing.enabled;
  const nextEnabled = input.enabled !== undefined ? input.enabled : existing.enabled;

  const updated = await prisma.emailSettings.update({
    where: { id: EMAIL_SETTINGS_ID },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.smtpHost !== undefined ? { smtpHost: input.smtpHost?.trim() || null } : {}),
      ...(input.smtpPort !== undefined ? { smtpPort: input.smtpPort } : {}),
      ...(input.smtpSecurity !== undefined ? { smtpSecurity: input.smtpSecurity } : {}),
      ...(input.smtpUsername !== undefined ? { smtpUsername: input.smtpUsername?.trim() || null } : {}),
      smtpPasswordEncrypted,
      ...(credentialsReplaced
        ? {
            lastConnectionTestAt: null,
            lastConnectionTestOk: null,
            lastConnectionTestError: null,
          }
        : {}),
      ...(input.fromName !== undefined ? { fromName: input.fromName?.trim() || null } : {}),
      ...(input.fromEmail !== undefined
        ? { fromEmail: input.fromEmail?.trim().toLowerCase() || null }
        : {}),
      ...(input.replyToName !== undefined ? { replyToName: input.replyToName?.trim() || null } : {}),
      ...(input.replyToEmail !== undefined
        ? { replyToEmail: input.replyToEmail?.trim().toLowerCase() || null }
        : {}),
      ...(input.tradeApplicationRecipients !== undefined
        ? { tradeApplicationRecipients: input.tradeApplicationRecipients }
        : {}),
      ...(input.orderNotificationRecipients !== undefined
        ? { orderNotificationRecipients: input.orderNotificationRecipients }
        : {}),
      ...(input.motorsportEnquiryRecipients !== undefined
        ? { motorsportEnquiryRecipients: input.motorsportEnquiryRecipients }
        : {}),
      updatedByUserId: actorUserId,
    },
  });

  await recordAuditEvent({
    action: "email.settings_updated",
    entityType: "EmailSettings",
    entityId: EMAIL_SETTINGS_ID,
    actorUserId,
    metadata: {
      enabled: updated.enabled,
      smtpHost: updated.smtpHost,
      smtpPort: updated.smtpPort,
      smtpSecurity: updated.smtpSecurity,
      smtpUsername: updated.smtpUsername,
      smtpPasswordConfigured: Boolean(updated.smtpPasswordEncrypted),
      credentialsReplaced,
      fromEmail: updated.fromEmail,
      replyToEmail: updated.replyToEmail,
      tradeRecipientCount: parseRecipients(updated.tradeApplicationRecipients).length,
      orderRecipientCount: parseRecipients(updated.orderNotificationRecipients).length,
    },
  });

  if (credentialsReplaced) {
    await recordAuditEvent({
      action: "email.smtp_credentials_replaced",
      entityType: "EmailSettings",
      entityId: EMAIL_SETTINGS_ID,
      actorUserId,
      metadata: { smtpHost: updated.smtpHost, smtpUsername: updated.smtpUsername },
    });
  }

  if (wasEnabled !== nextEnabled) {
    await recordAuditEvent({
      action: nextEnabled ? "email.delivery_enabled" : "email.delivery_disabled",
      entityType: "EmailSettings",
      entityId: EMAIL_SETTINGS_ID,
      actorUserId,
      metadata: { enabled: nextEnabled },
    });
  }

  return toPublicDto(updated);
}

/** Load runtime SMTP config for transport. Returns null when incomplete. Never log password. */
export async function loadSmtpRuntimeConfig(): Promise<SmtpTransportConfig | null> {
  const row = await getOrCreateEmailSettings();
  const password = decryptSecret(row.smtpPasswordEncrypted);
  if (!row.smtpHost?.trim() || !row.smtpUsername?.trim() || !password || !row.fromEmail?.trim()) {
    return null;
  }
  return {
    host: row.smtpHost.trim(),
    port: row.smtpPort,
    security: row.smtpSecurity,
    username: row.smtpUsername.trim(),
    password,
    fromName: row.fromName,
    fromEmail: row.fromEmail.trim(),
    replyToName: row.replyToName,
    replyToEmail: row.replyToEmail,
  };
}

export async function isTransactionalEmailEnabled(): Promise<boolean> {
  const row = await getOrCreateEmailSettings();
  return row.enabled;
}

export async function getOrderNotificationRecipients(): Promise<string[]> {
  const row = await getOrCreateEmailSettings();
  return parseRecipients(row.orderNotificationRecipients);
}

export async function getTradeApplicationNotificationRecipients(): Promise<string[]> {
  const row = await getOrCreateEmailSettings();
  return parseRecipients(row.tradeApplicationRecipients);
}

export async function getMotorsportEnquiryRecipients(): Promise<string[]> {
  const row = await getOrCreateEmailSettings();
  return parseRecipients(row.motorsportEnquiryRecipients);
}

/** Footer / reply meta for branded shells — never includes SMTP credentials. */
export async function getEmailFooterMeta(): Promise<{
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
}> {
  const row = await getOrCreateEmailSettings();
  return {
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyToEmail: row.replyToEmail,
  };
}

const diagnosticRate = new Map<string, number>();

function assertDiagnosticRateLimit(actorUserId: string, action: string) {
  const key = `${action}:${actorUserId}`;
  const now = Date.now();
  const last = diagnosticRate.get(key) ?? 0;
  if (now - last < 5_000) {
    throw new AuthError("Please wait a few seconds before retrying this diagnostic action", "RATE_LIMIT", 429);
  }
  diagnosticRate.set(key, now);
}

/** Clear rate-limit map in tests. */
export function clearEmailDiagnosticRateLimitsForTests() {
  diagnosticRate.clear();
}

/**
 * Test SAVED SMTP configuration only (network + TLS + auth). Does not send mail.
 */
export async function testSmtpConnection(actorUserId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  await requireSettingsEdit(actorUserId);
  assertDiagnosticRateLimit(actorUserId, "test-connection");

  const config = await loadSmtpRuntimeConfig();
  if (!config) {
    throw new AuthError(
      "Save complete SMTP settings (host, username, password, and from email) before testing the connection",
      "VALIDATION",
      400,
    );
  }

  const transport = buildSmtpTransport(config);
  if (!transport.verifyConnection) {
    throw new AuthError("SMTP transport does not support connection testing", "VALIDATION", 400);
  }

  const result = await transport.verifyConnection();
  const error = result.ok ? null : result.error;

  await prisma.emailSettings.update({
    where: { id: EMAIL_SETTINGS_ID },
    data: {
      lastConnectionTestAt: new Date(),
      lastConnectionTestOk: result.ok,
      lastConnectionTestError: error,
    },
  });

  await recordAuditEvent({
    action: "email.test_connection",
    entityType: "EmailSettings",
    entityId: EMAIL_SETTINGS_ID,
    actorUserId,
    metadata: { ok: result.ok, error: error ?? null, host: config.host, port: config.port },
  });

  if (result.ok) {
    return { ok: true, message: "CONNECTION SUCCESSFUL" };
  }
  return { ok: false, message: error ?? "SMTP connection failed" };
}

/**
 * Diagnostic test email. Bypasses the business delivery-enabled toggle so admins
 * can verify SMTP while delivery is still disabled. Clearly labelled as a TEST.
 * Uses the same SMTP transport as production transactional mail.
 */
export async function sendTestEmail(
  actorUserId: string,
  raw: unknown,
): Promise<{ ok: boolean; message: string; emailId?: string; sentAt?: string }> {
  await requireSettingsEdit(actorUserId);
  assertDiagnosticRateLimit(actorUserId, "test-email");

  const parsed = sendTestEmailInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid recipient", "VALIDATION", 400);
  }

  const config = await loadSmtpRuntimeConfig();
  if (!config) {
    throw new AuthError(
      "Save complete SMTP settings before sending a test email",
      "VALIDATION",
      400,
    );
  }

  const sentAt = new Date();
  const footer = {
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyToEmail: config.replyToEmail,
  };
  // Same sender builder as production SmtpEmailTransport.
  const mailAddresses = buildSmtpMailAddresses({
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyToName: config.replyToName,
    replyToEmail: config.replyToEmail,
    smtpUsername: config.username,
  });
  void mailAddresses;

  const bodies = buildDiagnosticTestEmailBodies({
    ...(parsed.data.toName ? { toName: parsed.data.toName } : {}),
    sentAt,
    footer,
  });
  const { subject, text, html } = bodies;

  const idempotencyKey = `EMAIL_TEST:${actorUserId}:${sentAt.toISOString()}`;
  const row = await prisma.transactionalEmail.create({
    data: {
      purpose: "EMAIL_TEST",
      status: "PENDING",
      toEmail: parsed.data.toEmail,
      subject,
      textBody: text,
      htmlBody: html,
      entityType: "EmailSettings",
      entityId: EMAIL_SETTINGS_ID,
      idempotencyKey,
    },
  });

  const transport = buildSmtpTransport(config);
  let sendOk = false;
  let detail: string | undefined;
  try {
    const result = await transport.send({
      to: parsed.data.toEmail,
      subject,
      text,
      html,
      tags: { purpose: "EMAIL_TEST", diagnostic: "true" },
    });
    sendOk = result.ok;
    detail = result.detail;
    await prisma.transactionalEmail.update({
      where: { id: row.id },
      data: result.ok
        ? {
            status: "SENT",
            attemptCount: { increment: 1 },
            providerId: result.id ?? null,
            sentAt,
            lastError: null,
          }
        : {
            status: "FAILED",
            attemptCount: { increment: 1 },
            lastError: result.detail ?? "send failed",
          },
    });
  } catch (error) {
    detail = sanitiseSmtpError(error);
    await prisma.transactionalEmail.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        attemptCount: { increment: 1 },
        lastError: detail,
      },
    });
  }

  await prisma.emailSettings.update({
    where: { id: EMAIL_SETTINGS_ID },
    data: {
      lastTestEmailAt: sentAt,
      lastTestEmailOk: sendOk,
      lastTestEmailError: sendOk ? null : (detail ?? "send failed"),
    },
  });

  await recordAuditEvent({
    action: sendOk ? "email.test_email_sent" : "email.test_email_requested",
    entityType: "TransactionalEmail",
    entityId: row.id,
    actorUserId,
    metadata: {
      ok: sendOk,
      toEmail: parsed.data.toEmail,
      fromHeader: mailAddresses.fromHeader,
      error: sendOk ? null : (detail ?? null),
    },
  });

  if (sendOk) {
    return {
      ok: true,
      message: "SENT",
      emailId: row.id,
      sentAt: sentAt.toISOString(),
    };
  }
  return {
    ok: false,
    message: detail ?? "FAILED",
    emailId: row.id,
  };
}

