/**
 * IMAP poll for Autopart 216V. Reuses stock mailbox credentials.
 * Content detection is authoritative — filename is never enough.
 * Does not archive messages (other Autopart feeds may share the mailbox).
 */

import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { attachmentReceiptKey, parseAllowedSenders } from "@/domain/stock-email";
import { fetchUnprocessedStockEmails } from "@/server/stock/imap";
import type { InboundStockEmail } from "@/server/stock/imap";
import { loadImapRuntimeConfig, getOrCreateImapSettings } from "@/server/stock/settings";
import { isTxtOrCsvAttachment, normaliseAttachmentFilename } from "@/domain/stock-email";
import { isAutopart216vFilename, isAutopart216vReport } from "@/domain/autopart-216v";
import { confirmAutopart216vImport, requireBackorderManage } from "@/server/purchasing/backorder-import";

export type BackorderPollResult = {
  ran: boolean;
  reason?: string;
  processed: number;
  duplicatesIgnored: number;
  skipped: number;
  errors: string[];
};

function emptyResult(partial?: Partial<BackorderPollResult>): BackorderPollResult {
  return { ran: false, processed: 0, duplicatesIgnored: 0, skipped: 0, errors: [], ...partial };
}

export function isAutopart216vAttachmentCandidate(filename: string, mime?: string | null): boolean {
  if (!isTxtOrCsvAttachment(filename)) return false;
  const n = normaliseAttachmentFilename(filename);
  const mimeBase = String(mime ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mimeBase && !/text\/|csv|excel|octet-stream/.test(mimeBase) && mimeBase !== "application/vnd.ms-excel") {
    return false;
  }
  return isAutopart216vFilename(filename) || n.endsWith(".csv") || n.endsWith(".txt");
}

export async function process216vEmailBatch(input: {
  emails: InboundStockEmail[];
  actorUserId: string | null;
  source: "EMAIL" | "SCHEDULE";
}): Promise<BackorderPollResult> {
  const result = emptyResult({ ran: true });
  const handled = new Set(
    (
      await prisma.stockEmailReceipt.findMany({
        where: { consumed: true, receiptKey: { contains: "|att:" } },
        select: { receiptKey: true },
        take: 8000,
      })
    ).map((r) => r.receiptKey),
  );

  for (const email of input.emails) {
    for (const att of email.attachments) {
      if (!isAutopart216vAttachmentCandidate(att.filename, att.contentType)) {
        result.skipped += 1;
        continue;
      }
      const text = att.content.toString("utf8");
      if (!isAutopart216vReport(text, att.filename)) {
        result.skipped += 1;
        continue;
      }
      const attKey = attachmentReceiptKey(email.messageId, email.uid, att.filename);
      if (attKey && handled.has(attKey)) {
        result.duplicatesIgnored += 1;
        continue;
      }
      try {
        const imported = await confirmAutopart216vImport(input.actorUserId, {
          text,
          filename: att.filename,
          source: input.source,
          receivedAt: email.receivedAt,
        });
        if (imported.duplicate) result.duplicatesIgnored += 1;
        else result.processed += 1;
        if (attKey) {
          handled.add(attKey);
          await prisma.stockEmailReceipt
            .upsert({
              where: { receiptKey: attKey },
              create: {
                receiptKey: attKey,
                emailUid: email.uid,
                emailMessageId: email.messageId,
                fromAddress: email.from,
                subject: email.subject ?? "",
                receivedAt: email.receivedAt,
                consumed: true,
                attachmentFilename: att.filename,
              },
              update: { consumed: true, attachmentFilename: att.filename },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "216V import failed";
        result.errors.push(`${att.filename}: ${message}`);
      }
    }
  }
  return result;
}

async function run216vMailboxPoll(actorUserId: string | null, source: "EMAIL" | "SCHEDULE"): Promise<BackorderPollResult> {
  const settings = await prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  if (!settings.enabled || !settings.configured) {
    return emptyResult({
      ran: false,
      reason: "216V backorder feed is DISABLED. Enable it under Purchasing → Backorders (purchasing.manage).",
    });
  }
  const base = await loadImapRuntimeConfig();
  if (!base) {
    throw new AuthError("IMAP is not configured (host/username/password required)", "CONFIG", 400);
  }
  const imapSettings = await getOrCreateImapSettings();
  const allowed = parseAllowedSenders(
    settings.allowedSender?.trim() ? settings.allowedSender : imapSettings.allowedSenderEmails,
  );
  const config = {
    ...base,
    filenamePattern: "*",
    allowedSenders: allowed.length ? allowed : base.allowedSenders,
  };
  const receipts = await prisma.stockEmailReceipt.findMany({
    where: { consumed: true },
    select: { receiptKey: true, emailUid: true },
    take: 8000,
  });
  const emails = await fetchUnprocessedStockEmails(config, {
    processedReceiptKeys: new Set(receipts.map((r) => r.receiptKey)),
    processedUids: new Set(receipts.map((r) => r.emailUid)),
    skipConsumed: false,
    acceptAttachment: isAutopart216vAttachmentCandidate,
  });
  const result = await process216vEmailBatch({ emails, actorUserId, source });
  await prisma.autopartBackorderFeedSettings.update({
    where: { id: "default" },
    data: {
      lastPolledAt: new Date(),
      lastError: result.errors.length ? result.errors.slice(0, 5).join("; ") : null,
      ...(result.processed ? { lastSuccessAt: new Date() } : {}),
    },
  });
  return result;
}

export async function pollBackorderMailboxNow(actorUserId: string): Promise<BackorderPollResult> {
  await requireBackorderManage(actorUserId);
  return run216vMailboxPoll(actorUserId, "EMAIL");
}

export async function run216vScheduledPollIfEnabled(): Promise<BackorderPollResult> {
  return run216vMailboxPoll(null, "SCHEDULE");
}
