/**
 * Internal staff notifications for trade account approval / activation.
 * Never include activation tokens, password-reset tokens, or private login links.
 */

import { formatCreditLimitGbp } from "@/domain/credit-limit";
import { getServerEnv } from "@/server/env";
import { escapeEmailHtml, renderTransactionalEmailShell } from "@/server/email/shell";
import {
  emailHero,
  emailParagraph,
  emailReferencePanel,
  emailSectionLabel,
  emailStatusCallout,
} from "@/server/email/layout";
import type { EmailFooterMeta } from "@/server/orders/email";

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

export type MissingAutopartCodeEmailSnapshot = {
  applicationId: string;
  reference: string;
  companyName: string;
  tradingName: string | null;
  contactName: string;
  submittedAt: string;
  adminApplicationUrl: string;
};

export function buildMissingAutopartCodeInternalBodies(
  snap: MissingAutopartCodeEmailSnapshot,
  footer?: EmailFooterMeta,
) {
  const subject = "ACTION REQUIRED — Check MAM before applying for credit";
  const tradingLine = snap.tradingName?.trim()
    ? `Trading name: ${snap.tradingName.trim()}\n`
    : "";
  const text = `ACTION REQUIRED — Check MAM before applying for credit

A new trade application has been received without an Autopart customer code.

Please check MAM Autopart to establish whether this customer already exists before applying for credit or creating a new customer account.

Company: ${snap.companyName}
${tradingLine}Contact: ${snap.contactName}
Application reference: ${snap.reference}
Submission date: ${snap.submittedAt}

Review: ${snap.adminApplicationUrl}

Automotive Brands`;

  const bodyHtml = `
${emailHero("ACTION REQUIRED — Check MAM", "Missing Autopart customer code")}
${emailParagraph(
  "A new trade application has been received without an Autopart customer code.",
)}
${emailParagraph(
  "Please check MAM Autopart to establish whether this customer already exists before applying for credit or creating a new customer account.",
)}
${emailReferencePanel([
  { label: "Company", value: snap.companyName },
  ...(snap.tradingName?.trim()
    ? [{ label: "Trading name", value: snap.tradingName.trim() }]
    : []),
  { label: "Contact", value: snap.contactName },
  { label: "Reference", value: snap.reference },
  { label: "Submitted", value: snap.submittedAt },
])}`;

  const html = renderTransactionalEmailShell({
    preheader: `Missing Autopart code — ${snap.reference}`,
    bodyHtml,
    cta: { label: "Review application", href: snap.adminApplicationUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export type TradeAccountApprovedInternalSnapshot = {
  companyId: string;
  companyName: string;
  accountNumber: string | null;
  authorisedByName: string;
  approvedAt: string;
  accountStatus: string;
  creditLimit: string | null;
  paymentTerms: string | null;
  customerApprovalSummary: string;
  source: "TRADE_APPLICATION" | "CUSTOMER_ACTIVATION" | "CUSTOMER_WIZARD";
  applicationReference?: string | null;
};

export function buildTradeAccountApprovedInternalBodies(
  snap: TradeAccountApprovedInternalSnapshot,
  footer?: EmailFooterMeta,
) {
  const customerUrl = `${appBaseUrl()}/admin/customers/${snap.companyId}`;
  const creditDisplay = formatCreditLimitGbp(snap.creditLimit);
  const subject = `Trade account authorised — ${snap.companyName}`;
  const creditLine = creditDisplay ? `Agreed credit limit: ${creditDisplay}\n` : "";
  const termsLine = snap.paymentTerms?.trim()
    ? `Payment terms: ${snap.paymentTerms.trim()}\n`
    : "";
  const refLine = snap.applicationReference
    ? `Application reference: ${snap.applicationReference}\n`
    : "";
  const accountLine = snap.accountNumber
    ? `Account reference: ${snap.accountNumber}\n`
    : `Customer id: ${snap.companyId}\n`;

  const text = `TRADE ACCOUNT AUTHORISED

Company: ${snap.companyName}
${accountLine}${refLine}Authorised by: ${snap.authorisedByName}
Approval timestamp: ${snap.approvedAt}
Account status: ${snap.accountStatus}
${creditLine}${termsLine}
Customer-facing approval (safe copy — no activation tokens):
${snap.customerApprovalSummary}

Customer record: ${customerUrl}

Automotive Brands`;

  const panel = [
    { label: "Company", value: snap.companyName },
    {
      label: "Account",
      value: snap.accountNumber ?? snap.companyId,
    },
    ...(snap.applicationReference
      ? [{ label: "Application", value: snap.applicationReference }]
      : []),
    { label: "Authorised by", value: snap.authorisedByName },
    { label: "Approved at", value: snap.approvedAt },
    { label: "Status", value: snap.accountStatus },
    ...(creditDisplay ? [{ label: "Credit limit", value: creditDisplay }] : []),
    ...(snap.paymentTerms?.trim()
      ? [{ label: "Payment terms", value: snap.paymentTerms.trim() }]
      : []),
  ];

  const bodyHtml = `
${emailHero("Trade account authorised", escapeEmailHtml(snap.companyName))}
${emailReferencePanel(panel)}
${emailSectionLabel("Customer-facing approval (safe copy)")}
${emailStatusCallout("Summary", snap.customerApprovalSummary, "neutral")}
${emailParagraph("Activation tokens and private login links are omitted from this internal copy.", true)}`;

  const html = renderTransactionalEmailShell({
    preheader: `Account authorised — ${snap.companyName}`,
    bodyHtml,
    cta: { label: "Open customer record", href: customerUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export const MISSING_AUTOPART_CODE_NOTIFY_EMAIL = "pl@automotivebrands.co.uk";
