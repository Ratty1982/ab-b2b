import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { decryptImapPassword, encryptImapPassword } from "@/server/stock/imap-secret";
import { DEFAULT_STOCK_FILENAME_PATTERN, parseAllowedSenders, validateImapSettingsUpdate } from "@/domain/stock-email";

export const IMAP_SETTINGS_ID = "singleton";

export type ImapPublicSettings = {
  sourceType: "email";
  enabled: boolean;
  configured: boolean;
  inboundEmailAddress: string;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string | null;
  hasImapPassword: boolean;
  passwordFromEnv: boolean;
  mailbox: string;
  allowedSenderEmails: string[];
  attachmentFilenamePattern: string;
  pollIntervalMinutes: number;
  lookbackDays: number;
  maxMessages: number;
  autoArchiveProcessedEmails: boolean;
  lastPollAt: string | null;
  lastPollError: string | null;
  lastEmailFrom: string | null;
  lastEmailSubject: string | null;
  lastEmailUid: string | null;
  lastAttachmentFilename: string | null;
  lastEmailReceivedAt: string | null;
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export async function getOrCreateImapSettings() {
  return prisma.autopartImapSettings.upsert({
    where: { id: IMAP_SETTINGS_ID },
    create: { id: IMAP_SETTINGS_ID },
    update: {},
  });
}

export function resolveImapPassword(encrypted: string | null | undefined): string | null {
  const fromEnv = env("AUTOPART_STOCK_IMAP_PASSWORD");
  if (fromEnv) return fromEnv;
  return decryptImapPassword(encrypted);
}

export async function toPublicImapSettings(): Promise<ImapPublicSettings> {
  const row = await getOrCreateImapSettings();
  const envPassword = Boolean(env("AUTOPART_STOCK_IMAP_PASSWORD"));
  const host = env("AUTOPART_STOCK_IMAP_HOST") ?? row.imapHost;
  const user = env("AUTOPART_STOCK_IMAP_USER") ?? row.imapUsername;
  const password = resolveImapPassword(row.imapPasswordEncrypted);
  return {
    sourceType: "email",
    enabled: row.enabled || env("AUTOPART_STOCK_SOURCE") === "email",
    configured: Boolean(host && user && password),
    inboundEmailAddress: row.inboundEmailAddress,
    imapHost: host,
    imapPort: Number(env("AUTOPART_STOCK_IMAP_PORT") ?? row.imapPort) || 993,
    imapSecure: env("AUTOPART_STOCK_IMAP_SECURE") === "false" ? false : row.imapSecure,
    imapUsername: user,
    hasImapPassword: Boolean(password),
    passwordFromEnv: envPassword,
    mailbox: env("AUTOPART_STOCK_IMAP_MAILBOX") ?? row.mailbox ?? "INBOX",
    allowedSenderEmails: parseAllowedSenders(env("AUTOPART_STOCK_IMAP_ALLOWED_SENDERS") ?? row.allowedSenderEmails),
    attachmentFilenamePattern: env("AUTOPART_STOCK_IMAP_FILENAME_PATTERN") ?? row.attachmentFilenamePattern ?? DEFAULT_STOCK_FILENAME_PATTERN,
    pollIntervalMinutes: Number(env("AUTOPART_STOCK_SCHEDULE_MINUTES") ?? row.pollIntervalMinutes) || 15,
    lookbackDays: row.lookbackDays,
    maxMessages: row.maxMessages,
    autoArchiveProcessedEmails: row.autoArchiveProcessedEmails,
    lastPollAt: row.lastPollAt?.toISOString() ?? null,
    lastPollError: row.lastPollError,
    lastEmailFrom: row.lastEmailFrom,
    lastEmailSubject: row.lastEmailSubject,
    lastEmailUid: row.lastEmailUid,
    lastAttachmentFilename: row.lastAttachmentFilename,
    lastEmailReceivedAt: row.lastEmailReceivedAt?.toISOString() ?? null,
  };
}

export type ImapRuntimeConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  allowedSenders: string[];
  filenamePattern: string;
  lookbackDays: number;
  maxMessages: number;
  autoArchive: boolean;
};

export async function loadImapRuntimeConfig(): Promise<ImapRuntimeConfig | null> {
  const pub = await toPublicImapSettings();
  const row = await getOrCreateImapSettings();
  const password = resolveImapPassword(row.imapPasswordEncrypted);
  if (!pub.imapHost || !pub.imapUsername || !password) return null;
  return {
    enabled: pub.enabled || pub.configured,
    host: pub.imapHost,
    port: pub.imapPort,
    secure: pub.imapSecure,
    username: pub.imapUsername,
    password,
    mailbox: pub.mailbox,
    allowedSenders: pub.allowedSenderEmails,
    filenamePattern: pub.attachmentFilenamePattern,
    lookbackDays: row.lookbackDays,
    maxMessages: row.maxMessages,
    autoArchive: row.autoArchiveProcessedEmails,
  };
}

