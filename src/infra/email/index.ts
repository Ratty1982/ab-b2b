import { createDevLogEmailAdapter } from "./dev-log";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";
import { getServerEnv } from "@/server/env";
import type { EmailTransport } from "./transport";

let cached: EmailAdapter | undefined;
let testOverride: EmailAdapter | undefined;
let transportOverride: EmailTransport | undefined;

function adapterFromTransport(transport: EmailTransport): EmailAdapter {
  return {
    name: transport.name,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      return transport.send(message);
    },
  };
}

/**
 * Resolve the active email adapter.
 *
 * Priority:
 * 1. Test override
 * 2. Admin → Settings → Email SMTP (DB) when fully configured
 * 3. Dev/test: dev-log
 * 4. Legacy EMAIL_PROVIDER env (future Resend/SES) — optional fallback only
 *
 * Coolify SMTP_* variables are intentionally NOT used.
 */
export async function resolveEmailAdapter(): Promise<EmailAdapter> {
  if (testOverride) return testOverride;
  if (transportOverride) return adapterFromTransport(transportOverride);

  try {
    const settings = await import("@/server/email/settings");
    const smtp = await settings.loadSmtpRuntimeConfig();
    if (smtp) {
      return adapterFromTransport(settings.buildSmtpTransportForAdapter(smtp));
    }
  } catch {
    // Settings table may be missing during early migrate — fall through.
  }

  const env = getServerEnv();
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return createDevLogEmailAdapter();
  }

  const provider = (env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (provider === "dev-log") {
    return createDevLogEmailAdapter();
  }

  if (!provider || !env.EMAIL_API_KEY) {
    return {
      name: "unconfigured",
      async send() {
        console.error(
          "[ab:email] No Admin SMTP settings configured — refusing to claim delivery",
        );
        return {
          ok: false,
          detail:
            "Transactional email is not configured. Configure SMTP in Admin → Settings → Email.",
        };
      },
    };
  }

  return {
    name: provider,
    async send() {
      console.error(`[ab:email] Provider "${provider}" is not implemented yet`);
      return { ok: false, detail: `Email provider "${provider}" not implemented` };
    },
  };
}

/**
 * Synchronous accessor used by legacy call sites.
 * Prefer resolveEmailAdapter() for SMTP-from-DB. Falls back to cached / env path.
 */
export function getEmailAdapter(): EmailAdapter {
  if (testOverride) return testOverride;
  if (transportOverride) return adapterFromTransport(transportOverride);
  if (cached) return cached;

  const env = getServerEnv();
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    cached = createDevLogEmailAdapter();
    return cached;
  }

  cached = {
    name: "lazy-smtp",
    async send(message) {
      const adapter = await resolveEmailAdapter();
      return adapter.send(message);
    },
  };
  return cached;
}

/** Test-only override — pass null to clear. */
export function setEmailAdapterForTests(adapter: EmailAdapter | null): void {
  testOverride = adapter ?? undefined;
  cached = undefined;
}

/** Test-only transport override (SMTP mock). */
export function setEmailTransportForTests(transport: EmailTransport | null): void {
  transportOverride = transport ?? undefined;
  cached = undefined;
}

export type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";
export type { EmailTransport, SmtpTransportConfig } from "./transport";
