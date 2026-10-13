/**
 * Customer survey acknowledgement and internal notification.
 * Outbox idempotency keys stop a second send for the same response.
 */
import type { CustomerSurveyResponse, SurveyEmailDeliveryStatus } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import type { EmailAdapter } from "@/infra/email/types";
import {
  buildCustomerSurveyAcknowledgementBodies,
  buildCustomerSurveyInternalBodies,
} from "@/server/email/extra-templates";
import { getEmailFooterMeta, getOrderNotificationRecipients } from "@/server/email/settings";
import { attemptSend, upsertPendingEmail } from "@/server/email/transactional";
import { getServerEnv } from "@/server/env";
import { formatDateTime } from "@/lib/datetime";
import { formatStoredRating } from "@/domain/customer-survey";

async function surveyRecipients(): Promise<string[]> {
  const row = await prisma.emailSettings.findUnique({ where: { id: "singleton" } });
  const configured = Array.isArray(row?.surveyNotificationRecipients)
    ? row.surveyNotificationRecipients.filter(
        (value): value is string => typeof value === "string" && value.includes("@"),
      )
    : [];
  if (configured.length > 0)
    return [...new Set(configured.map((value) => value.trim().toLowerCase()))];
  return getOrderNotificationRecipients();
}

function mapDispatch(status: string | undefined): SurveyEmailDeliveryStatus {
  if (status === "SENT") return "SENT";
  if (status === "FAILED") return "FAILED";
  return "PENDING";
}

export async function deliverSurveyEmails(
  responseId: string,
  adapter?: EmailAdapter,
): Promise<void> {
  const row = await prisma.customerSurveyResponse.findUnique({ where: { id: responseId } });
  if (!row || row.source === "WORDPRESS_IMPORT") return;
  if (row.ackEmailStatus === "SKIPPED_IMPORT" || row.internalEmailStatus === "SKIPPED_IMPORT")
    return;

  const footer = await getEmailFooterMeta();
  const base = getServerEnv().APP_URL.replace(/\/$/, "");
  const submittedAtLabel =
    formatDateTime(row.submittedAt, { seconds: false, timeZoneName: true }) ??
    row.submittedAt.toISOString();

  let ackStatus: SurveyEmailDeliveryStatus = row.customerEmail
    ? row.ackEmailStatus
    : "NOT_REQUIRED";
  let ackSentAt = row.ackEmailSentAt;
  if (row.customerEmail && row.ackEmailStatus !== "SENT") {
    const bodies = buildCustomerSurveyAcknowledgementBodies(
      {
        customerName: row.customerName,
        reference: row.reference,
        prizeDrawAccepted: row.prizeDrawAccepted,
        surveyUrl: `${base}/customer-survey`,
      },
      footer,
    );
    const upsert = await upsertPendingEmail({
      purpose: "CUSTOMER_SURVEY_ACK",
      toEmail: row.customerEmail,
      subject: bodies.subject,
      textBody: bodies.text,
      htmlBody: bodies.html,
      entityType: "CustomerSurveyResponse",
      entityId: row.id,
      idempotencyKey: `CUSTOMER_SURVEY_ACK:${row.id}`,
    });
    const result = await attemptSend(upsert.id, adapter);
    const stored = await prisma.transactionalEmail.findUnique({ where: { id: upsert.id } });
    ackStatus = result.ok ? "SENT" : mapDispatch(stored?.status);
    ackSentAt = stored?.sentAt ?? null;
  }

  let internalStatus: SurveyEmailDeliveryStatus = row.internalEmailStatus;
  let internalSentAt = row.internalEmailSentAt;
  if (row.internalEmailStatus !== "SENT") {
    const recipients = await surveyRecipients();
    if (recipients.length === 0) {
      internalStatus = "NO_RECIPIENT";
    } else {
      const bodies = buildCustomerSurveyInternalBodies(
        {
          reference: row.reference,
          submittedAtLabel,
          overall: formatStoredRating("overallSatisfaction", row.overallSatisfaction),
          recommendation: formatStoredRating("recommendationScore", row.recommendationScore),
          doWell: row.doWell,
          couldImprove: row.couldImprove,
          productRequests: row.productRequests,
          additionalComments: row.additionalComments,
          contactPermission: row.contactPermission,
          customerName: row.customerName,
          customerEmail: row.customerEmail,
          customerPhone: row.customerPhone,
          prizeDraw: row.prizeDrawAccepted
            ? "Accepted entry"
            : row.prizeDrawRequested
              ? `Requested, not accepted${row.prizeDrawRejectionReason ? ` (${row.prizeDrawRejectionReason})` : ""}`
              : "Not entered",
          adminUrl: `${base}/admin/customer-surveys`,
        },
        footer,
      );
      const statuses: SurveyEmailDeliveryStatus[] = [];
      let sentAt: Date | null = null;
      for (const toEmail of recipients) {
        const upsert = await upsertPendingEmail({
          purpose: "CUSTOMER_SURVEY_INTERNAL",
          toEmail,
          subject: bodies.subject,
          textBody: bodies.text,
          htmlBody: bodies.html,
          entityType: "CustomerSurveyResponse",
          entityId: row.id,
          idempotencyKey: `CUSTOMER_SURVEY_INTERNAL:${row.id}:${toEmail}`,
        });
        await attemptSend(upsert.id, adapter);
        const stored = await prisma.transactionalEmail.findUnique({ where: { id: upsert.id } });
        statuses.push(mapDispatch(stored?.status));
        if (stored?.sentAt) sentAt = stored.sentAt;
      }
      internalStatus = statuses.every((status) => status === "SENT")
        ? "SENT"
        : statuses.some((status) => status === "FAILED")
          ? "FAILED"
          : "PENDING";
      internalSentAt = internalStatus === "SENT" ? sentAt : null;
    }
  }

  await prisma.customerSurveyResponse.update({
    where: { id: row.id },
    data: {
      ackEmailStatus: ackStatus,
      ackEmailSentAt: ackSentAt,
      internalEmailStatus: internalStatus,
      internalEmailSentAt: internalSentAt,
    },
  });
}

export type SurveyEmailRow = Pick<
  CustomerSurveyResponse,
  "id" | "customerEmail" | "ackEmailStatus" | "internalEmailStatus" | "source"
>;
