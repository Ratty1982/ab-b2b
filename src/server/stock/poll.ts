import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { is231Po3NewReport } from "@/domain/stock-parse-native";
import {
  DEFAULT_STOCK_FILENAME_PATTERN,
  emailReceiptKey,
  filenameMatchesStockPattern,
  parseAllowedSenders,
  senderIsAllowed,
} from "@/domain/stock-email";
import {
  archiveProcessedMessage,
  fetchUnprocessedStockEmails,
  testImapConnection,
  type InboundStockEmail,
} from "@/server/stock/imap";
import {
  getOrCreateImapSettings,
  loadImapRuntimeConfig,
  recordImapPollOutcome,
  toPublicImapSettings,
} from "@/server/stock/settings";
import { AUTOPART_FEED_SOURCE } from "@/domain/stock";

export type EmailFeedSelection = {
  email: InboundStockEmail;
  filename: string;
  text: string;
};

export function select231Po3NewAttachment(
  email: InboundStockEmail,
  filenamePattern: string,
): { filename: string; text: string } | null {
  for (const att of email.attachments) {
    if (!filenameMatchesStockPattern(att.filename, filenamePattern)) continue;
    const text = att.content.toString("utf8");
    if (!is231Po3NewReport(text)) continue;
    return { filename: att.filename, text };
  }
  return null;
}

export function pickNewestValidFeed(
  emails: InboundStockEmail[],
  filenamePattern: string,
): EmailFeedSelection | null {
  const newestFirst = [...emails].sort((a, b) => {
    const byDate = b.receivedAt.getTime() - a.receivedAt.getTime();
    if (byDate !== 0) return byDate;
    return Number(b.uid) - Number(a.uid);
  });
  for (const email of newestFirst) {
    const att = select231Po3NewAttachment(email, filenamePattern);
    if (att) return { email, filename: att.filename, text: att.text };
  }
  return null;
}

async function loadProcessedKeys() {
  const rows = await prisma.stockEmailReceipt.findMany({
    where: { consumed: true },
    select: { receiptKey: true, emailUid: true, emailMessageId: true },
    take: 5000,
  });
  const processedReceiptKeys = new Set(rows.map((row) => row.receiptKey));
  const processedUids = new Set(rows.map((row) => row.emailUid));
  return { processedReceiptKeys, processedUids, receipts: rows };
}

export async function testImapConnectionForOps(): Promise<{ ok: true; message: string; mailbox: string }> {
  const config = await loadImapRuntimeConfig();
  if (!config) {
    throw new AuthError("IMAP host, username, and password are required", "CONFIG", 400);
  }
  try {
    const result = await testImapConnection({
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      password: config.password,
      mailbox: config.mailbox,
    });
    return { ok: true, message: "Connection successful. Mailbox accessible.", mailbox: result.mailbox };
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP connection failed";
    throw new AuthError(message, "UPSTREAM", 502);
  }
}

function filterUnprocessedEmails(
  emails: InboundStockEmail[],
  allowedSenders: string[],
  processedReceiptKeys: Set<string>,
  processedUids: Set<string>,
): InboundStockEmail[] {
  return emails.filter((email) => {
    if (!senderIsAllowed(email.from, allowedSenders)) return false;
    const key = emailReceiptKey(email.messageId, email.uid);
    if (key && processedReceiptKeys.has(key)) return false;
    if (processedUids.has(email.uid)) return false;
    return true;
  });
}

export async function discoverEmailFeed(opts?: {
  emails?: InboundStockEmail[];
}): Promise<
  | { found: false; reason: string; emailsExamined: number }
  | { found: true; selection: EmailFeedSelection; emailsExamined: number }
