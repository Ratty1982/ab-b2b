/**
 * SMTP email transport (nodemailer). SERVER ONLY — never import from client routes.
 * Credentials must never be logged or included in error messages.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailMessage, EmailSendResult } from "./types";
import type { EmailTransport, SmtpTransportConfig } from "./transport";
import { buildSmtpMailAddresses } from "@/server/email/addresses";

function createTransporter(config: SmtpTransportConfig): Transporter {
  const secure = config.security === "SSL_TLS";
  const requireTLS = config.security === "STARTTLS";
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: requireTLS || undefined,
    ignoreTLS: config.security === "NONE" ? true : undefined,
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

/** Map nodemailer / network errors to sanitised admin-facing messages. */
export function sanitiseSmtpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown");
  const lower = raw.toLowerCase();

  if (
    lower.includes("invalid login") ||
    lower.includes("authentication failed") ||
    (lower.includes("auth") &&
      (lower.includes("fail") || lower.includes("invalid") || lower.includes("denied")))
  ) {
    return "Authentication failed";
  }
  if (lower.includes("etimedout") || lower.includes("timeout") || lower.includes("timed out")) {
    return "Connection timed out";
  }
  if (
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("dns") ||
    lower.includes("unable to resolve")
  ) {
    return "Unable to resolve SMTP host";
  }
  if (
    lower.includes("certificate") ||
    lower.includes("ssl") ||
    lower.includes("tls") ||
    lower.includes("secure") ||
    lower.includes("wrong version number")
  ) {
    return "TLS connection failed";
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("connection refused") ||
    lower.includes("550") ||
    lower.includes("553") ||
    lower.includes("rejected")
  ) {
    return "SMTP server rejected connection";
  }
  return "SMTP connection failed";
}

export type CapturedSmtpSend = {
  from: { name?: string; address: string };
  replyTo?: { name?: string; address: string };
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function createSmtpEmailTransport(config: SmtpTransportConfig): EmailTransport {
  const transporter = createTransporter(config);
  const addresses = buildSmtpMailAddresses({
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyToName: config.replyToName,
    replyToEmail: config.replyToEmail,
    smtpUsername: config.username,
  });

  return {
    name: "smtp",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const info = await transporter.sendMail({
          // Structured address — nodemailer encodes display name correctly.
          from: addresses.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(addresses.replyTo ? { replyTo: addresses.replyTo } : {}),
        });
        const messageId = typeof info.messageId === "string" ? info.messageId : undefined;
        return {
          ok: true,
          ...(messageId ? { id: messageId } : {}),
          detail: "sent",
        };
      } catch (error) {
        return { ok: false, detail: sanitiseSmtpError(error) };
      }
    },
    async verifyConnection() {
      try {
        await transporter.verify();
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: sanitiseSmtpError(error) };
      }
    },
  };
}

/** Test-only factory that records calls without network I/O. */
export function createMockSmtpTransport(options?: {
  verifyResult?: { ok: true } | { ok: false; error: string };
  sendResult?: EmailSendResult;
  onSend?: (message: EmailMessage) => void;
  /** Optional fixed From/Reply-To as production transport would apply. */
  addresses?: {
    from: { name?: string; address: string };
    replyTo?: { name?: string; address: string };
  };
}): EmailTransport & {
  sent: EmailMessage[];
  captured: CapturedSmtpSend[];
} {
  const sent: EmailMessage[] = [];
  const captured: CapturedSmtpSend[] = [];
  return {
    name: "mock-smtp",
    sent,
    captured,
    async send(message) {
      sent.push(message);
      options?.onSend?.(message);
      if (options?.addresses) {
        captured.push({
          from: options.addresses.from,
          ...(options.addresses.replyTo ? { replyTo: options.addresses.replyTo } : {}),
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
      }
      return options?.sendResult ?? { ok: true, id: "mock-id", detail: "mock" };
    },
    async verifyConnection() {
      return options?.verifyResult ?? { ok: true as const };
    },
  };
}
