/**
 * Saved-quote PDF download and salesperson copy email.
 * The PDF is generated in memory from the quote row. It is not stored at a public URL.
 * Email to myself never uses the customer address.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import type { EmailAdapter } from "@/infra/email";
import { renderTransactionalEmailShell } from "@/server/email/shell";
import { attemptSend, upsertPendingEmail } from "@/server/email/transactional";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { getQuoteForStaff } from "@/server/quotes/service";
import { renderQuotePdf, type QuotePdfSource } from "@/server/quotes/quote-pdf";

const quoteIdSchema = z.object({ id: z.string().cuid() });
const emailSchema = quoteIdSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(120),
});

function linesFromUnknown(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return ["name", "email", "phone", "line1", "line2", "town", "county", "postcode", "country"]
    .map((key) => (typeof record[key] === "string" ? record[key].trim() : ""))
    .filter(Boolean);
}

async function loadPdfSource(actorUserId: string, quoteId: string): Promise<{
  quote: { id: string; companyId: string; quoteNumber: string };
  source: QuotePdfSource;
}> {
  await getQuoteForStaff(actorUserId, quoteId);
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      company: { select: { name: true, phone: true, primaryEmail: true, paymentTerms: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  const prepared =
    quote.preparedBySnapshot && typeof quote.preparedBySnapshot === "object"
      ? (quote.preparedBySnapshot as Record<string, unknown>)
      : null;
  const preparedText = (key: string) => {
    const value = prepared?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const salespersonLines = [
    preparedText("name") ?? quote.salesRepNameSnapshot,
    preparedText("jobTitle"),
    preparedText("email"),
    preparedText("phone"),
    preparedText("mobile"),
    quote.salesRepCodeSnapshot ? `Rep code ${quote.salesRepCodeSnapshot}` : null,
  ].filter((line): line is string => Boolean(line && line.trim()));

  return {
    quote: { id: quote.id, companyId: quote.companyId, quoteNumber: quote.quoteNumber },
    source: {
      quoteNumber: quote.quoteNumber,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      currency: quote.currency,
      subtotal: String(quote.subtotal),
      deliveryTotal: String(quote.deliveryTotal),
      vatTotal: String(quote.vatTotal),
      grandTotal: String(quote.grandTotal),
      customerNotes: quote.customerNotes ?? quote.notes,
      internalNotes: quote.internalNotes,
      poNumber: quote.poNumber,
      paymentTerms: quote.paymentTermsSnapshot ?? quote.company.paymentTerms,
      companyName: quote.company.name,
      companyPhone: quote.company.phone,
      companyEmail: quote.company.primaryEmail,
      contactLines: linesFromUnknown(quote.contactSnapshot),
      addressLines: linesFromUnknown(quote.deliveryAddress),
      salespersonLines,
      items: quote.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        qty: item.qty,
        unitPrice: String(item.customerUnitPrice),
        lineTotal: String(item.lineTotal),
      })),
    },
  };
}

export async function downloadQuotePdf(actorUserId: string, raw: unknown) {
  const input = quoteIdSchema.parse(raw);
  const { quote, source } = await loadPdfSource(actorUserId, input.id);
  const bytes = await renderQuotePdf(source);
  await recordAuditEvent({
    action: "quote.pdf_downloaded",
    entityType: "Quote",
    entityId: quote.id,
    actorUserId,
    companyId: quote.companyId,
    metadata: { quoteNumber: quote.quoteNumber },
  });
  return {
    filename: `${quote.quoteNumber}.pdf`,
    contentType: "application/pdf",
    pdfBase64: Buffer.from(bytes).toString("base64"),
  };
}

export async function emailQuoteCopyToSelf(
  actorUserId: string,
  raw: unknown,
  adapter?: EmailAdapter,
) {
  const input = emailSchema.parse(raw);
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { email: true, emailVerified: true, name: true },
  });
  if (!user?.email) {
    throw new AuthError("Your account has no email address.", "EMAIL_UNAVAILABLE", 400);
  }
  if (!user.emailVerified) {
    throw new AuthError(
      "Your account email is not verified, so this quotation was not emailed.",
      "EMAIL_UNVERIFIED",
      400,
    );
  }

  const { quote, source } = await loadPdfSource(actorUserId, input.id);
  const toEmail = user.email.toLowerCase();
  const subject = `Quote ${quote.quoteNumber} — ${source.companyName}`;
  const text = [
    `A copy of quotation ${quote.quoteNumber} for ${source.companyName} is attached.`,
    "This message was sent only to your verified account email. The customer was not emailed.",
    "The attached PDF uses the saved quotation prices and quantities.",
  ].join("\n");
  const html = renderTransactionalEmailShell({
    preheader: `${quote.quoteNumber} for ${source.companyName}`,
    variant: "internal",
    bodyHtml: `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1f2c;">A copy of quotation <strong>${quote.quoteNumber}</strong> for <strong>${escapeHtml(source.companyName)}</strong> is attached.</p><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1f2c;">This message was sent only to your verified account email. The customer was not emailed.</p>`,
  });
  const bytes = await renderQuotePdf(source);
  const idempotencyKey = `QUOTE_COPY_TO_SELF:${quote.id}:${actorUserId}:${input.idempotencyKey}`;
  const pending = await upsertPendingEmail({
    purpose: "QUOTE_COPY_TO_SELF",
    toEmail,
    subject,
    textBody: text,
    htmlBody: html,
    entityType: "Quote",
    entityId: quote.id,
    idempotencyKey,
  });
  const sent = await attemptSend(pending.id, adapter, {
    attachments: [
      {
        filename: `${quote.quoteNumber}.pdf`,
        contentType: "application/pdf",
        content: bytes,
      },
    ],
  });

  if (sent.ok) {
    if (!sent.alreadySent) {
      await recordAuditEvent({
        action: "quote.emailed_to_self",
        entityType: "Quote",
        entityId: quote.id,
        actorUserId,
        companyId: quote.companyId,
        metadata: { quoteNumber: quote.quoteNumber, toEmail },
      });
    }
    return {
      sent: true as const,
      alreadySent: sent.alreadySent,
      toEmail,
      message: sent.alreadySent
        ? `Already emailed to ${toEmail}.`
        : `Quotation ${quote.quoteNumber} emailed to ${toEmail}.`,
    };
  }

  return {
    sent: false as const,
    alreadySent: false,
    toEmail,
    message: sent.deferred
      ? "Email delivery is turned off, so the quotation was not sent. The request is saved and can be retried."
      : `The quotation could not be emailed. ${sent.detail ?? "Try again."}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
