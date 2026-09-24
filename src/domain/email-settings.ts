/**
 * Email settings validation (pure). No Prisma / Node crypto.
 */
import { z } from "zod";

export const SMTP_SECURITY_OPTIONS = ["SSL_TLS", "STARTTLS", "NONE"] as const;
export type SmtpSecurityOption = (typeof SMTP_SECURITY_OPTIONS)[number];

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(320);

export const recipientListSchema = z.array(emailAddressSchema).max(50);

export const emailSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  smtpHost: z.string().trim().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecurity: z.enum(SMTP_SECURITY_OPTIONS).optional(),
  smtpUsername: z.string().trim().max(320).nullable().optional(),
  /** Write-only. Empty / omitted preserves existing encrypted password. */
  smtpPassword: z.string().max(500).optional(),
  replacePassword: z.boolean().optional(),
  fromName: z.string().trim().max(120).nullable().optional(),
  fromEmail: z.string().trim().max(320).nullable().optional(),
  replyToName: z.string().trim().max(120).nullable().optional(),
  replyToEmail: z.string().trim().max(320).nullable().optional(),
  tradeApplicationRecipients: recipientListSchema.optional(),
  orderNotificationRecipients: recipientListSchema.optional(),
});

export type EmailSettingsUpdateInput = z.infer<typeof emailSettingsUpdateSchema>;

export function normalizeRecipientList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const parsed = emailAddressSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    out.push(parsed.data);
  }
  return out;
}

export function validateOptionalEmail(value: string | null | undefined, label: string): string | null {
  if (value == null || !value.trim()) return null;
  const parsed = emailAddressSchema.safeParse(value);
  if (!parsed.success) return `${label} is not a valid email address`;
  return null;
}

/**
 * Server-side save validation. Password may be omitted when already configured.
 */
export function validateEmailSettingsSave(
  input: EmailSettingsUpdateInput,
  existing: { hasPassword: boolean },
): string | null {
  const host = input.smtpHost !== undefined ? (input.smtpHost?.trim() || "") : undefined;
  if (host !== undefined && !host) {
    return "SMTP host is required";
  }
  if (input.smtpPort !== undefined && (input.smtpPort < 1 || input.smtpPort > 65535)) {
    return "SMTP port must be between 1 and 65535";
  }
  if (input.smtpSecurity === "NONE") {
    // Allowed but caller should surface a warning in the UI.
  }
  if (input.smtpUsername !== undefined && !(input.smtpUsername?.trim())) {
    return "SMTP username is required";
  }

  const replacing =
    Boolean(input.replacePassword) ||
    (typeof input.smtpPassword === "string" && input.smtpPassword.length > 0);
  if (replacing && !(input.smtpPassword && input.smtpPassword.length > 0)) {
    return "Enter a new SMTP password to replace the existing one";
  }
  if (!existing.hasPassword && !replacing && host) {
    // First-time configure path when host is being set — password required for "Configured".
    // Soft: allow save of partial draft without password, but "configured" status stays false.
  }

  const fromErr = validateOptionalEmail(input.fromEmail ?? null, "From email");
  if (fromErr) return fromErr;
  const replyErr = validateOptionalEmail(input.replyToEmail ?? null, "Reply-To email");
  if (replyErr) return replyErr;

  if (input.tradeApplicationRecipients) {
    for (const addr of input.tradeApplicationRecipients) {
      const err = validateOptionalEmail(addr, "Trade application recipient");
      if (err) return err;
    }
  }
  if (input.orderNotificationRecipients) {
    for (const addr of input.orderNotificationRecipients) {
      const err = validateOptionalEmail(addr, "Order notification recipient");
      if (err) return err;
    }
  }

  return null;
}

export function isSmtpConfigured(input: {
  smtpHost: string | null;
  smtpUsername: string | null;
  smtpPasswordConfigured: boolean;
}): boolean {
  return Boolean(input.smtpHost?.trim() && input.smtpUsername?.trim() && input.smtpPasswordConfigured);
}

export function isSenderConfigured(input: {
  fromEmail: string | null;
  fromName?: string | null;
}): boolean {
  return Boolean(input.fromEmail?.trim());
}

export const sendTestEmailInputSchema = z.object({
  toEmail: emailAddressSchema,
  toName: z.string().trim().max(120).optional(),
});
