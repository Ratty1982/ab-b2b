/**
 * Transactional email adapter interface (Phase 1).
 * Provider selection (Resend / SES / etc.) lands in Phase 2+.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional tags for provider metadata — never secrets */
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  ok: boolean;
  /** Provider message id when available */
  id?: string;
  /** Adapter-specific note (e.g. "logged only") */
  detail?: string;
}

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
