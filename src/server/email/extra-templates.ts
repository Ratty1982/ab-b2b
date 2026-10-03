/**
 * Password reset + company invite + motorsport enquiry email templates.
 */

import { createHash } from "node:crypto";
import { renderTransactionalEmailShell } from "@/server/email/shell";
import {
  emailHero,
  emailParagraph,
  emailReferencePanel,
  emailStatusCallout,
} from "@/server/email/layout";
import type { EmailFooterMeta } from "@/server/orders/email";

export function buildPasswordResetBodies(
  input: { resetUrl: string },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = "Reset your Automotive Brands password";
  const text = `RESET YOUR PASSWORD

We received a request to reset the password for your Automotive Brands trade account.

Reset your password using this link:

${input.resetUrl}

If you didn't request this, you can safely ignore this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Reset your password", "A password reset was requested")}
${emailParagraph("We received a request to reset the password for your Automotive Brands trade account. Use the button below to choose a new password.")}
${emailParagraph("If you didn't request this, you can safely ignore this email.", true)}`;

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
  const text = `YOU'VE BEEN INVITED

You have been invited to join ${input.companyName} on the Automotive Brands trade portal.

Role: ${input.role}

Activate your account:
${input.activationPath}

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("You've been invited", input.companyName)}
${emailReferencePanel([
  { label: "Company", value: input.companyName },
  { label: "Account / role", value: input.role },
])}
${emailParagraph("Use the button below to activate your account and set your password.", true)}`;

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
  const text = `MOTORSPORT PARTNERSHIP ENQUIRY

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
${emailHero("Motorsport partnership enquiry", input.companyName)}
${emailReferencePanel([
  { label: "Contact", value: `${input.contactName} <${input.email}>` },
  { label: "Telephone", value: input.telephone ?? "—" },
  { label: "Submitted", value: input.submittedAtLabel },
])}
${emailStatusCallout("Message", input.messagePreview, "neutral")}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
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
  const text = `CALLBACK REQUEST

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
${emailHero("Callback request", input.customerName)}
${emailReferencePanel([
  { label: "Company", value: company },
  { label: "Email", value: input.email || "—" },
  { label: "Telephone", value: input.telephone || "—" },
  { label: "Account", value: input.accountLabel },
  { label: "Account manager", value: amLine },
  { label: "Submitted", value: input.submittedAtLabel },
])}
${emailStatusCallout("Message", input.message, "neutral")}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
    preheader: `Callback request — ${input.customerName}`,
    bodyHtml,
    cta: { label: input.ctaLabel, href: input.ctaUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
