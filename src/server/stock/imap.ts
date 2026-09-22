import { AuthError } from "@/server/rbac/guards";
import type { ImapRuntimeConfig } from "@/server/stock/settings";
import { filenameMatchesStockPattern, senderIsAllowed } from "@/domain/stock-email";

export type EmailAttachmentPayload = {
  filename: string;
  content: Buffer;
};

export type InboundStockEmail = {
  uid: string;
  messageId: string | null;
  from: string;
  subject: string;
  receivedAt: Date;
  attachments: EmailAttachmentPayload[];
};

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox?: string;
};

const CONNECT_TIMEOUT_MS = 20_000;
const OPERATION_TIMEOUT_MS = 90_000;

export async function testImapConnection(config: ImapConnectionConfig): Promise<{ ok: true; mailbox: string }> {
  const client = await connectImap(config);
  try {
    const mailbox = config.mailbox ?? "INBOX";
    const lock = await client.getMailboxLock(mailbox);
    lock.release();
    return { ok: true, mailbox };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function fetchUnprocessedStockEmails(
  config: ImapRuntimeConfig,
  opts: {
    processedReceiptKeys: Set<string>;
    processedUids: Set<string>;
  },
): Promise<InboundStockEmail[]> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: 30_000,
    socketTimeout: OPERATION_TIMEOUT_MS,
  });
  await client.connect();
  const out: InboundStockEmail[] = [];
  try {
    const mailbox = config.mailbox || "INBOX";
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date();
      since.setDate(since.getDate() - Math.max(1, config.lookbackDays));
      since.setHours(0, 0, 0, 0);
      const searchResult = await client.search({ since }, { uid: true });
      const uids = (Array.isArray(searchResult) ? searchResult : [])
        .map((uid) => Number(uid))
        .filter((uid) => Number.isFinite(uid))
        .sort((a, b) => b - a)
        .slice(0, Math.max(1, config.maxMessages));

      for (const uid of uids) {
        const uidKey = String(uid);
        const msg = await client.fetchOne(
          String(uid),
          { source: true, envelope: true, internalDate: true },
          { uid: true },
        );
        const source = msg && typeof msg === "object" && "source" in msg ? (msg as { source?: Buffer }).source : null;
        if (!source) continue;
        const parsed = await simpleParser(source);
        const from = String(parsed.from?.text ?? "").trim();
        const subject = String(parsed.subject ?? "").trim();
        const messageId = String(parsed.messageId ?? "").trim() || null;
        const { emailReceiptKey } = await import("@/domain/stock-email");
        const receiptKey = emailReceiptKey(messageId, uidKey);
        if (receiptKey && opts.processedReceiptKeys.has(receiptKey)) continue;
        if (!messageId && opts.processedUids.has(uidKey)) continue;
        if (!senderIsAllowed(from, config.allowedSenders)) continue;

        const attachments: EmailAttachmentPayload[] = [];
        for (const att of parsed.attachments ?? []) {
          const fn = String(att.filename ?? "").trim();
          if (!filenameMatchesStockPattern(fn, config.filenamePattern)) continue;
          attachments.push({
            filename: fn,
            content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
          });
        }
        if (!attachments.length) continue;
        out.push({
          uid: uidKey,
          messageId,
          from,
          subject,
          receivedAt: new Date(parsed.date ?? Date.now()),
          attachments,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return out;
}

export async function archiveProcessedMessage(config: ImapConnectionConfig, uid: string): Promise<void> {
  const client = await connectImap(config);
  try {
    const mailbox = config.mailbox ?? "INBOX";
    const lock = await client.getMailboxLock(mailbox);
    try {
      const folders = ["Processed", "Archive", "INBOX.Processed"];
      for (const folder of folders) {
        try {
          await client.messageMove(uid, folder, { uid: true });
          return;
        } catch {
          /* try next folder */
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function connectImap(config: ImapConnectionConfig) {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: 30_000,
    socketTimeout: OPERATION_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

export function throwImapUnavailable(error: unknown): never {
  const message = error instanceof Error ? error.message : "IMAP unavailable";
  throw new AuthError(message, "UPSTREAM", 502);
}
