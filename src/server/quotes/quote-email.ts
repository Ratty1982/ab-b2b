/**
 * Quote transactional emails — QUOTE_SENT + internal decline notice.
 * Uses the shared Automotive Brands branded shell. Never includes Autopart
 * codes, margin, cost, pricing source, or internal notes.
 */
import { prisma } from "@/infra/database/client";
import { moneyToString, parseMoney } from "@/domain/money";
import { dateOnlyFromValidUntil } from "@/domain/quote";
import { getServerEnv } from "@/server/env";
import { getEmailFooterMeta } from "@/server/email/settings";
import { renderTransactionalEmailShell } from "@/server/email/shell";
import {
  emailAccountManagerCard,
  emailHero,
  emailParagraph,
  emailReferencePanel,
  type EmailAccountManager,
} from "@/server/email/layout";
import {
  safeAttemptDetailed,
  upsertPendingEmail,
  attemptSend,
} from "@/server/email/transactional";
import type { EmailFooterMeta } from "@/server/orders/email";

async function safeAttempt(emailId: string): Promise<boolean> {
  const result = await safeAttemptDetailed(emailId);
  return result.emailSent;
}

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

function formatGbp(raw: string): string {
  const m = parseMoney(raw);
  return m ? moneyToString(m, 2) : raw;
}

function formatValidUntil(d: Date | null): string {
  if (!d) return "—";
  const dateOnly = dateOnlyFromValidUntil(d);
  const [y, m, day] = dateOnly.split("-");
  return `${day}/${m}/${y}`;
}

export type QuoteSentEmailSnapshot = {
  quoteNumber: string;
  companyName: string;
  currency: string;
  grandTotal: string;
  expiresAt: Date | null;
  contactName: string;
  portalUrl: string;
  preparedBy: EmailAccountManager | null;
};

export type QuoteDeclinedEmailSnapshot = {
  quoteNumber: string;
  companyName: string;
  reason: string;
  adminUrl: string;
};

