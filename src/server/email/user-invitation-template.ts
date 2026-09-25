/**
 * Admin staff invitation + set-password email templates.
 */

import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";
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
  const text = `YOUR AUTOMOTIVE BRANDS ACCOUNT

An account has been created for you on Automotive Brands.

Email: ${input.email}
Name: ${input.displayName}
Account type: ${input.roleLabel}

Use the link below to set your password and activate your account:

${input.activationUrl}

If you were not expecting this invitation, you can ignore this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#666;">Your Automotive Brands account</p>
<p style="margin:0 0 16px;">An account has been created for you on Automotive Brands.</p>
<p style="margin:0 0 16px;">
Email: <strong>${escapeEmailHtml(input.email)}</strong><br/>
Name: ${escapeEmailHtml(input.displayName)}<br/>
Account type: ${escapeEmailHtml(input.roleLabel)}
</p>
<p style="margin:0;">Use the button below to set your password and activate your account.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: "Set your Automotive Brands password",
    bodyHtml,
    cta: { label: "Set your password", href: input.activationUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
