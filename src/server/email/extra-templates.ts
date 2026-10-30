/**
 * Password reset + company invite + motorsport enquiry email templates.
 */

import { createHash } from "node:crypto";
import { publicSiteUrl, renderTransactionalEmailShell } from "@/server/email/shell";
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
${publicSiteUrl()}`;

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
${publicSiteUrl()}`;

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

export function buildCustomerSurveyAcknowledgementBodies(
  input: {
    customerName: string;
    reference: string;
    prizeDrawAccepted: boolean;
    surveyUrl: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const name = input.customerName.trim() || "Customer";
  const subject = "Thank you for your feedback - Automotive Brands";
  const prizeText = input.prizeDrawAccepted
    ? "\nPrize Draw\nYou have chosen to enter our free prize draw. Your entry has been recorded and we wish you the best of luck!\n"
    : "";
  const text = `Dear ${name},

Thank you for taking the time to complete the Automotive Brands Customer Satisfaction Survey.

We have received your feedback and really appreciate you sharing your experience with us. Your feedback is important to us and will help us monitor customer satisfaction, improve our products and services, and identify opportunities for continual improvement.

Survey Reference
${input.reference}
${prizeText}
Thank you again for your time and for helping us improve.

Kind regards,
The Automotive Brands Team
Steel Seal Ltd t/a Automotive Brands

${input.surveyUrl}`;

  const prizeHtml = input.prizeDrawAccepted
    ? emailStatusCallout(
        "Prize Draw",
        "You have chosen to enter our free prize draw. Your entry has been recorded and we wish you the best of luck!",
        "neutral",
      )
    : "";

  const bodyHtml = `
${emailHero("Customer satisfaction survey", "Thank you for your feedback")}
${emailParagraph(`Dear ${name},`)}
${emailParagraph("Thank you for taking the time to complete the Automotive Brands Customer Satisfaction Survey.")}
${emailParagraph("We have received your feedback and really appreciate you sharing your experience with us. Your feedback is important to us and will help us monitor customer satisfaction, improve our products and services, and identify opportunities for continual improvement.")}
${emailReferencePanel([{ label: "Survey reference", value: input.reference }])}
${prizeHtml}
${emailParagraph("Thank you again for your time and for helping us improve.")}
${emailParagraph("Kind regards,", true)}
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1a1f2c;"><strong>The Automotive Brands Team</strong><br/>Steel Seal Ltd t/a Automotive Brands</p>`;

  const html = renderTransactionalEmailShell({
    variant: "customer",
    preheader: `Thank you for your feedback. Survey reference ${input.reference}.`,
    bodyHtml,
    cta: { label: "Return to Automotive Brands", href: input.surveyUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildCustomerSurveyInternalBodies(
  input: {
    reference: string;
    submittedAtLabel: string;
    overall: string;
    recommendation: string;
    doWell: string;
    couldImprove: string;
    productRequests: string;
    additionalComments: string;
    contactPermission: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    prizeDraw: string;
    adminUrl: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = `New Customer Satisfaction Survey ${input.reference}`;
  const text = `A new customer satisfaction survey has been submitted.

Survey reference: ${input.reference}
Date: ${input.submittedAtLabel}

Overall satisfaction: ${input.overall}
Recommendation score: ${input.recommendation}

WHAT WE DO WELL
${input.doWell || "—"}

WHAT WE COULD IMPROVE
${input.couldImprove || "—"}

PRODUCT / SERVICE REQUESTS
${input.productRequests || "—"}

ADDITIONAL COMMENTS
${input.additionalComments || "—"}

CONTACT REQUEST
Permission: ${input.contactPermission}
Name: ${input.customerName || "—"}
Email: ${input.customerEmail || "—"}
Telephone: ${input.customerPhone || "—"}

Prize draw: ${input.prizeDraw}

${input.adminUrl}`;

  const bodyHtml = `
${emailHero("Customer survey", input.reference)}
${emailReferencePanel([
  { label: "Submitted", value: input.submittedAtLabel },
  { label: "Overall satisfaction", value: input.overall },
  { label: "Recommendation", value: input.recommendation },
  { label: "Contact permission", value: input.contactPermission },
  { label: "Name", value: input.customerName || "—" },
  { label: "Email", value: input.customerEmail || "—" },
  { label: "Telephone", value: input.customerPhone || "—" },
  { label: "Prize draw", value: input.prizeDraw },
])}
${emailStatusCallout("What we do well", input.doWell || "—", "neutral")}
${emailStatusCallout("What we could improve", input.couldImprove || "—", "neutral")}
${emailStatusCallout("Product or service requests", input.productRequests || "—", "neutral")}
${emailStatusCallout("Additional comments", input.additionalComments || "—", "neutral")}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
    preheader: `New customer survey ${input.reference}`,
    bodyHtml,
    cta: { label: "View survey responses", href: input.adminUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
