/**
 * Trade application / onboarding email body builders.
 * Use snapshot / application record data only — never invent activation tokens here.
 */

import { getServerEnv } from "@/server/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

export function buildTradeApplicationReceivedBodies(snap: TradeApplicationEmailSnapshot) {
  const subject = `We've received your Automotive Brands trade application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Thank you for applying for an Automotive Brands trade account.

We have received application ${snap.reference} for ${snap.companyName}.
Our team will review your application and contact you shortly.

Automotive Brands`;
  const html = `<p>Hello ${escapeHtml(snap.contactName)},</p>
<p>Thank you for applying for an Automotive Brands trade account.</p>
<p>We have received application <strong>${escapeHtml(snap.reference)}</strong> for
<strong>${escapeHtml(snap.companyName)}</strong>.</p>
<p>Our team will review your application and contact you shortly.</p>
<p>Automotive Brands</p>`;
  return { subject, text, html };
}

export function buildTradeApplicationInternalBodies(snap: TradeApplicationEmailSnapshot) {
  const adminUrl = snap.adminApplicationUrl ?? `${appBaseUrl()}/admin/applications/${snap.applicationId}`;
  const subject = `New trade application ${snap.reference} — ${snap.companyName}`;
  const text = `New trade application

Reference: ${snap.reference}
Company: ${snap.companyName}
Contact: ${snap.contactName} <${snap.contactEmail}>

Review: ${adminUrl}

Automotive Brands`;
  const html = `<p><strong>New trade application</strong></p>
<ul>
<li>Reference: ${escapeHtml(snap.reference)}</li>
<li>Company: ${escapeHtml(snap.companyName)}</li>
<li>Contact: ${escapeHtml(snap.contactName)} &lt;${escapeHtml(snap.contactEmail)}&gt;</li>
</ul>
<p><a href="${escapeHtml(adminUrl)}">Review application</a></p>
<p>Automotive Brands</p>`;
  return { subject, text, html };
}

export function buildTradeApplicationMoreInfoBodies(snap: TradeApplicationEmailSnapshot) {
  const message = snap.customerMessage?.trim() || "Please provide additional information so we can continue reviewing your application.";
  const subject = `Additional information needed — Automotive Brands application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Regarding your Automotive Brands trade application ${snap.reference} for ${snap.companyName}:

${message}

Please reply to this email with the requested information.

Automotive Brands`;
  const html = `<p>Hello ${escapeHtml(snap.contactName)},</p>
<p>Regarding your Automotive Brands trade application
<strong>${escapeHtml(snap.reference)}</strong> for
<strong>${escapeHtml(snap.companyName)}</strong>:</p>
<p>${escapeHtml(message)}</p>
<p>Please reply to this email with the requested information.</p>
<p>Automotive Brands</p>`;
  return { subject, text, html };
}

export function buildTradeApplicationApprovedBodies(snap: TradeApplicationEmailSnapshot) {
  const activationUrl = snap.activationPath
    ? snap.activationPath.startsWith("http")
      ? snap.activationPath
      : `${appBaseUrl()}${snap.activationPath.startsWith("/") ? "" : "/"}${snap.activationPath}`
    : null;
  const subject = `Your Automotive Brands trade account is approved — ${snap.companyName}`;
  const activateBlock = activationUrl
    ? `\nActivate your account:\n${activationUrl}\n`
    : "\nYour activation link will follow separately if not included here.\n";
  const text = `Hello ${snap.contactName},

Good news — your Automotive Brands trade application ${snap.reference} for ${snap.companyName} has been approved.
${activateBlock}
Automotive Brands`;
  const html = `<p>Hello ${escapeHtml(snap.contactName)},</p>
<p>Good news — your Automotive Brands trade application
<strong>${escapeHtml(snap.reference)}</strong> for
<strong>${escapeHtml(snap.companyName)}</strong> has been approved.</p>
${
  activationUrl
    ? `<p><a href="${escapeHtml(activationUrl)}">Activate your account</a></p>`
    : `<p>Your activation link will follow separately if not included here.</p>`
}
<p>Automotive Brands</p>`;
  return { subject, text, html };
}

export function buildTradeApplicationRejectedBodies(snap: TradeApplicationEmailSnapshot) {
  const message = snap.customerMessage?.trim();
  const subject = `Update on your Automotive Brands trade application ${snap.reference}`;
  const text = `Hello ${snap.contactName},

Thank you for your interest in Automotive Brands.

After reviewing application ${snap.reference} for ${snap.companyName}, we are unable to approve a trade account at this time.
${message ? `\n${message}\n` : ""}
If you have questions, please reply to this email.

Automotive Brands`;
  const html = `<p>Hello ${escapeHtml(snap.contactName)},</p>
<p>Thank you for your interest in Automotive Brands.</p>
<p>After reviewing application <strong>${escapeHtml(snap.reference)}</strong> for
<strong>${escapeHtml(snap.companyName)}</strong>, we are unable to approve a trade account at this time.</p>
${message ? `<p>${escapeHtml(message)}</p>` : ""}
<p>If you have questions, please reply to this email.</p>
<p>Automotive Brands</p>`;
  return { subject, text, html };
}

export function buildTradeAccountActivatedBodies(snap: {
  contactName: string;
  contactEmail: string;
  companyName: string;
}) {
  const portalUrl = `${appBaseUrl()}/portal`;
  const subject = `Welcome to Automotive Brands — account activated`;
  const text = `Hello ${snap.contactName},

Your Automotive Brands trade account for ${snap.companyName} is now active.

Sign in to the trade portal:
${portalUrl}

Automotive Brands`;
  const html = `<p>Hello ${escapeHtml(snap.contactName)},</p>
<p>Your Automotive Brands trade account for <strong>${escapeHtml(snap.companyName)}</strong> is now active.</p>
<p><a href="${escapeHtml(portalUrl)}">Open the trade portal</a></p>
<p>Automotive Brands</p>`;
  return { subject, text, html };
}