export function buildQuoteSentBodies(
  snap: QuoteSentEmailSnapshot,
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const validUntil = formatValidUntil(snap.expiresAt);
  const total = formatGbp(String(snap.grandTotal));
  const greeting = snap.contactName.trim() || "there";
  const prepared = snap.preparedBy?.name?.trim() ? snap.preparedBy : null;
  const preparedByLines: string[] = [];
  if (prepared?.name) {
    preparedByLines.push(`Prepared by: ${prepared.name}`);
    if (prepared.jobTitle) preparedByLines.push(prepared.jobTitle);
    if (prepared.email) preparedByLines.push(prepared.email);
    if (prepared.phone) preparedByLines.push(prepared.phone);
    if (prepared.mobile) preparedByLines.push(prepared.mobile);
  }

  const subject = `Your Automotive Brands quotation ${snap.quoteNumber}`;
  const text = [
    "YOUR QUOTATION IS READY",
    "",
    `Hello ${greeting},`,
    "",
    `Quote: ${snap.quoteNumber}`,
    `Prepared for: ${snap.companyName}`,
    `TOTAL: £${total} ${snap.currency} inc VAT`,
    `VALID UNTIL: ${validUntil}`,
    ...preparedByLines,
    "",
    `VIEW QUOTATION: ${snap.portalUrl}`,
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ].join("\n");

  const bodyHtml = `
${emailHero("Your quotation is ready", `Hello ${greeting}`)}
${emailReferencePanel([
  { label: "Quote", value: snap.quoteNumber },
  { label: "Prepared for", value: snap.companyName },
  { label: "Total", value: `£${total} ${snap.currency} inc VAT` },
  { label: "Valid until", value: validUntil },
])}
${emailParagraph("Open the quotation in your trade portal to accept or decline.")}
${emailAccountManagerCard(prepared, "Prepared by / your account manager")}`;

  const html = renderTransactionalEmailShell({
    preheader: `Quotation ${snap.quoteNumber} — valid until ${validUntil}`,
    bodyHtml,
    cta: { label: "View quotation", href: snap.portalUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export function buildQuoteDeclinedInternalBodies(
  snap: QuoteDeclinedEmailSnapshot,
  footer?: EmailFooterMeta,
): { subject: string; text: string; html: string } {
  const subject = `Quote declined ${snap.quoteNumber} — ${snap.companyName}`;
  const text = [
    "QUOTE DECLINED",
    "",
    `${snap.quoteNumber}`,
    snap.companyName,
    `Reason: ${snap.reason}`,
    "",
    `Open quote: ${snap.adminUrl}`,
  ].join("\n");

  const bodyHtml = `
${emailHero("Quote declined", snap.quoteNumber)}
${emailReferencePanel([
  { label: "Company", value: snap.companyName },
  { label: "Reason", value: snap.reason },
])}`;

  const html = renderTransactionalEmailShell({
    variant: "internal",
    preheader: `Quote ${snap.quoteNumber} declined`,
    bodyHtml,
    cta: { label: "Open quote", href: snap.adminUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });
  return { subject, text, html };
}

export async function sendQuoteSentEmail(quoteId: string, toEmail: string): Promise<boolean> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      company: { select: { name: true } },
      items: { select: { id: true }, take: 1 },
    },
  });
  if (!quote) return false;

  const footer = await getEmailFooterMeta();
  const contact = (quote.contactSnapshot ?? {}) as { name?: string | null };
  const greeting = contact.name?.trim() || "there";
  const portalUrl = `${appBaseUrl()}/portal/quotes/${quote.id}`;

  // Prefer historical prepared-by snapshot frozen at send; fall back to live AM.
  const preparedSnap =
    quote.preparedBySnapshot && typeof quote.preparedBySnapshot === "object"
      ? (quote.preparedBySnapshot as {
          name?: string | null;
          jobTitle?: string | null;
          email?: string | null;
          phone?: string | null;
          mobile?: string | null;
        })
      : null;
  let preparedByName = preparedSnap?.name?.trim() || quote.salesRepNameSnapshot?.trim() || null;
  let preparedJobTitle = preparedSnap?.jobTitle?.trim() || null;
  let preparedEmail = preparedSnap?.email?.trim() || null;
  let preparedPhone = preparedSnap?.phone?.trim() || null;
  let preparedMobile = preparedSnap?.mobile?.trim() || null;
  if (!preparedByName || (!preparedEmail && !preparedPhone && !preparedJobTitle)) {
    const { resolveAccountManagerForCompany, resolveAccountManagerForSalesRep } = await import(
      "@/server/sales/account-manager"
    );
    const am =
      (await resolveAccountManagerForCompany(quote.companyId)) ??
      (quote.salesRepIdSnapshot
        ? await resolveAccountManagerForSalesRep(quote.salesRepIdSnapshot)
        : null);
    preparedByName = preparedByName || am?.name || null;
    preparedJobTitle = preparedJobTitle || am?.jobTitle || null;
    preparedEmail = preparedEmail || am?.email || null;
    preparedPhone = preparedPhone || am?.phone || null;
    preparedMobile = preparedMobile || am?.mobile || null;
  }

  const { subject, text, html } = buildQuoteSentBodies(
    {
      quoteNumber: quote.quoteNumber,
      companyName: quote.company.name,
      currency: quote.currency,
      grandTotal: String(quote.grandTotal),
      expiresAt: quote.expiresAt,
      contactName: greeting,
      portalUrl,
      preparedBy: preparedByName
        ? {
            name: preparedByName,
            jobTitle: preparedJobTitle,
            email: preparedEmail,
            phone: preparedPhone,
            mobile: preparedMobile,
          }
        : null,
    },
    footer,
  );

  // First send uses stable key; resend after failure retries; successful prior
  // send creates a new outbox row so staff can resend without duplicating the quote.
  const existing = await prisma.transactionalEmail.findFirst({
    where: { purpose: "QUOTE_SENT", entityId: quoteId },
    orderBy: { createdAt: "desc" },
  });

  if (existing && existing.status !== "SENT") {
    await prisma.transactionalEmail.update({
      where: { id: existing.id },
      data: {
        toEmail: toEmail.toLowerCase(),
        subject,
        textBody: text,
        htmlBody: html,
        status: "PENDING",
        lastError: null,
      },
    });
    return safeAttempt(existing.id);
  }

  const idempotencyKey =
    existing?.status === "SENT"
      ? `QUOTE_SENT:${quoteId}:resend:${Date.now()}`
      : `QUOTE_SENT:${quoteId}`;

  const upsert = await upsertPendingEmail({
    purpose: "QUOTE_SENT",
    toEmail: toEmail.toLowerCase(),
    subject,
    textBody: text,
    htmlBody: html,
    entityType: "Quote",
    entityId: quoteId,
    idempotencyKey,
  });

  if (!upsert.created) {
    const row = await prisma.transactionalEmail.findUnique({ where: { id: upsert.id } });
    if (row?.status === "SENT") {
      const fresh = await upsertPendingEmail({
        purpose: "QUOTE_SENT",
        toEmail: toEmail.toLowerCase(),
        subject,
        textBody: text,
        htmlBody: html,
        entityType: "Quote",
        entityId: quoteId,
        idempotencyKey: `QUOTE_SENT:${quoteId}:resend:${Date.now()}`,
      });
      return safeAttempt(fresh.id);
    }
    if (row) {
      await attemptSend(row.id).catch(() => undefined);
      const after = await prisma.transactionalEmail.findUnique({ where: { id: row.id } });
      return after?.status === "SENT";
    }
  }

  return safeAttempt(upsert.id);
}

export async function sendQuoteDeclinedInternalEmail(quoteId: string): Promise<boolean> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { company: { select: { name: true, primaryEmail: true } } },
  });
  if (!quote) return false;

  // Prefer the assigned sales rep's user email when available.
  let toEmail: string | null = null;
  if (quote.salesRepIdSnapshot) {
    const rep = await prisma.salesRep.findUnique({
      where: { id: quote.salesRepIdSnapshot },
      select: { user: { select: { email: true } } },
    });
    toEmail = rep?.user?.email?.toLowerCase() ?? null;
  }
  if (!toEmail) {
    const envFallback = (process.env["TRADE_ORDER_NOTIFICATION_EMAIL"] ?? "").trim().toLowerCase();
    toEmail = envFallback || null;
  }
  if (!toEmail) return false;

  const footer = await getEmailFooterMeta();
  const reason = quote.declineReason?.trim() || "No reason provided";
  const adminUrl = `${appBaseUrl()}/sales/quotes/${quote.id}`;
  const { subject, text, html } = buildQuoteDeclinedInternalBodies(
    {
      quoteNumber: quote.quoteNumber,
      companyName: quote.company.name,
      reason,
      adminUrl,
    },
    footer,
  );

  const upsert = await upsertPendingEmail({
    purpose: "QUOTE_DECLINED_INTERNAL",
    toEmail,
    subject,
    textBody: text,
    htmlBody: html,
    entityType: "Quote",
    entityId: quoteId,
    idempotencyKey: `QUOTE_DECLINED_INTERNAL:${quoteId}`,
  });
  return safeAttempt(upsert.id);
}
