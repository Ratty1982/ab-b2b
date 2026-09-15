import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { auth } from "@/infra/auth";
import { recordAuditEvent } from "@/server/audit/record";
import { loadAccessProfile } from "@/server/rbac/access";
import { getActiveActingContext } from "@/server/acting-context";
import type { PermissionKey } from "@/domain/permissions";
import type { TradeAccessKey } from "@/domain/permissions";
import { resolvePostLoginPath, safeReturnPath } from "@/server/auth/redirects";

export { resolvePostLoginPath, safeReturnPath };

/** Safe session payload for the client — no hashes, tokens, or full permission dumps by default */
export interface SafeSessionUser {
  id: string;
  email: string;
  name: string;
  actorType: "INTERNAL" | "TRADE";
  systemRoles: string[];
  /** Primary display role label for AppShell */
  displayRole: string;
  companyId: string | null;
  companyName: string | null;
  accountNumber: string | null;
  tradeRole: TradeAccessKey | null;
  /** Permission keys needed for navigation gating (not a security boundary) */
  navPermissions: PermissionKey[];
  actingFor: {
    companyId: string;
    companyName: string;
    accountNumber: string | null;
  } | null;
}

export interface SafeSession {
  signedIn: true;
  user: SafeSessionUser;
}

export type ClientSession = SafeSession | { signedIn: false };

function clientMeta(headers: Headers) {
  return {
    ipAddress:
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null,
    userAgent: headers.get("user-agent"),
  };
}

function pickDisplayRole(
  profile: NonNullable<Awaited<ReturnType<typeof loadAccessProfile>>>,
): string {
  if (profile.systemRoles.includes("SUPER_ADMIN")) return "Super Admin";
  if (profile.systemRoles.includes("MANAGEMENT")) return "Management";
  if (profile.systemRoles.includes("SALES_MANAGER")) return "Sales Manager";
  if (profile.systemRoles.includes("SALES_REPRESENTATIVE")) return "Sales Representative";
  if (profile.systemRoles.includes("CUSTOMER_SERVICE")) return "Customer Service";
  if (profile.systemRoles.includes("ACCOUNTS")) return "Accounts";
  if (profile.systemRoles.includes("MARKETING")) return "Marketing";

  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];
  if (membership) {
    const roleLabel = membership.role.replaceAll("_", " ");
    return `${roleLabel} · ${membership.companyName}`;
  }
  return "User";
}

async function buildSafeSession(userId: string): Promise<SafeSession | null> {
  const profile = await loadAccessProfile(userId);
  if (!profile) return null;

  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];

  const acting = await getActiveActingContext(userId);

  return {
    signedIn: true,
    user: {
      id: profile.userId,
      email: profile.email,
      name: profile.name ?? profile.email,
      actorType: profile.actorType,
      systemRoles: profile.systemRoles,
      displayRole: pickDisplayRole(profile),
      companyId: membership?.companyId ?? null,
      companyName: membership?.companyName ?? null,
      accountNumber: membership?.accountNumber ?? null,
      tradeRole: membership?.role ?? null,
      navPermissions: [...profile.permissions],
      actingFor: acting
        ? {
            companyId: acting.onBehalfOfCompany.id,
            companyName: acting.onBehalfOfCompany.name,
            accountNumber: acting.onBehalfOfCompany.accountNumber,
          }
        : null,
    },
  };
}

export const getClientSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClientSession> => {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return { signedIn: false };
    const safe = await buildSafeSession(session.user.id);
    return safe ?? { signedIn: false };
  },
);

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});

export const signInWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const headers = getRequestHeaders();
    const meta = clientMeta(headers);

    try {
      const result = await auth.api.signInEmail({
        body: {
          email: data.email.toLowerCase().trim(),
          password: data.password,
        },
        headers,
      });

      const userId = result?.user?.id;
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
        metadata: { emailDomain: data.email.split("@")[1] ?? null },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      // Generic message — avoid user enumeration
      return { ok: false, error: "Invalid email or password" };
    }
  });

export const signOutCurrent = createServerFn({ method: "POST" }).handler(async () => {
  const headers = getRequestHeaders();
  const meta = clientMeta(headers);
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
      message: "If an account exists for that email, password reset instructions have been sent.",
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
