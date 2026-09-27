/**
 * Password reset + company invite + motorsport enquiry email templates.
 */

import { createHash } from "node:crypto";
import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";
import type { EmailFooterMeta } from "@/server/orders/email";

export function buildPasswordResetBodies(
  input: { resetUrl: string },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = "Reset your Automotive Brands password";
  const text = `We received a request to reset the password for your Automotive Brands trade account.

Reset your password using this link:

${input.resetUrl}

If you did not request this, you can ignore this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">We received a request to reset the password for your Automotive Brands trade account.</p>
<p style="margin:0 0 16px;">Use the button below to choose a new password. If you did not request this, you can ignore this email.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: "Reset your Automotive Brands password",
    bodyHtml,
    cta: { label: "Reset password", href: input.resetUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

/** Hash a reset URL for idempotency without storing the raw token elsewhere. */
export function passwordResetIdempotencyKey(userId: string, resetUrl: string): string {
  const digest = createHash("sha256").update(resetUrl).digest("hex").slice(0, 24);
  return `PASSWORD_RESET:${userId}:${digest}`;
}

export function buildCompanyUserInviteBodies(
  input: {
    companyName: string;
    role: string;
    activationPath: string;
    inviteeEmail: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = `You're invited to the Automotive Brands trade portal — ${input.companyName}`;
  const text = `You have been invited to join ${input.companyName} on the Automotive Brands trade portal (${input.role}).

Activate your account:
${input.activationPath}

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">You have been invited to join <strong>${escapeEmailHtml(input.companyName)}</strong>
on the Automotive Brands trade portal.</p>
<p style="margin:0 0 16px;">Role: ${escapeEmailHtml(input.role)}</p>
<p style="margin:0;">Use the button below to activate your account and set your password.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Portal invite — ${input.companyName}`,
    bodyHtml,
    cta: { label: "Activate your account", href: input.activationPath },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildMotorsportEnquiryInternalBodies(
  input: {
    leadId: string;
    companyName: string;
    contactName: string;
    email: string;
    telephone: string | null;
    messagePreview: string;
    adminLeadUrl: string;
    submittedAtLabel: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = `Motorsport partnership enquiry — ${input.companyName}`;
  const text = `New motorsport partnership enquiry

Company: ${input.companyName}
Contact: ${input.contactName}
Email: ${input.email}
Telephone: ${input.telephone ?? "—"}
Submitted: ${input.submittedAtLabel}

Message:
${input.messagePreview}

Review: ${input.adminLeadUrl}

Automotive Brands`;

  const bodyHtml = `
<p style="margin:0 0 16px;"><strong>New motorsport partnership enquiry</strong></p>
<p style="margin:0 0 12px;">
Company: ${escapeEmailHtml(input.companyName)}<br/>
Contact: ${escapeEmailHtml(input.contactName)}<br/>
Email: ${escapeEmailHtml(input.email)}<br/>
Telephone: ${escapeEmailHtml(input.telephone ?? "—")}<br/>
Submitted: ${escapeEmailHtml(input.submittedAtLabel)}
</p>
<p style="margin:0 0 12px;white-space:pre-wrap;">${escapeEmailHtml(input.messagePreview)}</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Motorsport enquiry — ${input.companyName}`,
    bodyHtml,
    cta: { label: "View enquiry", href: input.adminLeadUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildCallbackRequestInternalBodies(
  input: {
    customerName: string;
    companyName: string;
    email: string;
    telephone: string;
    accountLabel: string;
    accountManagerName: string | null;
    message: string;
    submittedAtLabel: string;
    ctaLabel: string;
    ctaUrl: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const company = input.companyName || "—";
  const subject = `Request a callback — ${input.customerName}${input.companyName ? ` · ${input.companyName}` : ""}`;
  const amLine = input.accountManagerName ?? "Trade team";
  const text = `REQUEST A CALLBACK

Customer: ${input.customerName}
Company: ${company}
Email: ${input.email || "—"}
Telephone: ${input.telephone || "—"}
Account: ${input.accountLabel}
Account Manager: ${amLine}
Submitted: ${input.submittedAtLabel}

Message:
${input.message}

${input.ctaLabel}: ${input.ctaUrl}

Automotive Brands`;

  const bodyHtml = `
<p style="margin:0 0 16px;"><strong>REQUEST A CALLBACK</strong></p>
<p style="margin:0 0 12px;">
Customer: ${escapeEmailHtml(input.customerName)}<br/>
Company: ${escapeEmailHtml(company)}<br/>
Email: ${escapeEmailHtml(input.email || "—")}<br/>
Telephone: ${escapeEmailHtml(input.telephone || "—")}<br/>
Account: ${escapeEmailHtml(input.accountLabel)}<br/>
Account Manager: ${escapeEmailHtml(amLine)}<br/>
Submitted: ${escapeEmailHtml(input.submittedAtLabel)}
</p>
<p style="margin:0 0 4px;"><strong>Message</strong></p>
<p style="margin:0 0 12px;white-space:pre-wrap;">${escapeEmailHtml(input.message)}</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Callback request — ${input.customerName}`,
    bodyHtml,
    cta: { label: input.ctaLabel, href: input.ctaUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
