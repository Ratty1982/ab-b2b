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
import {
  escapeEmailHtml,
  renderTransactionalEmailShell,
} from "@/server/email/shell";
import {
  safeAttemptDetailed,
  upsertPendingEmail,
  attemptSend,
} from "@/server/email/transactional";

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
  const validUntil = formatValidUntil(quote.expiresAt);
  const total = formatGbp(String(quote.grandTotal));

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
  const preparedByLines: string[] = [];
  if (preparedByName) {
    preparedByLines.push(`Prepared by: ${preparedByName}`);
    if (preparedJobTitle) preparedByLines.push(preparedJobTitle);
    if (preparedEmail) preparedByLines.push(preparedEmail);
    if (preparedPhone) preparedByLines.push(preparedPhone);
    if (preparedMobile) preparedByLines.push(preparedMobile);
  }
  const preparedByHtml = preparedByName
    ? `<br/><strong>Prepared by:</strong> ${escapeEmailHtml(preparedByName)}${
        preparedJobTitle ? ` — ${escapeEmailHtml(preparedJobTitle)}` : ""
      }${preparedEmail ? `<br/>${escapeEmailHtml(preparedEmail)}` : ""}${
        preparedPhone ? `<br/>${escapeEmailHtml(preparedPhone)}` : ""
      }${preparedMobile ? `<br/>${escapeEmailHtml(preparedMobile)}` : ""}`
    : "";

  const subject = `Your Automotive Brands quotation ${quote.quoteNumber}`;
  const text = [
    `Hello ${greeting},`,
    "",
    `Please find your Automotive Brands quotation ${quote.quoteNumber} for ${quote.company.name}.`,
    "",
    `Valid until: ${validUntil}`,
    `Total (inc VAT): £${total} ${quote.currency}`,
    ...preparedByLines,
    "",
    `VIEW QUOTE: ${portalUrl}`,
    "",
    "If you have questions, reply to this email or contact your account manager.",
    "",
    "Automotive Brands",
    "https://automotivebrands.co.uk",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello ${escapeEmailHtml(greeting)},</p>
<p style="margin:0 0 16px;">Please find your Automotive Brands quotation <strong>${escapeEmailHtml(quote.quoteNumber)}</strong> for <strong>${escapeEmailHtml(quote.company.name)}</strong>.</p>
<p style="margin:0 0 8px;"><strong>Valid until:</strong> ${escapeEmailHtml(validUntil)}<br/>
<strong>Total (inc VAT):</strong> £${escapeEmailHtml(total)} ${escapeEmailHtml(quote.currency)}
${preparedByHtml}</p>
<p style="margin:16px 0 0;">Open the quotation in your trade portal to accept or decline.</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Quotation ${quote.quoteNumber} — valid until ${validUntil}`,
    bodyHtml,
    cta: { label: "View quote", href: portalUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

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
  const subject = `Quote declined ${quote.quoteNumber} — ${quote.company.name}`;
  const reason = quote.declineReason?.trim() || "No reason provided";
  const adminUrl = `${appBaseUrl()}/sales/quotes/${quote.id}`;

  const text = [
    `Quotation ${quote.quoteNumber} for ${quote.company.name} was declined.`,
    `Reason: ${reason}`,
    "",
    `Open quote: ${adminUrl}`,
  ].join("\n");

  const bodyHtml = `
<p style="margin:0 0 16px;">Quotation <strong>${escapeEmailHtml(quote.quoteNumber)}</strong> for <strong>${escapeEmailHtml(quote.company.name)}</strong> was declined.</p>
<p style="margin:0 0 8px;"><strong>Reason:</strong> ${escapeEmailHtml(reason)}</p>`;

  const html = renderTransactionalEmailShell({
    preheader: `Quote ${quote.quoteNumber} declined`,
    bodyHtml,
    cta: { label: "Open quote", href: adminUrl },
    footer: footer ?? { fromName: "Automotive Brands" },
  });

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
