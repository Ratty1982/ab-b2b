/**
 * Email transport abstraction.
 * Business workflows call TransactionalEmailService → EmailTransport.
 * SMTP is the initial adapter; Resend/Postmark/SES can be added later without
 * changing order / trade-application workflows.
 */
import type { EmailMessage, EmailSendResult } from "./types";

export type SmtpSecurityMode = "SSL_TLS" | "STARTTLS" | "NONE";

export type SmtpTransportConfig = {
  host: string;
  port: number;
  security: SmtpSecurityMode;
  username: string;
  password: string;
  fromName: string | null;
  fromEmail: string;
  replyToName: string | null;
  replyToEmail: string | null;
};

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  /** Verify network + TLS + auth without sending mail. */
  verifyConnection?(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type { EmailMessage, EmailSendResult };
