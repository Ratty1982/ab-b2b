/**
 * Central SMTP address builders for transactional email.
 * From / Reply-To always come from Admin → Settings → Email — never from SMTP username.
 */
export type MailAddress = {
  name?: string;
  address: string;
};

export type SenderSettingsInput = {
  fromName: string | null | undefined;
  fromEmail: string;
  replyToName?: string | null | undefined;
  replyToEmail?: string | null | undefined;
  /** Never used as visible From name — accepted only so callers can assert it is ignored. */
  smtpUsername?: string | null | undefined;
};

/**
 * Build nodemailer-compatible From address from Admin sender settings.
 * Prefer structured `{ name, address }` so display names with spaces are encoded correctly.
 */
export function buildFromAddress(settings: SenderSettingsInput): MailAddress {
  const address = settings.fromEmail.trim();
  const name = settings.fromName?.trim() || undefined;
  return name ? { name, address } : { address };
}

/**
 * Build Reply-To when configured. Blank replyToName → address only.
 */
export function buildReplyToAddress(settings: SenderSettingsInput): MailAddress | undefined {
  const address = settings.replyToEmail?.trim();
  if (!address) return undefined;
  const name = settings.replyToName?.trim() || undefined;
  return name ? { name, address } : { address };
}

/** RFC-style string for assertions / logging (never logs credentials). */
export function formatMailAddress(addr: MailAddress): string {
  if (addr.name?.trim()) {
    const safe = addr.name.trim().replace(/"/g, "");
    return `"${safe}" <${addr.address}>`;
  }
  return addr.address;
}

/**
 * Full From + Reply-To pair used by SmtpEmailTransport and diagnostics.
 * SMTP username must never replace fromName.
 */
export function buildSmtpMailAddresses(settings: SenderSettingsInput): {
  from: MailAddress;
  replyTo: MailAddress | undefined;
  fromHeader: string;
  replyToHeader: string | undefined;
} {
  const from = buildFromAddress(settings);
  const replyTo = buildReplyToAddress(settings);
  return {
    from,
    replyTo,
    fromHeader: formatMailAddress(from),
    replyToHeader: replyTo ? formatMailAddress(replyTo) : undefined,
  };
}
