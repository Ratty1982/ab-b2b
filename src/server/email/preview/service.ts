/**
 * Super Admin email template preview + diagnostic test send.
 * Renders production builders with fixture data only — no business writes.
 */

import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { sanitiseSmtpError } from "@/infra/email/smtp";
import { emailAddressSchema } from "@/domain/email-settings";
import { formatDateTime } from "@/lib/datetime";
import { decorateAsTemplateTest } from "@/server/email/shell";
import {
  buildSmtpTransportForAdapter,
  loadSmtpRuntimeConfig,
} from "@/server/email/settings";
import {
  listPreviewTemplateMeta,
  renderPreviewTemplate,
  type PreviewAudience,
  type PreviewTemplateMeta,
  type RenderedPreview,
} from "@/server/email/preview/registry";

export const EMAIL_TEMPLATE_PREVIEW_ENTITY = "EmailTemplatePreview";

async function requireSuperAdmin(userId: string) {
  const profile = await requireAuthenticatedUser(userId);
  if (profile.actorType === "TRADE" || !profile.systemRoles.includes("SUPER_ADMIN")) {
    throw new AuthError("Only Super Admin can preview or send template tests", "FORBIDDEN", 403);
  }
  return profile;
}

const previewRate = new Map<string, number>();

export function clearEmailPreviewRateLimitsForTests() {
  previewRate.clear();
}

function assertPreviewRateLimit(actorUserId: string) {
  const now = Date.now();
  const last = previewRate.get(actorUserId) ?? 0;
  if (now - last < 5_000) {
    throw new AuthError("Please wait a few seconds before retrying this diagnostic action", "RATE_LIMIT", 429);
  }
  previewRate.set(actorUserId, now);
}

const sendInputSchema = z.object({
  templateId: z.string().min(1).max(80),
  scenarioId: z.string().min(1).max(80).optional(),
  toEmail: emailAddressSchema,
});

export type EmailPreviewCentreDto = {
  actorEmail: string;
  actorName: string | null;
  templates: PreviewTemplateMeta[];
  recentTests: EmailTemplateTestHistoryRow[];
};

export type EmailTemplateTestHistoryRow = {
  id: string;
  createdAt: string;
  createdAtLabel: string;
  templateId: string;
  templateName: string;
  toEmail: string;
  status: string;
  sentBy: string;
};

export async function getEmailPreviewCentre(actorUserId: string): Promise<EmailPreviewCentreDto> {
  const profile = await requireSuperAdmin(actorUserId);
  return {
    actorEmail: profile.email,
    actorName: profile.name,
    templates: listPreviewTemplateMeta(),
    recentTests: await listRecentTemplateTests(actorUserId),
  };
}

export async function previewEmailTemplate(
  actorUserId: string,
  templateId: string,
  scenarioId?: string,
): Promise<RenderedPreview> {
  await requireSuperAdmin(actorUserId);
  try {
    return renderPreviewTemplate(templateId, scenarioId);
  } catch {
    throw new AuthError("Unknown email template", "NOT_FOUND", 404);
  }
}

export async function listRecentTemplateTests(actorUserId: string): Promise<EmailTemplateTestHistoryRow[]> {
  await requireSuperAdmin(actorUserId);
  const rows = await prisma.transactionalEmail.findMany({
    where: { purpose: "EMAIL_TEST", entityType: EMAIL_TEMPLATE_PREVIEW_ENTITY },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const ids = rows.map((row) => row.id);
  const audits = ids.length
    ? await prisma.auditEvent.findMany({
        where: {
          action: { in: ["email.template_test_sent", "email.template_test_requested"] },
          entityType: "TransactionalEmail",
          entityId: { in: ids },
        },
        include: { actor: { select: { name: true, email: true } } },
      })
    : [];
  const auditByEmailId = new Map(audits.map((a) => [a.entityId, a]));
  const metas = new Map(listPreviewTemplateMeta().map((t) => [t.id, t.name]));

  return rows.map((row) => {
    const audit = auditByEmailId.get(row.id);
    const sentBy =
      audit?.actor?.name?.trim() ||
      audit?.actor?.email ||
      "Super Admin";
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      createdAtLabel: formatDateTime(row.createdAt, { seconds: false }) ?? row.createdAt.toISOString(),
      templateId: row.entityId,
      templateName: metas.get(row.entityId) ?? row.entityId,
      toEmail: row.toEmail,
      status: row.status,
      sentBy,
    };
  });
}

export async function sendEmailTemplateTest(
  actorUserId: string,
  raw: unknown,
): Promise<{ ok: boolean; message: string; emailId?: string; toEmail: string }> {
  const profile = await requireSuperAdmin(actorUserId);
  assertPreviewRateLimit(actorUserId);

  const parsed = sendInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid test send", "VALIDATION", 400);
  }

  let preview: RenderedPreview;
  try {
    preview = renderPreviewTemplate(parsed.data.templateId, parsed.data.scenarioId);
  } catch {
    throw new AuthError("Unknown email template", "NOT_FOUND", 404);
  }

  const recipient = parsed.data.toEmail;
  const decorated = decorateAsTemplateTest({
    subject: preview.subject,
    text: preview.text,
    html: preview.html,
  });

  const config = await loadSmtpRuntimeConfig();
  if (!config) {
    throw new AuthError(
      "Save complete SMTP settings before sending a test email",
      "VALIDATION",
      400,
    );
  }

  const sentAt = new Date();
  const idempotencyKey = `EMAIL_TEST:preview:${preview.templateId}:${actorUserId}:${sentAt.toISOString()}`;
  const row = await prisma.transactionalEmail.create({
    data: {
      purpose: "EMAIL_TEST",
      status: "PENDING",
      toEmail: recipient,
      subject: decorated.subject,
      textBody: decorated.text,
      htmlBody: decorated.html,
      entityType: EMAIL_TEMPLATE_PREVIEW_ENTITY,
      entityId: preview.templateId,
      idempotencyKey,
    },
  });

  const transport = buildSmtpTransportForAdapter(config);
  let sendOk = false;
  let detail: string | undefined;
  try {
    const result = await transport.send({
      to: recipient,
      subject: decorated.subject,
      text: decorated.text,
      html: decorated.html,
      tags: {
        purpose: "EMAIL_TEST",
        diagnostic: "true",
        templateId: preview.templateId,
      },
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

  await recordAuditEvent({
    action: sendOk ? "email.template_test_sent" : "email.template_test_requested",
    entityType: "TransactionalEmail",
    entityId: row.id,
    actorUserId: profile.userId,
    metadata: {
      ok: sendOk,
      toEmail: recipient,
      templateId: preview.templateId,
      scenarioId: preview.scenarioId,
      purpose: preview.purpose,
      error: sendOk ? null : (detail ?? null),
    },
  });

  if (sendOk) {
    return { ok: true, message: "SENT", emailId: row.id, toEmail: recipient };
  }
  return { ok: false, message: detail ?? "FAILED", emailId: row.id, toEmail: recipient };
}

export type { PreviewAudience, PreviewTemplateMeta, RenderedPreview };
