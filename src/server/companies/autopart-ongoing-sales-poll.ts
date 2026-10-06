/**
 * IMAP poll for ongoing 504 + TRM21QC — reuses stock IMAP connection.
 *
 * TXT/CSV/MIME are candidate filters only. Content detection is authoritative.
 * Email-level consumed receipts must not permanently hide an unprocessed 504 TXT.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { attachmentReceiptKey, emailReceiptKey, parseAllowedSenders } from "@/domain/stock-email";
import { fetchUnprocessedStockEmails, archiveProcessedMessage } from "@/server/stock/imap";
import type { InboundStockEmail } from "@/server/stock/imap";
import { loadImapRuntimeConfig, getOrCreateImapSettings } from "@/server/stock/settings";
import {
  classifyOngoingSalesAttachment,
  detectOngoingSalesAttachmentType,
  formatOngoingSalesAttachmentDiagnostic,
  isOngoingSalesAttachmentCandidate,
  skipReasonForDetectedType,
  type OngoingSalesAttachmentDiagnostic,
} from "@/domain/autopart-ongoing-sales-attachment";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
  getOngoingSalesFeedSettings,
} from "@/server/companies/autopart-ongoing-sales";

export { classifyOngoingSalesAttachment };

export type OngoingPollResult = {
  ran: boolean;
  reason?: string;
  processed504: number;
  processedTrm21qc: number;
  duplicatesIgnored: number;
  unknownAttachments: number;
  errors: string[];
  attachments: OngoingSalesAttachmentDiagnostic[];
};

function emptyPollResult(partial?: Partial<OngoingPollResult>): OngoingPollResult {
  return {
    ran: false,
    processed504: 0,
    processedTrm21qc: 0,
    duplicatesIgnored: 0,
    unknownAttachments: 0,
    errors: [],
    attachments: [],
    ...partial,
  };
}

function acceptOngoingImapAttachment(filename: string, contentType: string | null): boolean {
  return isOngoingSalesAttachmentCandidate({ filename, mime: contentType }).candidate;
}

async function persistAttachmentReceipt(input: {
  email: InboundStockEmail;
  filename: string;
  consumed: boolean;
}) {
  const key = attachmentReceiptKey(input.email.messageId, input.email.uid, input.filename);
  if (!key) return;
  await prisma.stockEmailReceipt
    .upsert({
      where: { receiptKey: key },
      create: {
        receiptKey: key,
        emailUid: input.email.uid,
        emailMessageId: input.email.messageId,
        fromAddress: input.email.from,
        subject: input.email.subject ?? "",
        receivedAt: input.email.receivedAt,
        consumed: input.consumed,
        attachmentFilename: input.filename,
      },
      update: { consumed: input.consumed, attachmentFilename: input.filename },
    })
    .catch(() => undefined);
}

async function persistEmailReceiptIfFullyHandled(input: {
  email: InboundStockEmail;
  handledAllCandidates: boolean;
}) {
  if (!input.handledAllCandidates) return;
  const key = emailReceiptKey(input.email.messageId, input.email.uid);
  if (!key) return;
  await prisma.stockEmailReceipt
    .upsert({
      where: { receiptKey: key },
      create: {
        receiptKey: key,
        emailUid: input.email.uid,
        emailMessageId: input.email.messageId,
        fromAddress: input.email.from,
        subject: input.email.subject ?? "",
        receivedAt: input.email.receivedAt,
        consumed: true,
        attachmentFilename: input.email.attachments[0]?.filename ?? "",
      },
      update: { consumed: true },
    })
    .catch(() => undefined);
}

export async function processOngoingSalesEmailBatch(input: {
  emails: InboundStockEmail[];
  actorUserId: string | null;
  source: "EMAIL" | "SCHEDULE";
  autoArchive: boolean;
  archive?: (uid: string) => Promise<void>;
}): Promise<OngoingPollResult> {
  const result = emptyPollResult({ ran: true });
  const handledAttachmentKeys = new Set(
    (
      await prisma.stockEmailReceipt.findMany({
        where: { consumed: true, receiptKey: { contains: "|att:" } },
        select: { receiptKey: true },
        take: 8000,
      })
    ).map((r) => r.receiptKey),
  );

  for (const email of input.emails) {
    let pendingCandidates = 0;
    let handledCandidates = 0;
    let importedThisEmail = 0;

    for (const att of email.attachments) {
      const mime = att.contentType ?? null;
      const candidate = isOngoingSalesAttachmentCandidate({ filename: att.filename, mime });
      if (!candidate.candidate) {
        result.attachments.push({
          filename: att.filename || "(unnamed)",
          mime,
          candidate: false,
          candidateType: "NOT_CANDIDATE",
          detectedType: "NOT_EXAMINED",
          result: "skipped",
          skipReason: candidate.reason,
        });
        result.unknownAttachments += 1;
        continue;
      }

      pendingCandidates += 1;
      const attKey = attachmentReceiptKey(email.messageId, email.uid, att.filename);
      const text = att.content.toString("utf8");
      const detected = detectOngoingSalesAttachmentType(att.filename, text);
      const baseDiag = {
        filename: att.filename,
        mime,
        candidate: true as const,
        candidateType: candidate.hintedType ?? "UNKNOWN",
        detectedType: detected,
      };

      if (detected === "LEGACY_504C" || detected === "UNKNOWN") {
        result.unknownAttachments += detected === "UNKNOWN" ? 1 : 0;
        result.attachments.push({
          ...baseDiag,
          result: "skipped",
          skipReason: skipReasonForDetectedType(detected),
        });
        continue;
      }

      const fileHash = createHash("sha256").update(text).digest("hex");
      const prior = await prisma.autopartCustomerImportRun.findFirst({
        where: {
          fileHash,
          type: detected === "ONGOING_504" ? "ONGOING_504" : "ONGOING_TRM21QC",
          status: "COMMITTED",
        },
        select: { id: true },
      });
      if (prior || (attKey && handledAttachmentKeys.has(attKey))) {
        result.duplicatesIgnored += 1;
        handledCandidates += 1;
        result.attachments.push({ ...baseDiag, result: "duplicate", skipReason: null });
        if (attKey) handledAttachmentKeys.add(attKey);
        await persistAttachmentReceipt({ email, filename: att.filename, consumed: true });
        continue;
      }

      try {
        if (detected === "ONGOING_504") {
          await confirmAutopart504Import(input.actorUserId, {
            text,
            filename: att.filename,
            source: input.source,
          });
          result.processed504 += 1;
        } else {
          await confirmAutopartTrm21qcImport(input.actorUserId, {
            text,
            filename: att.filename,
            source: input.source,
          });
          result.processedTrm21qc += 1;
        }
        importedThisEmail += 1;
        handledCandidates += 1;
        result.attachments.push({ ...baseDiag, result: "imported", skipReason: null });
        if (attKey) handledAttachmentKeys.add(attKey);
        await persistAttachmentReceipt({ email, filename: att.filename, consumed: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "import failed";
        result.errors.push(`${att.filename}: ${message}`);
        result.attachments.push({
          ...baseDiag,
          result: "failed",
          skipReason: message,
        });
      }
    }

    const handledAllCandidates = pendingCandidates > 0 && handledCandidates === pendingCandidates;
    await persistEmailReceiptIfFullyHandled({ email, handledAllCandidates });
    if (handledAllCandidates && importedThisEmail > 0 && input.autoArchive && input.archive) {
      await input.archive(email.uid).catch(() => undefined);
    }
  }

  return result;
}

async function runOngoingSalesMailboxPoll(
  actorUserId: string | null,
  source: "EMAIL" | "SCHEDULE",
): Promise<OngoingPollResult> {
  const settings = await prisma.autopartOngoingSalesFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  if (!settings.enabled || !settings.configured) {
    return emptyPollResult({
      ran: false,
      reason:
        "Ongoing 504/TRM21QC feed is DISABLED / NOT CONFIGURED. Use manual upload, or configure Autopart email and enable the feed.",
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
  const processedReceiptKeys = new Set(receipts.map((r) => r.receiptKey));
  const processedUids = new Set(receipts.map((r) => r.emailUid));

  const emails = await fetchUnprocessedStockEmails(config, {
    processedReceiptKeys,
    processedUids,
    skipConsumed: false,
    acceptAttachment: acceptOngoingImapAttachment,
  });

  const result = await processOngoingSalesEmailBatch({
    emails,
    actorUserId,
    source,
    autoArchive: imapSettings.autoArchiveProcessedEmails,
    archive: (uid) => archiveProcessedMessage(config, uid),
  });

  const diagnosticText = result.attachments
    .map((row) => formatOngoingSalesAttachmentDiagnostic(row))
    .slice(0, 20)
    .join("\n\n");
  const hasSkips = result.attachments.some(
    (row) => row.result === "skipped" || row.result === "failed",
  );
  const lastError = result.errors.length
    ? result.errors.slice(0, 5).join("; ")
    : hasSkips
      ? diagnosticText
      : null;

  await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: {
      lastPolledAt: new Date(),
      lastError,
      ...(result.processed504 ? { lastSuccess504At: new Date() } : {}),
      ...(result.processedTrm21qc ? { lastSuccessTrm21qcAt: new Date() } : {}),
    },
  });

  return result;
}

/** Admin Poll Now — requires RBAC via settings getter. */
export async function pollOngoingSalesMailboxNow(actorUserId: string): Promise<OngoingPollResult> {
  await getOngoingSalesFeedSettings(actorUserId);
  return runOngoingSalesMailboxPoll(actorUserId, "EMAIL");
}

/** In-app schedule tick — no interactive actor. */
export async function runOngoingSalesScheduledPollIfEnabled(): Promise<OngoingPollResult> {
  return runOngoingSalesMailboxPoll(null, "SCHEDULE");
}