export type ImapSettingsUpdate = {
  enabled?: boolean;
  inboundEmailAddress?: string;
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  imapUsername?: string | null;
  imapPassword?: string;
  mailbox?: string;
  allowedSenderEmails?: string[] | string;
  attachmentFilenamePattern?: string;
  pollIntervalMinutes?: number;
  lookbackDays?: number;
  maxMessages?: number;
  autoArchiveProcessedEmails?: boolean;
};

async function requireStockOps(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, ["products.import", "products.edit", "admin.access"]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot change Autopart IMAP settings", "FORBIDDEN", 403);
  }
  return profile;
}

export async function getImapSettingsForActor(actorUserId: string) {
  const profile = await requireAnySystemPermission(actorUserId, ["inventory.view", "products.view", "admin.access"]);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot inspect Autopart IMAP settings", "FORBIDDEN", 403);
  }
  return toPublicImapSettings();
}

export async function updateImapSettings(actorUserId: string, input: ImapSettingsUpdate) {
  await requireStockOps(actorUserId);
  const invalid = validateImapSettingsUpdate(input);
  if (invalid) throw new AuthError(invalid, "VALIDATION", 400);
  const existing = await getOrCreateImapSettings();
  let imapPasswordEncrypted = existing.imapPasswordEncrypted;
  if (input.imapPassword !== undefined && input.imapPassword.trim()) {
    imapPasswordEncrypted = encryptImapPassword(input.imapPassword.trim());
  }
  const allowed = Array.isArray(input.allowedSenderEmails)
    ? input.allowedSenderEmails.join("\n")
    : input.allowedSenderEmails;
  await prisma.autopartImapSettings.update({
    where: { id: IMAP_SETTINGS_ID },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.inboundEmailAddress !== undefined ? { inboundEmailAddress: input.inboundEmailAddress.trim() } : {}),
      ...(input.imapHost !== undefined ? { imapHost: input.imapHost?.trim() || null } : {}),
      ...(input.imapPort !== undefined ? { imapPort: input.imapPort } : {}),
      ...(input.imapSecure !== undefined ? { imapSecure: input.imapSecure } : {}),
      ...(input.imapUsername !== undefined ? { imapUsername: input.imapUsername?.trim() || null } : {}),
      imapPasswordEncrypted,
      ...(input.mailbox !== undefined ? { mailbox: input.mailbox.trim() || "INBOX" } : {}),
      ...(allowed !== undefined ? { allowedSenderEmails: allowed } : {}),
      ...(input.attachmentFilenamePattern !== undefined
        ? { attachmentFilenamePattern: input.attachmentFilenamePattern.trim() || DEFAULT_STOCK_FILENAME_PATTERN }
        : {}),
      ...(input.pollIntervalMinutes !== undefined ? { pollIntervalMinutes: input.pollIntervalMinutes } : {}),
      ...(input.lookbackDays !== undefined ? { lookbackDays: input.lookbackDays } : {}),
      ...(input.maxMessages !== undefined ? { maxMessages: input.maxMessages } : {}),
      ...(input.autoArchiveProcessedEmails !== undefined
        ? { autoArchiveProcessedEmails: input.autoArchiveProcessedEmails }
        : {}),
    },
  });
  return toPublicImapSettings();
}

export async function recordImapPollOutcome(data: {
  error?: string | null;
  lastEmailFrom?: string | null;
  lastEmailSubject?: string | null;
  lastEmailUid?: string | null;
  lastAttachmentFilename?: string | null;
  lastEmailReceivedAt?: Date | null;
}) {
  await prisma.autopartImapSettings.update({
    where: { id: IMAP_SETTINGS_ID },
    data: {
      lastPollAt: new Date(),
      lastPollError: data.error ?? null,
      ...(data.lastEmailFrom !== undefined ? { lastEmailFrom: data.lastEmailFrom } : {}),
      ...(data.lastEmailSubject !== undefined ? { lastEmailSubject: data.lastEmailSubject } : {}),
      ...(data.lastEmailUid !== undefined ? { lastEmailUid: data.lastEmailUid } : {}),
      ...(data.lastAttachmentFilename !== undefined ? { lastAttachmentFilename: data.lastAttachmentFilename } : {}),
      ...(data.lastEmailReceivedAt !== undefined ? { lastEmailReceivedAt: data.lastEmailReceivedAt } : {}),
    },
  });
}