> {
  const settings = await getOrCreateImapSettings();
  const config = await loadImapRuntimeConfig();
  const filenamePattern = config?.filenamePattern ?? settings.attachmentFilenamePattern ?? DEFAULT_STOCK_FILENAME_PATTERN;
  const allowedSenders = config?.allowedSenders ?? parseAllowedSenders(settings.allowedSenderEmails);
  const { processedReceiptKeys, processedUids } = await loadProcessedKeys();

  let emails: InboundStockEmail[];
  if (opts?.emails) {
    emails = filterUnprocessedEmails(opts.emails, allowedSenders, processedReceiptKeys, processedUids);
  } else {
    if (!config) {
      return { found: false, reason: "IMAP is not configured", emailsExamined: 0 };
    }
    try {
      emails = await fetchUnprocessedStockEmails(config, { processedReceiptKeys, processedUids });
    } catch (error) {
      const message = error instanceof Error ? error.message : "IMAP unavailable";
      await recordImapPollOutcome({ error: message });
      return { found: false, reason: `IMAP unavailable: ${message}`, emailsExamined: 0 };
    }
  }
  const selection = pickNewestValidFeed(emails, filenamePattern);
  if (!selection) {
    await recordImapPollOutcome({ error: emails.length ? "No valid 231PO3NEW attachment" : "No unprocessed stock email" });
    return {
      found: false,
      reason: emails.length ? "No valid 231PO3NEW attachment in recent mail" : "No unprocessed stock email",
      emailsExamined: emails.length,
    };
  }
  await recordImapPollOutcome({
    error: null,
    lastEmailFrom: selection.email.from,
    lastEmailSubject: selection.email.subject,
    lastEmailUid: selection.email.uid,
    lastAttachmentFilename: selection.filename,
    lastEmailReceivedAt: selection.email.receivedAt,
  });
  return { found: true, selection, emailsExamined: emails.length };
}

export async function persistReceipt(input: {
  email: InboundStockEmail;
  filename: string;
  consumed: boolean;
  runId?: string | null;
}) {
  const key = emailReceiptKey(input.email.messageId, input.email.uid);
  if (!key) return;
  await prisma.stockEmailReceipt.upsert({
    where: { receiptKey: key },
    create: {
      receiptKey: key,
      emailUid: input.email.uid,
      emailMessageId: input.email.messageId,
      fromAddress: input.email.from,
      subject: input.email.subject,
      receivedAt: input.email.receivedAt,
      attachmentFilename: input.filename,
      consumed: input.consumed,
      runId: input.runId ?? null,
    },
    update: {
      ...(input.consumed ? { consumed: true } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      attachmentFilename: input.filename,
    },
  });
}

export async function markSupersededConsumed(emails: InboundStockEmail[], keepUid: string) {
  for (const email of emails) {
    if (email.uid === keepUid) continue;
    await persistReceipt({ email, filename: email.attachments[0]?.filename ?? "", consumed: true });
  }
}

export async function importFromImap(input: {
  dryRun: boolean;
  trigger: "manual" | "schedule" | "api";
  actorUserId?: string | null;
  emails?: InboundStockEmail[];
}) {
  await getOrCreateImapSettings();
  const discovered = await discoverEmailFeed(input.emails ? { emails: input.emails } : undefined);
  if (!discovered.found) {
    return {
      runId: null as string | null,
      status: "SUCCESS" as const,
      dryRun: input.dryRun,
      source: `${AUTOPART_FEED_SOURCE}:imap`,
      rowsRead: 0,
      matched: 0,
      wouldUpdate: 0,
      updated: 0,
      unchanged: 0,
      unmatched: 0,
      invalid: 0,
      duplicates: 0,
      errorSummary: discovered.reason,
      emailsExamined: discovered.emailsExamined,
    };
  }

  const { applyStockFeed } = await import("@/server/stock/service");
  const result = await applyStockFeed({
    text: discovered.selection.text,
    bytes: Buffer.byteLength(discovered.selection.text),
    dryRun: input.dryRun,
    trigger: input.trigger,
    ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
    sourceLabel: `${AUTOPART_FEED_SOURCE}:imap:${discovered.selection.filename}`,
  });

  if (!input.dryRun && (result.status === "SUCCESS" || result.status === "PARTIAL")) {
    await persistReceipt({
      email: discovered.selection.email,
      filename: discovered.selection.filename,
      consumed: true,
      runId: result.runId,
    });
    if (input.emails) {
      await markSupersededConsumed(input.emails, discovered.selection.email.uid);
    }
    const runtime = await loadImapRuntimeConfig();
    if (runtime?.autoArchive) {
      await archiveProcessedMessage(runtime, discovered.selection.email.uid).catch(() => undefined);
    }
  } else if (input.dryRun) {
    await persistReceipt({
      email: discovered.selection.email,
      filename: discovered.selection.filename,
      consumed: false,
      runId: result.runId,
    });
  }

  return { ...result, emailsExamined: discovered.emailsExamined, attachmentFilename: discovered.selection.filename };
}

export async function imapStatusForOverview() {
  return toPublicImapSettings();
}
