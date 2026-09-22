export function emailReceiptKey(messageId: string | null | undefined, uid: string | null | undefined): string | null {
  const mid = messageId?.trim() || null;
  const id = uid?.trim() || null;
  if (mid && id) return `${mid}|${id}`;
  if (id) return `|${id}`;
  if (mid) return `${mid}|`;
  return null;
}

/**
 * Same IMAP message iff UID matches (and Message-ID agrees when both exist).
 * Matching Message-ID with a different UID is NOT a duplicate (Autopart can reuse Message-ID).
 */
export function isDuplicateEmailReceipt(
  incoming: { messageId: string | null; uid: string },
  existing: { emailMessageId: string | null; emailUid: string | null },
): boolean {
  const incomingMid = incoming.messageId?.trim() || null;
  const existingMid = existing.emailMessageId?.trim() || null;
  const incomingUid = incoming.uid.trim() || null;
  const existingUid = existing.emailUid?.trim() || null;

  // UID is required. Matching Message-ID with a different UID is not a duplicate.
  if (!incomingUid || !existingUid) return false;
  if (incomingUid !== existingUid) return false;
  if (incomingMid && existingMid && incomingMid !== existingMid) return false;
  return true;
}

export function parseAllowedSenders(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((s) => s.trim().toLowerCase()).filter(Boolean);
  return String(raw ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function extractEmailAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  const value = (angle?.[1] ?? from).trim().toLowerCase();
  return value;
}

export function senderIsAllowed(from: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const fromLower = from.toLowerCase();
  const address = extractEmailAddress(from);
  return allowed.some((entry) => address === entry || fromLower.includes(entry));
}

export function normaliseAttachmentFilename(filename: string): string {
  return String(filename ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase();
}

export function attachmentStem(filename: string): string {
  const n = normaliseAttachmentFilename(filename);
  const ext = n.endsWith(".csv") ? ".csv" : n.endsWith(".txt") ? ".txt" : "";
  if (!ext) return n;
  return n.slice(0, -ext.length).replace(/\s*\(\d+\)\s*$/i, "").trim();
}

export function isTxtOrCsvAttachment(filename: string): boolean {
  const n = normaliseAttachmentFilename(filename);
  return n.endsWith(".txt") || n.endsWith(".csv");
}

export function filenameMatchesStockPattern(filename: string, pattern: string): boolean {
  if (!isTxtOrCsvAttachment(filename)) return false;
  const n = normaliseAttachmentFilename(filename);
  const p = normaliseAttachmentFilename(pattern || "231PO3NEW*.txt");
  if (!p) return false;
  if (n === p) return true;
  if (p.includes("*")) {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    if (new RegExp(`^${escaped}$`, "i").test(n)) return true;
  }
  const nStem = attachmentStem(filename);
  const pStem = attachmentStem(pattern);
  if (nStem === pStem) return true;
  if (n === `${pStem}.csv` || n === `${pStem}.txt`) return true;
  return n.includes("231po3new");
}

export const DEFAULT_STOCK_FILENAME_PATTERN = "231PO3NEW*.txt";

export type ImapSettingsValidationInput = {
  imapHost?: string | null;
  imapPort?: number;
  pollIntervalMinutes?: number;
  lookbackDays?: number;
  maxMessages?: number;
};

export function validateImapSettingsUpdate(input: ImapSettingsValidationInput): string | null {
  if (input.imapPort != null && (!Number.isInteger(input.imapPort) || input.imapPort < 1 || input.imapPort > 65535)) {
    return "IMAP port must be between 1 and 65535";
  }
  if (
    input.pollIntervalMinutes != null &&
    (!Number.isInteger(input.pollIntervalMinutes) || input.pollIntervalMinutes < 1 || input.pollIntervalMinutes > 24 * 60)
  ) {
    return "Poll interval must be between 1 and 1440 minutes";
  }
  if (input.lookbackDays != null && (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 1 || input.lookbackDays > 90)) {
    return "Lookback days must be between 1 and 90";
  }
  if (input.maxMessages != null && (!Number.isInteger(input.maxMessages) || input.maxMessages < 1 || input.maxMessages > 500)) {
    return "Max messages must be between 1 and 500";
  }
  if (input.imapHost !== undefined && input.imapHost != null && input.imapHost.trim().length > 255) {
    return "IMAP host is too long";
  }
  return null;
}
