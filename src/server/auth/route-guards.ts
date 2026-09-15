import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "@/infra/auth";
import {
  requireAdminAccess,
  requireCrmAccess,
  requireInternalSalesAccess,
  requireTradePortalAccess,
  AuthError,
} from "@/server/rbac/guards";
import { getClientSession, type ClientSession } from "@/server/auth/session";

export type GuardResult =
  | { ok: true; session: ClientSession & { signedIn: true }; userId: string }
  | { ok: false; reason: "unauthenticated" | "forbidden"; session: ClientSession };

async function currentUserId(): Promise<string | null> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
}

async function runGuard(
  check: (userId: string | null) => Promise<{ userId: string }>,
): Promise<GuardResult> {
  const userId = await currentUserId();
  const session = await getClientSession();
  try {
    const profile = await check(userId);
    if (!session.signedIn) {
      return { ok: false, reason: "unauthenticated", session };
    }
    return { ok: true, session, userId: profile.userId };
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      return { ok: false, reason: "unauthenticated", session };
    }
    return { ok: false, reason: "forbidden", session };
  }
}

export const ensurePortalAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireTradePortalAccess(id)),
);

export const ensureSalesAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireInternalSalesAccess(id)),
);

export const ensureCrmAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireCrmAccess(id)),
);

export const ensureAdminAccess = createServerFn({ method: "GET" }).handler(async () =>
  runGuard((id) => requireAdminAccess(id)),
);
