import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";

/**
 * Development / test adapter — writes to the server log.
 * Must NOT be used as a silent "pretend sent" path in production.
 */
export function createDevLogEmailAdapter(): EmailAdapter {
  return {
    name: "dev-log",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      console.info("[ab:email:dev-log]", {
        to: message.to,
        subject: message.subject,
        textPreview: message.text.slice(0, 200),
        tags: message.tags,
      });
      return { ok: true, detail: "logged" };
    },
  };
}
