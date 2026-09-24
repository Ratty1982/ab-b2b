/**
 * Trade application / onboarding email body builders.
 * Use snapshot / application record data only — never invent activation tokens here.
 */

import { getServerEnv } from "@/server/env";
import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";
import type { EmailFooterMeta } from "@/server/orders/email";

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

export type TradeApplicationEmailSnapshot = {
  applicationId: string;
  reference: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  customerMessage?: string | null;
  activationPath?: string | null;
  adminApplicationUrl?: string;
};

export function buildTradeApplicationReceivedBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const subject = `We've received your Automotive Brands trade application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Thank you for applying for an Automotive Brands trade account.

We have received application ${snap.reference} for ${snap.companyName}.
Our team will review your application and contact you shortly.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(snap.contactName)},</p>
<p style="margin:0 0 16px;">Thank you for applying for an Automotive Brands trade account.</p>
<p style="margin:0 0 16px;">We have received application <strong>${escapeEmailHtml(snap.reference)}</strong> for
<strong>${escapeEmailHtml(snap.companyName)}</strong>.</p>
<p style="margin:0;">Our team will review your application and contact you shortly.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Application ${snap.reference} received`,
    bodyHtml,
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeApplicationInternalBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const adminUrl =
    snap.adminApplicationUrl ?? `${appBaseUrl()}/admin/applications/${snap.applicationId}`;
  const subject = `New trade application ${snap.reference} — ${snap.companyName}`;
  const text = `New trade application

Reference: ${snap.reference}
Company: ${snap.companyName}
Contact: ${snap.contactName} <${snap.contactEmail}>

Review: ${adminUrl}

Automotive Brands`;

  const bodyHtml = `
<p style="margin:0 0 16px;"><strong>New trade application</strong></p>
<p style="margin:0 0 12px;">
Reference: ${escapeEmailHtml(snap.reference)}<br/>
Company: ${escapeEmailHtml(snap.companyName)}<br/>
Contact: ${escapeEmailHtml(snap.contactName)} &lt;${escapeEmailHtml(snap.contactEmail)}&gt;
</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `New application ${snap.reference}`,
    bodyHtml,
    cta: { label: "Review application", href: adminUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeApplicationMoreInfoBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const message =
    snap.customerMessage?.trim() ||
    "Please provide additional information so we can continue reviewing your application.";
  const subject = `Additional information needed — Automotive Brands application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Regarding your Automotive Brands trade application ${snap.reference} for ${snap.companyName}:

${message}

Please reply to this email with the requested information.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(snap.contactName)},</p>
<p style="margin:0 0 16px;">Regarding your Automotive Brands trade application
<strong>${escapeEmailHtml(snap.reference)}</strong> for
<strong>${escapeEmailHtml(snap.companyName)}</strong>:</p>
<p style="margin:0 0 16px;">${escapeEmailHtml(message)}</p>
<p style="margin:0;">Please reply to this email with the requested information.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `More information needed — ${snap.reference}`,
    bodyHtml,
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeApplicationApprovedBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const activationUrl = snap.activationPath
    ? snap.activationPath.startsWith("http")
      ? snap.activationPath
      : `${appBaseUrl()}${snap.activationPath.startsWith("/") ? "" : "/"}${snap.activationPath}`
    : null;
  const subject = `Your Automotive Brands trade account is ready to activate`;
  const activateBlock = activationUrl
    ? `\nActivate your account:\n${activationUrl}\n`
    : "\nYour activation link will follow separately if not included here.\n";
  const text = `Hello ${snap.contactName},

Good news — your Automotive Brands trade application ${snap.reference} for ${snap.companyName} has been approved.
${activateBlock}
Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(snap.contactName)},</p>
<p style="margin:0 0 16px;">Good news — your Automotive Brands trade application
<strong>${escapeEmailHtml(snap.reference)}</strong> for
<strong>${escapeEmailHtml(snap.companyName)}</strong> has been approved.</p>
${
  activationUrl
    ? `<p style="margin:0;">Use the button below to activate your account and set your password.</p>`
    : `<p style="margin:0;">Your activation link will follow separately if not included here.</p>`
}`;

  const html = renderTransactionalEmailShell({
    preheader: `Trade account approved — ${snap.companyName}`,
    bodyHtml,
    ...(activationUrl
      ? { cta: { label: "Activate your account", href: activationUrl } }
      : {}),
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeApplicationRejectedBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const message = snap.customerMessage?.trim();
  const subject = `Update on your Automotive Brands trade application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Thank you for your interest in Automotive Brands.

After reviewing application ${snap.reference} for ${snap.companyName}, we are unable to approve a trade account at this time.
${message ? `\n${message}\n` : ""}
If you have questions, please reply to this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(snap.contactName)},</p>
<p style="margin:0 0 16px;">Thank you for your interest in Automotive Brands.</p>
<p style="margin:0 0 16px;">After reviewing application <strong>${escapeEmailHtml(snap.reference)}</strong> for
<strong>${escapeEmailHtml(snap.companyName)}</strong>, we are unable to approve a trade account at this time.</p>
${message ? `<p style="margin:0 0 16px;">${escapeEmailHtml(message)}</p>` : ""}
<p style="margin:0;">If you have questions, please reply to this email.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Application ${snap.reference} update`,
    bodyHtml,
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeAccountActivatedBodies(
  snap: {
    contactName: string;
    contactEmail: string;
    companyName: string;
  },
  footer?: EmailFooterMeta,
) {
  const portalUrl = `${appBaseUrl()}/portal`;
  const subject = `Welcome to Automotive Brands — account activated`;
  const text = `Hello ${snap.contactName},

Your Automotive Brands trade account for ${snap.companyName} is now active.

Sign in to the trade portal:
${portalUrl}

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(snap.contactName)},</p>
<p style="margin:0 0 16px;">Your Automotive Brands trade account for <strong>${escapeEmailHtml(snap.companyName)}</strong> is now active.</p>
<p style="margin:0;">You can sign in to the trade portal using the button below.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: "Your trade account is active",
    bodyHtml,
    cta: { label: "Open trade portal", href: portalUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
