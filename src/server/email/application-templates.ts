/**
 * Trade application / onboarding email body builders.
 * Use snapshot / application record data only — never invent activation tokens here.
 */

import { getServerEnv } from "@/server/env";
import { escapeEmailHtml, renderTransactionalEmailShell } from "@/server/email/shell";
import {
  emailAccountManagerCard,
  emailBulletList,
  emailHero,
  emailHtmlParagraph,
  emailNumberedList,
  emailParagraph,
  emailReferencePanel,
  emailSectionLabel,
  emailStatusCallout,
  firstNameFrom,
  type EmailAccountManager,
} from "@/server/email/layout";
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
  const first = firstNameFrom(snap.contactName);
  const subject = `We've received your Automotive Brands trade application ${snap.reference}`;
  const text = `TRADE APPLICATION RECEIVED

Thanks ${first}

We've received your application for:
${snap.companyName}

Reference: ${snap.reference}

WHAT HAPPENS NEXT
1. Our trade team reviews the application.
2. We'll contact you if we need any further information.
3. Once approved, you'll receive an activation email to set up your account.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Trade application received", `Thanks ${first}`)}
${emailParagraph(`We've received your application for ${snap.companyName}.`)}
${emailReferencePanel([
  { label: "Reference", value: snap.reference },
  { label: "Company", value: snap.companyName },
])}
${emailSectionLabel("What happens next")}
${emailNumberedList([
  "Our trade team reviews the application.",
  "We'll contact you if we need any further information.",
  "Once approved, you'll receive an activation email to set up your account.",
])}`;

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
  const text = `NEW TRADE APPLICATION

${snap.reference}
${snap.companyName}
${snap.contactName} <${snap.contactEmail}>

Review: ${adminUrl}

Automotive Brands`;

  const bodyHtml = `
${emailHero("New trade application", snap.reference)}
${emailReferencePanel([
  { label: "Company", value: snap.companyName },
  { label: "Contact", value: `${snap.contactName} <${snap.contactEmail}>` },
])}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
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
  const first = firstNameFrom(snap.contactName);
  const subject = `Additional information needed — Automotive Brands application ${snap.reference}`;
  const text = `WE NEED A LITTLE MORE INFORMATION

Hello ${first},

Application reference: ${snap.reference}
Company: ${snap.companyName}

Information requested:
${message}

Please reply to this email with the requested information.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("We need a little more information", `Hello ${first}`)}
${emailReferencePanel([
  { label: "Application reference", value: snap.reference },
  { label: "Company", value: snap.companyName },
])}
${emailStatusCallout("Information requested", message, "warning")}
${emailParagraph("Please reply to this email with the requested information.", true)}`;

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
  const first = firstNameFrom(snap.contactName);
  const subject = `Your Automotive Brands trade account is ready`;
  const activateBlock = activationUrl
    ? `\nUse the link below to activate your account and set your password:\n${activationUrl}\n`
    : "\nYou will receive a separate message with your activation link shortly.\n";
  const text = `YOUR TRADE ACCOUNT HAS BEEN APPROVED

Hello ${first},

Your application has been approved for ${snap.companyName}.
${snap.reference ? `Application reference: ${snap.reference}\n` : ""}
The next step is to activate your account and set your password.
${activateBlock}
Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Your trade account has been approved", `Hello ${first}`)}
${emailReferencePanel([
  { label: "Company", value: snap.companyName },
  ...(snap.reference ? [{ label: "Application reference", value: snap.reference }] : []),
])}
${emailParagraph("Your application has been approved. The next step is to activate your account and set your password.")}
${
  activationUrl
    ? ""
    : emailParagraph("You will receive a separate message with your activation link shortly.", true)
}`;

  const html = renderTransactionalEmailShell({
    preheader: `Trade account approved — ${snap.companyName}`,
    bodyHtml,
    ...(activationUrl ? { cta: { label: "Activate your account", href: activationUrl } } : {}),
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildTradeApplicationRejectedBodies(
  snap: TradeApplicationEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const message = snap.customerMessage?.trim();
  const first = firstNameFrom(snap.contactName);
  const subject = `Update on your Automotive Brands trade application ${snap.reference}`;
  const text = `APPLICATION UPDATE

Hello ${first},

Thank you for your interest in Automotive Brands.

Application reference: ${snap.reference}
Company: ${snap.companyName}

After reviewing your application, we are unable to approve a trade account at this time.
${message ? `\n${message}\n` : ""}
If you have questions, please reply to this email.

Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Application update", `Hello ${first}`)}
${emailReferencePanel([
  { label: "Reference", value: snap.reference },
  { label: "Company", value: snap.companyName },
])}
${emailParagraph("Thank you for your interest in Automotive Brands. After reviewing your application, we are unable to approve a trade account at this time.")}
${message ? emailStatusCallout("Message", message, "neutral") : ""}
${emailParagraph("If you have questions, please reply to this email.", true)}`;

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
    accountManager?: EmailAccountManager | null;
  },
  footer?: EmailFooterMeta,
) {
  const portalUrl = `${appBaseUrl()}/portal`;
  const first = firstNameFrom(snap.contactName);
  const subject = `Welcome to Automotive Brands — account activated`;
  const amLines = snap.accountManager?.name?.trim()
    ? [
        "",
        "YOUR ACCOUNT MANAGER",
        snap.accountManager.name.trim(),
        snap.accountManager.jobTitle?.trim() || null,
        snap.accountManager.email?.trim() || null,
        snap.accountManager.phone?.trim() || null,
        snap.accountManager.mobile?.trim() || null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n") + "\n"
    : "";
  const text = `WELCOME TO AUTOMOTIVE BRANDS

Hi ${first},

Your trade account for ${snap.companyName} is now active.

YOU CAN NOW
• View your trade pricing
• Browse the trade catalogue
• Place B2B orders online
• View your orders
• Access and respond to quotations
• Manage your trade account

Open the trade portal:
${portalUrl}
${amLines}
Automotive Brands
https://automotivebrands.co.uk`;

  const bodyHtml = `
${emailHero("Welcome to Automotive Brands", `Hi ${first},`)}
${emailHtmlParagraph(
  `Your trade account for <strong>${escapeEmailHtml(snap.companyName)}</strong> is now active.`,
)}
${emailSectionLabel("You can now")}
${emailBulletList([
  "View your trade pricing",
  "Browse the trade catalogue",
  "Place B2B orders online",
  "View your orders",
  "Access and respond to quotations",
  "Manage your trade account",
])}
${emailAccountManagerCard(snap.accountManager)}`;

  const html = renderTransactionalEmailShell({
    preheader: "Your trade account is active",
    bodyHtml,
    cta: { label: "Open trade portal", href: portalUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}
