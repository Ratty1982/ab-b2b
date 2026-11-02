import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { buildSecurityAlertMessage, securityAlertRecipient } from "@/server/security/alert-message";
import { SECURITY_POLICY } from "@/server/security/policy";

export type SecurityAlertInput = {
  kind: string;
  dedupeKey: string;
  summary: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown>;
  cooldownMs?: number;
};

/**
 * Record a serious security notice once per dedupe key inside the cooldown.
 * Email is sent only when SECURITY_ALERT_EMAIL is a single valid address and
 * SMTP is already configured. Failures are swallowed so a sign-in or export
 * is never blocked by alerting.
 */
export async function publishSecurityAlert(input: SecurityAlertInput): Promise<void> {
  try {
    const cooldown = input.cooldownMs ?? SECURITY_POLICY.alertCooldownMs;
    const since = new Date(Date.now() - cooldown);
    const recent = await prisma.auditEvent.findFirst({
      where: {
        action: "SECURITY_ALERT",
        createdAt: { gte: since },
        metadata: { path: ["dedupeKey"], equals: input.dedupeKey },
      },
      select: { id: true },
    });
    if (recent) return;

    const recipient = securityAlertRecipient();
    await recordAuditEvent({
      action: "SECURITY_ALERT",
      entityType: "Security",
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      companyId: input.companyId ?? null,
      metadata: {
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        summary: input.summary,
        emailConfigured: Boolean(recipient),
        ...(input.metadata ?? {}),
      },
    });

    if (!recipient) return;
    await sendSecurityAlertEmail(recipient, input.kind, input.summary);
  } catch (error) {
    console.error("[ab:security] alert was not recorded", {
      kind: input.kind,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

async function sendSecurityAlertEmail(to: string, kind: string, summary: string): Promise<void> {
  const { buildSmtpTransportForAdapter, loadSmtpRuntimeConfig } = await import(
    "@/server/email/settings"
  );
  const config = await loadSmtpRuntimeConfig();
  if (!config) return;
  const message = buildSecurityAlertMessage({ kind, summary, occurredAt: new Date() });
  const transport = buildSmtpTransportForAdapter(config);
  const result = await transport.send({ to, subject: message.subject, text: message.text });
  if (!result.ok) {
    console.error("[ab:security] alert email was not sent");
  }
}

export async function noteCustomerExport(input: {
  actorUserId: string;
  kind: string;
  companyId?: string | null;
  rowCount: number;
}): Promise<void> {
  try {
    await recordAuditEvent({
      action: "CUSTOMER_DATA_EXPORTED",
      entityType: "Export",
      entityId: input.kind,
      actorUserId: input.actorUserId,
      companyId: input.companyId ?? null,
      metadata: { kind: input.kind, rowCount: input.rowCount },
    });
    const since = new Date(Date.now() - SECURITY_POLICY.exportAlertWindowMs);
    const count = await prisma.auditEvent.count({
      where: {
        action: "CUSTOMER_DATA_EXPORTED",
        actorUserId: input.actorUserId,
        createdAt: { gte: since },
      },
    });
    if (count < SECURITY_POLICY.exportAlertCount) return;
    await publishSecurityAlert({
      kind: "UNUSUAL_CUSTOMER_EXPORT",
      dedupeKey: `export:${input.actorUserId}`,
      summary: "One staff account exported customer information many times within an hour.",
      actorUserId: input.actorUserId,
      companyId: input.companyId ?? null,
      metadata: { exportCount: count },
      cooldownMs: 6 * 60 * 60 * 1000,
    });
  } catch (error) {
    console.error("[ab:security] export note failed", {
      kind: input.kind,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
