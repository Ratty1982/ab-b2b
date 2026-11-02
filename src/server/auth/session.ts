import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";

import { auth } from "@/infra/auth";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/redirects";
import { assessAttempt } from "@/server/security/attempts";
import { publishSecurityAlert } from "@/server/security/alerts";
import { securityAccountKey, securityPepper } from "@/server/security/account-key";
import {
  PASSWORD_LOCK_ALERT_KIND,
  PASSWORD_LOCK_ALERT_SUMMARY,
  UNAUTHENTICATED_SIGN_IN_ERROR,
  classifyPasswordSignInError,
  passwordAuthRestricted,
  passwordLockDedupeKey,
  settlePasswordAttempt,
  shouldCountPasswordFailure,
} from "@/server/security/password-failure";
import { passwordFailureStore } from "@/server/security/password-failure-store";
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

async function credentialAccountExists(email: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        accounts: {
          where: { providerId: "credential" },
          select: { password: true },
          take: 1,
        },
      },
    });
    return Boolean(user?.accounts.some((account) => account.password));
  } catch (error) {
    console.error("[ab:security] credential lookup failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

async function passwordSignInPaused(accountKey: string, nowMs: number): Promise<boolean> {
  try {
    const state = await passwordFailureStore.read(accountKey, nowMs);
    return passwordAuthRestricted(state, nowMs);
  } catch (error) {
    console.error("[ab:security] sign-in lock could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

async function revokePasswordSignIn(headers: Headers, userId: string | null): Promise<void> {
  try {
    await auth.api.signOut({ headers });
  } catch {
    // The session row is removed below when the user id is known.
  }
  if (!userId) return;
  try {
    await prisma.authSession.deleteMany({ where: { userId } });
  } catch (error) {
    console.error("[ab:security] sign-in session was not removed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

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
      const email = data.email.toLowerCase().trim();
      const accountKey = securityAccountKey(email, securityPepper());
      const nowMs = Date.now();

      if (await passwordSignInPaused(accountKey, nowMs)) {
        try {
          await hashPassword(data.password);
        } catch {
          // The visitor message stays generic even if the equalising hash fails.
        }
        return { ok: false, error: UNAUTHENTICATED_SIGN_IN_ERROR };
      }

      const hasCredentialAccount = await credentialAccountExists(email);

      try {
        const result = await auth.api.signInEmail({
          body: {
            email,
            password: data.password,
          },
          headers,
        });

        const mfaChallenge = Boolean(
          result &&
            typeof result === "object" &&
            "twoFactorRedirect" in result &&
            (result as { twoFactorRedirect?: boolean }).twoFactorRedirect,
        );
        const userId = (result as { user?: { id?: string } } | null)?.user?.id ?? null;
        let settled: { result: "success" | "mfa" | "invalid" };
        try {
          settled = await settlePasswordAttempt({
            store: passwordFailureStore,
            accountKey,
            nowMs: Date.now(),
            outcome: mfaChallenge ? "mfa-challenge" : "complete",
          });
        } catch (storeError) {
          console.error("[ab:security] sign-in lock was not cleared", {
            error: storeError instanceof Error ? storeError.name : "unknown",
          });
          settled = { result: mfaChallenge ? "mfa" : "success" };
        }

        if (settled.result === "invalid") {
          await revokePasswordSignIn(headers, userId);
          return { ok: false, error: UNAUTHENTICATED_SIGN_IN_ERROR };
        }
        if (settled.result === "mfa") {
          return { ok: false, error: "Enter your authenticator code", needsTwoFactor: true };
        }

        await recordAuditEvent({
          action: "LOGIN_SUCCESS",
          entityType: "User",
          entityId: userId,
          actorUserId: userId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });

        return { ok: true };
      } catch (error) {
        const classification = classifyPasswordSignInError(error);
        if (shouldCountPasswordFailure({ hasCredentialAccount, classification })) {
          try {
            await settlePasswordAttempt({
              store: passwordFailureStore,
              accountKey,
              nowMs: Date.now(),
              outcome: "confirmed-incorrect",
              onJustLocked: async (lockedUntilMs) => {
                await publishSecurityAlert({
                  kind: PASSWORD_LOCK_ALERT_KIND,
                  dedupeKey: passwordLockDedupeKey(accountKey, lockedUntilMs),
                  summary: PASSWORD_LOCK_ALERT_SUMMARY,
                  metadata: { accountKey },
                });
              },
            });
          } catch (storeError) {
            console.error("[ab:security] sign-in lock was not recorded", {
              error: storeError instanceof Error ? storeError.name : "unknown",
            });
          }
        }
        await recordAuditEvent({
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: null,
          metadata: {
            emailDomain: email.split("@")[1]?.toLowerCase() ?? null,
            accountKey,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        return { ok: false, error: UNAUTHENTICATED_SIGN_IN_ERROR };
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
      const email = session?.user?.email?.toLowerCase().trim();
      if (email) {
        const accountKey = securityAccountKey(email, securityPepper());
        try {
          const settled = await settlePasswordAttempt({
            store: passwordFailureStore,
            accountKey,
            nowMs: Date.now(),
            outcome: "complete",
          });
          if (settled.result !== "success") {
            await revokePasswordSignIn(headers, userId);
            return { ok: false, error: "Invalid authentication code" };
          }
        } catch (storeError) {
          console.error("[ab:security] sign-in lock was not cleared", {
            error: storeError instanceof Error ? storeError.name : "unknown",
          });
        }
      }
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
