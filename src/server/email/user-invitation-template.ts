/**
 * Admin staff invitation + set-password email templates.
 */

import { renderTransactionalEmailShell } from "@/server/email/shell";
import { emailHero, emailParagraph, emailReferencePanel } from "@/server/email/layout";
import type { EmailFooterMeta } from "@/server/orders/email";

export function buildUserInvitationBodies(
  input: {
    email: string;
    displayName: string;
    roleLabel: string;
    activationUrl: string;
  },
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = "Your Automotive Brands account is ready";
  const text = `YOUR AUTOMOTIVE BRANDS ACCOUNT IS READY

An account has been created for you on Automotive Brands.

Name: ${input.displayName}
Email: ${input.email}
Role: ${input.roleLabel}

Use the link below to set your password and activate your account:

${input.activationUrl}

If you were not expecting this invitation, you can ignore this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Your Automotive Brands account is ready", input.displayName || input.email)}
${emailReferencePanel([
  { label: "Name", value: input.displayName },
  { label: "Email", value: input.email },
  { label: "Role", value: input.roleLabel },
])}
${emailParagraph("Use the button below to set your password and activate your account.")}
${emailParagraph("If you were not expecting this invitation, you can ignore this email.", true)}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
    preheader: "Set your Automotive Brands password",
    bodyHtml,
    cta: { label: "Set your password", href: input.activationUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
