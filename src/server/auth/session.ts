import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { auth } from "@/infra/auth";
import { recordAuditEvent } from "@/server/audit/record";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/redirects";
import { assessAttempt } from "@/server/security/attempts";
import { publishSecurityAlert } from "@/server/security/alerts";
import {
  clientMetaFromRequestHeaders,
  resolveRequestClientSession,
  type ClientSession,
  type SafeSession,
  type SafeSessionUser,
} from "@/server/auth/request-session";

export { resolvePostLoginPath, safeReturnPath };
export type { ClientSession, SafeSession, SafeSessionUser };
export {
  buildSafeSession,
  guestClientSession,
  resolveOptionalRequestUserId,
  resolveRequestClientSession,
  sessionDiagnostics,
} from "@/server/auth/request-session";

export const getClientSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClientSession> => resolveRequestClientSession(),
);

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});

export const signInWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true } | { ok: false; error: string; needsTwoFactor?: boolean }
    > => {
      const headers = getRequestHeaders();
      const meta = clientMetaFromRequestHeaders(headers);
      const attempt = assessAttempt({ scope: "login", headers, subject: data.email });
      if (!attempt.allowed) {
        await publishSecurityAlert({
          kind: "REPEATED_LOGIN_FAILURE",
          dedupeKey: `login:${attempt.accountKey ?? "unknown-account"}`,
          summary: "Repeated sign-in attempts were blocked before the password was checked.",
          metadata: { trustedAddress: attempt.trustedAddress },
        });
        return {
          ok: false,
          error: "Too many sign-in attempts. Please wait and try again.",
        };
      }

      try {
        const result = await auth.api.signInEmail({
          body: {
            email: data.email.toLowerCase().trim(),
            password: data.password,
          },
          headers,
        });

        // Better Auth two-factor: password OK, TOTP/backup still required.
        if (
          result &&
          typeof result === "object" &&
          "twoFactorRedirect" in result &&
          (result as { twoFactorRedirect?: boolean }).twoFactorRedirect
        ) {
          return { ok: false, error: "Enter your authenticator code", needsTwoFactor: true };
        }

        const userId = (result as { user?: { id?: string } } | null)?.user?.id;
        await recordAuditEvent({
          action: "LOGIN_SUCCESS",
          entityType: "User",
          entityId: userId ?? null,
          actorUserId: userId ?? null,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });

        return { ok: true };
      } catch {
        await recordAuditEvent({
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: null,
          metadata: {
            emailDomain: data.email.split("@")[1]?.toLowerCase() ?? null,
            accountKey: attempt.accountKey,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        // Generic message — avoid user enumeration
        return { ok: false, error: "Invalid email or password" };
      }
    },
  );

const totpSchema = z.object({
  code: z.string().trim().min(6).max(32),
  trustDevice: z.boolean().optional(),
});

/** Complete MFA challenge after password sign-in (TOTP or backup code). */
export const verifyTwoFactorLogin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => totpSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const headers = getRequestHeaders();
    const meta = clientMetaFromRequestHeaders(headers);
    const attempt = assessAttempt({ scope: "mfa", headers });
    if (!attempt.allowed) {
      await publishSecurityAlert({
        kind: "REPEATED_MFA_FAILURE",
        dedupeKey: `mfa:${attempt.clientKey ?? "no-cookie"}`,
        summary: "Repeated authenticator attempts were blocked.",
        metadata: { trustedAddress: attempt.trustedAddress },
      });
      return { ok: false, error: "Too many authentication attempts. Please wait and try again." };
    }
    const code = data.code.replace(/\s+/g, "");
    try {
      if (/^\d{6}$/.test(code)) {
        await auth.api.verifyTOTP({
          body: { code, trustDevice: data.trustDevice ?? false },
          headers,
        });
      } else {
        await auth.api.verifyBackupCode({
          body: { code, trustDevice: data.trustDevice ?? false },
          headers,
        });
      }
      const session = await auth.api.getSession({ headers });
      const userId = session?.user?.id ?? null;
      await recordAuditEvent({
        action: "LOGIN_MFA_SUCCESS",
        entityType: "User",
        entityId: userId,
        actorUserId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { ok: true };
    } catch {
      await recordAuditEvent({
        action: "LOGIN_MFA_FAILED",
        entityType: "User",
        entityId: null,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { ok: false, error: "Invalid authentication code" };
    }
  });

export const signOutCurrent = createServerFn({ method: "POST" }).handler(async () => {
  const headers = getRequestHeaders();
  const meta = clientMetaFromRequestHeaders(headers);
  const session = await auth.api.getSession({ headers });
  const userId = session?.user?.id ?? null;

  try {
    await auth.api.signOut({ headers });
  } catch {
    // still audit intent
  }

  await recordAuditEvent({
    action: "LOGOUT",
    entityType: "User",
    entityId: userId,
    actorUserId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { ok: true as const };
});

const forgotSchema = z.object({
  email: z.string().email().max(320),
});

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgotSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const attempt = assessAttempt({
      scope: "password-reset",
      headers,
      subject: data.email,
    });
    if (!attempt.allowed) {
      await publishSecurityAlert({
        kind: "REPEATED_PASSWORD_RESET",
        dedupeKey: `reset:${attempt.accountKey ?? "unknown-account"}`,
        summary: "Repeated password-reset requests were ignored.",
        metadata: { trustedAddress: attempt.trustedAddress },
      });
      return {
        ok: true as const,
        message:
          "If an account exists for that email address, we've sent instructions to reset the password.",
      };
    }
    try {
      await auth.api.requestPasswordReset({
        body: {
          email: data.email.toLowerCase().trim(),
          redirectTo: "/reset-password",
        },
        headers,
      });
    } catch {
      // Swallow — always return generic success to avoid enumeration
    }
    return {
      ok: true as const,
      message:
        "If an account exists for that email address, we've sent instructions to reset the password.",
    };
  });

const resetSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(10).max(128),
});

export const completePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => resetSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const attempt = assessAttempt({
      scope: "password-reset-complete",
      headers,
      subject: data.token,
    });
    if (!attempt.allowed) {
      return {
        ok: false as const,
        error: "Unable to reset password. The link may have expired.",
      };
    }
    try {
      await auth.api.resetPassword({
        body: {
          token: data.token,
          newPassword: data.newPassword,
        },
        headers,
      });
      return { ok: true as const };
    } catch {
      return {
        ok: false as const,
        error: "Unable to reset password. The link may have expired.",
      };
    }
  });
