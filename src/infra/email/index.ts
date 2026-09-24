import { createDevLogEmailAdapter } from "./dev-log";
import type { EmailAdapter } from "./types";
import { getServerEnv } from "@/server/env";

let cached: EmailAdapter | undefined;
let testOverride: EmailAdapter | undefined;

/**
 * Resolve the active email adapter.
 * Production without a configured provider refuses to pretend mail was sent.
 */
export function getEmailAdapter(): EmailAdapter {
  if (testOverride) return testOverride;
  if (cached) return cached;

  const env = getServerEnv();
  const provider = (env.EMAIL_PROVIDER ?? "").toLowerCase();

  if (provider === "dev-log" || env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    cached = createDevLogEmailAdapter();
    return cached;
  }

  if (!provider || !env.EMAIL_API_KEY) {
    cached = {
      name: "unconfigured",
      async send() {
        console.error(
          "[ab:email] No EMAIL_PROVIDER configured — refusing to claim delivery in production",
        );
        return {
          ok: false,
          detail: "Transactional email provider is not configured",
        };
      },
    };
    return cached;
  }

  // Phase 2+: wire Resend / SES / etc. behind EMAIL_PROVIDER
  cached = {
    name: provider,
    async send() {
      console.error(`[ab:email] Provider "${provider}" is not implemented yet`);
      return { ok: false, detail: `Email provider "${provider}" not implemented` };
    },
  };
  return cached;
}

/** Test-only override — pass null to clear. */
export function setEmailAdapterForTests(adapter: EmailAdapter | null): void {
  testOverride = adapter ?? undefined;
}

export type { EmailAdapter, EmailMessage, EmailSendResult } from "./types";
