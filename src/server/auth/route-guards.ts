import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "@/infra/auth";
import { isPermissionKey } from "@/domain/permissions";
import {
  requireAdminAccess,
  requireCrmAccess,
  requireInternalSalesAccess,
  requirePurchasingAccess,
  requireSystemPermission,
  requireTradePortalAccess,
  AuthError,
} from "@/server/rbac/guards";
import { getClientSession, type ClientSession } from "@/server/auth/session";
import { mfaEnrollmentRequired } from "@/domain/mfa-policy";
import { scheduleTouchLastActive } from "@/server/audit/last-active";

export type GuardResult =
  | { ok: true; session: ClientSession & { signedIn: true }; userId: string }
  | {
      ok: false;
      reason: "unauthenticated" | "forbidden" | "mfa_required";
      session: ClientSession;
    };

async function currentUserId(): Promise<string | null> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}

async function runGuard(
  check: (userId: string | null) => Promise<{ userId: string }>,
  options?: { touchActive?: boolean },
): Promise<GuardResult> {
  const userId = await currentUserId();
  const session = await getClientSession();
  try {
    const profile = await check(userId);
    if (!session.signedIn) {
      return { ok: false, reason: "unauthenticated", session };
    }
    if (
      mfaEnrollmentRequired({
        actorType: session.user.actorType,
        systemRoles: session.user.systemRoles,
        twoFactorEnabled: session.user.twoFactorEnabled,
      })
    ) {
      return { ok: false, reason: "mfa_required", session };
    }
    if (options?.touchActive !== false) {
      scheduleTouchLastActive(profile.userId);
    }
    return { ok: true, session, userId: profile.userId };
  } catch (error) {
    if (error instanceof AuthError && error.code === "MFA_ENROLLMENT_REQUIRED") {
      return { ok: false, reason: "mfa_required", session };
    }
    if (error instanceof AuthError && error.status === 401) {
      return { ok: false, reason: "unauthenticated", session };
    }
    return { ok: false, reason: "forbidden", session };
  }
}

export const ensurePortalAccess = createServerFn({ method: "GET" }).handler(async () =>
  // Trade portal — do not treat as internal staff presence.
  runGuard((id) => requireTradePortalAccess(id), { touchActive: false }),
);

export const ensureSalesAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireInternalSalesAccess(id)),
);

export const ensureCrmAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireCrmAccess(id)),
);

export const ensurePurchasingAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requirePurchasingAccess(id)),
);

export const ensureStaffPermission = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => {
    const permission =
      data && typeof data === "object" && "permission" in data
        ? String((data as { permission: unknown }).permission)
        : "";
    if (!isPermissionKey(permission)) throw new Error("Unknown permission");
    return { permission };
  })
  .handler(async ({ data }) => runGuard((id) => requireSystemPermission(id, data.permission)));

export const ensureAdminAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireAdminAccess(id)),
);
