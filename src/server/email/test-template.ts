/**
 * Diagnostic test email bodies — same shell + same sender path as production mail.
 */

import { formatDateTime } from "@/lib/datetime";
import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";
import type { EmailFooterMeta } from "@/server/orders/email";

export function buildDiagnosticTestEmailBodies(input: {
  toName?: string | null;
  sentAt: Date;
  footer?: EmailFooterMeta;
}): { subject: string; text: string; html: string } {
  const sentLabel = formatDateTime(input.sentAt, { seconds: false }) ?? input.sentAt.toISOString();
  const toName = input.toName?.trim();
  const subject = "Automotive Brands Email Test";

  const text = [
    toName ? `Hello ${toName},` : null,
    toName ? "" : null,
    "TRANSACTIONAL EMAIL TEST",
    "",
    "This email confirms that the Automotive Brands transactional email",
    "system is configured and able to send email successfully.",
    "",
    `Sent: ${sentLabel}`,
    "",
    "This is a test message sent from Automotive Brands Admin → Settings → Email.",
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const bodyHtml = `
${toName ? `<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(toName)},</p>` : ""}
<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#e11d2e;">
  Transactional email test
</p>
<p style="margin:0 0 16px;">This email confirms that the Automotive Brands transactional email
system is configured and able to send email successfully.</p>
<p style="margin:0 0 16px;"><strong>Sent:</strong> ${escapeEmailHtml(sentLabel)}</p>
<p style="margin:0;font-size:13px;color:#5c6578;">This is a test message sent from Automotive Brands Admin → Settings → Email.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: "Automotive Brands transactional email test",
    bodyHtml,
    footer: input.footer ?? { fromName: "Automotive Brands" },
  });

  return { subject, text, html };
}
