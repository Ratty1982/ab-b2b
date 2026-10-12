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
import { createHash } from "node:crypto";
import {
  decodeAutopart216vBytes,
  isAutopart216vFilename,
  isAutopart216vReport,
  isCommitted216vSnapshotHash,
} from "@/domain/autopart-216v";
import {
  confirmAutopart216vImport,
  requireBackorderManage,
} from "@/server/purchasing/backorder-import";

export type BackorderMailboxDecision =
  | { action: "import" }
  | { action: "duplicate"; reason: string }
  | { action: "skip"; reason: string };

/**
 * Duplicate identity is the 216V file hash of a committed snapshot.
 * A receipt written by 504, TRM21QC or 231PO3NEW must not skip a new 216V file.
 */
export function decide216vMailboxAttachment(input: {
  is216v: boolean;
  contentHash: string;
  committedHashes: ReadonlySet<string>;
}): BackorderMailboxDecision {
  if (!input.is216v) return { action: "skip", reason: "Not a 216V report" };
  if (isCommitted216vSnapshotHash(input.contentHash, input.committedHashes)) {
    return { action: "duplicate", reason: "This file is already a committed 216V snapshot" };
  }
  return { action: "import" };
}

export type BackorderPollResult = {
  ran: boolean;
  reason?: string;
  processed: number;
  duplicatesIgnored: number;
  skipped: number;
  errors: string[];
  /** Visible per-attachment notes (skipped, duplicate, imported, failed). */
  notes: string[];
};

export function summarise216vPoll(result: BackorderPollResult): string {
  if (!result.ran && result.reason) return result.reason;
  const parts: string[] = [];
  if (result.processed) {
    parts.push(`Imported ${result.processed} 216V report${result.processed === 1 ? "" : "s"}`);
  }
  if (result.duplicatesIgnored) {
    parts.push(
      `${result.duplicatesIgnored} duplicate file${result.duplicatesIgnored === 1 ? "" : "s"} left the current snapshot unchanged`,
    );
  }
  if (result.skipped)
    parts.push(`${result.skipped} attachment${result.skipped === 1 ? "" : "s"} skipped`);
  if (result.errors.length) parts.push(result.errors.slice(0, 5).join("; "));
  if (!parts.length) return "Mailbox poll finished. No 216V attachment was found.";
  const notes = result.notes.filter(Boolean).slice(0, 6);
  const head = `${parts.join(". ")}.`;
  return notes.length ? `${head} ${notes.join(" | ")}` : head;
}

function emptyResult(partial?: Partial<BackorderPollResult>): BackorderPollResult {
  return {
    ran: false,
    processed: 0,
    duplicatesIgnored: 0,
    skipped: 0,
    errors: [],
    notes: [],
    ...partial,
  };
}

export function isAutopart216vAttachmentCandidate(filename: string, mime?: string | null): boolean {
  if (!isTxtOrCsvAttachment(filename)) return false;
  const n = normaliseAttachmentFilename(filename);
  const mimeBase = String(mime ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    mimeBase &&
    !/text\/|csv|excel|octet-stream/.test(mimeBase) &&
    mimeBase !== "application/vnd.ms-excel"
  ) {
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
  const committedHashes = new Set(
    (
      await prisma.autopartBackorderSnapshot.findMany({
        where: { status: "COMMITTED" },
        select: { fileHash: true },
      })
    ).map((row) => row.fileHash),
  );

  for (const email of input.emails) {
    for (const att of email.attachments) {
      const label = att.filename || "(unnamed)";
      if (!isAutopart216vAttachmentCandidate(att.filename, att.contentType)) {
        result.skipped += 1;
        result.notes.push(`${label}: not a CSV/TXT candidate`);
        continue;
      }
      const bytes = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
      const text = decodeAutopart216vBytes(bytes).text;
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const decision = decide216vMailboxAttachment({
        is216v: isAutopart216vReport(text, att.filename),
        contentHash,
        committedHashes,
      });
      if (decision.action === "skip") {
        result.skipped += 1;
        result.notes.push(`${label}: ${decision.reason}`);
        continue;
      }
      if (decision.action === "duplicate") {
        result.duplicatesIgnored += 1;
        result.notes.push(`${label}: ${decision.reason}`);
        continue;
      }
      try {
        const imported = await confirmAutopart216vImport(input.actorUserId, {
          bytesBase64: bytes.toString("base64"),
          filename: att.filename,
          source: input.source,
          receivedAt: email.receivedAt,
        });
        if (imported.duplicate) {
          result.duplicatesIgnored += 1;
          result.notes.push(`${label}: already imported, snapshot unchanged`);
          committedHashes.add(imported.fileHash);
        } else {
          result.processed += 1;
          result.notes.push(
            `${label}: imported ${imported.orderCount} orders, ${imported.outstandingQty} units, £${imported.outstandingValue}`,
          );
          committedHashes.add(imported.fileHash);
        }
        const attKey = attachmentReceiptKey(email.messageId, email.uid, att.filename);
        if (attKey) {
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
        result.errors.push(`${label}: ${message}`);
        result.notes.push(`${label}: ${message}`);
      }
    }
  }
  return result;
}

async function run216vMailboxPoll(
  actorUserId: string | null,
  source: "EMAIL" | "SCHEDULE",
): Promise<BackorderPollResult> {
  const settings = await prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  if (!settings.enabled || !settings.configured) {
    const disabled = emptyResult({
      ran: false,
      reason:
        "216V backorder feed is DISABLED. Enable it under Purchasing → Backorders (purchasing.manage).",
    });
    await prisma.autopartBackorderFeedSettings.update({
      where: { id: "default" },
      data: {
        lastPolledAt: new Date(),
        lastError: disabled.reason ?? "216V backorder feed is disabled.",
      },
    });
    return disabled;
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
  const summary = summarise216vPoll(result);
  const failed =
    result.errors.length > 0 || (result.processed === 0 && result.duplicatesIgnored === 0);
  await prisma.autopartBackorderFeedSettings.update({
    where: { id: "default" },
    data: {
      lastPolledAt: new Date(),
      lastError: failed ? summary : null,
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
