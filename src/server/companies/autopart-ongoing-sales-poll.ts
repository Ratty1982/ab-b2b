/**
 * IMAP poll for ongoing 504 + TRM21QC — reuses stock IMAP connection.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import {
  emailReceiptKey,
  parseAllowedSenders,
  senderIsAllowed,
} from "@/domain/stock-email";
import { fetchUnprocessedStockEmails, archiveProcessedMessage } from "@/server/stock/imap";
import { loadImapRuntimeConfig, getOrCreateImapSettings } from "@/server/stock/settings";
import {
  detectAutopart504Filename,
  isAutopart504Report,
} from "@/domain/autopart-504";
import {
  detectAutopartTrm21qcFilename,
  isAutopartTrm21qcReport,
} from "@/domain/autopart-trm21qc";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
  getOngoingSalesFeedSettings,
} from "@/server/companies/autopart-ongoing-sales";

export type OngoingPollResult = {
  ran: boolean;
  reason?: string;
  processed504: number;
  processedTrm21qc: number;
  duplicatesIgnored: number;
  unknownAttachments: number;
  errors: string[];
};

function is504cFilename(filename: string): boolean {
  return filename.toUpperCase().includes("504C");
}

export function classifyOngoingSalesAttachment(
  filename: string,
  text: string,
): "504" | "TRM21QC" | "504C" | "UNKNOWN" {
  if (is504cFilename(filename) || text.toUpperCase().includes("(504C)")) return "504C";
  if (detectAutopartTrm21qcFilename(filename) || isAutopartTrm21qcReport(text)) {
    if (isAutopartTrm21qcReport(text)) return "TRM21QC";
  }
  if (detectAutopart504Filename(filename) || isAutopart504Report(text)) {
    if (isAutopart504Report(text)) return "504";
  }
  return "UNKNOWN";
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
    return {
      ran: false,
      reason:
        "Ongoing 504/TRM21QC feed is DISABLED / NOT CONFIGURED. Use manual upload, or configure Autopart email and enable the feed.",
      processed504: 0,
      processedTrm21qc: 0,
      duplicatesIgnored: 0,
      unknownAttachments: 0,
      errors: [],
    };
  }

  const base = await loadImapRuntimeConfig();
  if (!base) {
    throw new AuthError("IMAP is not configured (host/username/password required)", "CONFIG", 400);
  }

  const imapSettings = await getOrCreateImapSettings();
  const allowed = parseAllowedSenders(
    settings.allowedSender?.trim() ? settings.allowedSender : imapSettings.allowedSenderEmails,
  );

  // Broaden attachment gate vs stock 231PO3NEW pattern so 504/TRM21QC CSVs are fetched.
  const config = {
    ...base,
    filenamePattern: "*.csv",
    allowedSenders: allowed.length ? allowed : base.allowedSenders,
  };

  const receipts = await prisma.stockEmailReceipt.findMany({
    where: { consumed: true },
    select: { receiptKey: true, emailUid: true },
    take: 5000,
  });
  const processedReceiptKeys = new Set(receipts.map((r) => r.receiptKey));
  const processedUids = new Set(receipts.map((r) => r.emailUid));

  const emails = await fetchUnprocessedStockEmails(config, {
    processedReceiptKeys,
    processedUids,
  });

  const result: OngoingPollResult = {
    ran: true,
    processed504: 0,
    processedTrm21qc: 0,
    duplicatesIgnored: 0,
    unknownAttachments: 0,
    errors: [],
  };

  for (const email of emails) {
    if (!senderIsAllowed(email.from, config.allowedSenders)) continue;
    for (const att of email.attachments) {
      const text = att.content.toString("utf8");
      const kind = classifyOngoingSalesAttachment(att.filename, text);
      if (kind === "504C") continue; // keep legacy 504C path separate
      if (kind === "UNKNOWN") {
        result.unknownAttachments += 1;
        continue;
      }

      const fileHash = createHash("sha256").update(text).digest("hex");
      const prior = await prisma.autopartCustomerImportRun.findFirst({
        where: {
          fileHash,
          type: kind === "504" ? "ONGOING_504" : "ONGOING_TRM21QC",
          status: "COMMITTED",
        },
        select: { id: true },
      });
      if (prior) {
        result.duplicatesIgnored += 1;
        continue;
      }

      try {
        if (kind === "504") {
          await confirmAutopart504Import(actorUserId, {
            text,
            filename: att.filename,
            source,
          });
          result.processed504 += 1;
        } else {
          await confirmAutopartTrm21qcImport(actorUserId, {
            text,
            filename: att.filename,
            source,
          });
          result.processedTrm21qc += 1;
        }
        if (imapSettings.autoArchiveProcessedEmails) {
          await archiveProcessedMessage(config, email.uid).catch(() => undefined);
        }
        const key = emailReceiptKey(email.messageId, email.uid);
        if (key) {
          await prisma.stockEmailReceipt
            .upsert({
              where: { receiptKey: key },
              create: {
                receiptKey: key,
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
        result.errors.push(
          `${att.filename}: ${err instanceof Error ? err.message : "import failed"}`,
        );
      }
    }
  }

  await prisma.autopartOngoingSalesFeedSettings.update({
    where: { id: "default" },
    data: {
      lastPolledAt: new Date(),
      lastError: result.errors.length ? result.errors.slice(0, 3).join("; ") : null,
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
