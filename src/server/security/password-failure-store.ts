import { prisma } from "@/infra/database/client";
import {
  normalisePasswordFailureState,
  recordConfirmedPasswordFailure,
  type PasswordFailureState,
  type PasswordFailureStore,
} from "@/server/security/password-failure";

/**
 * Shared password-failure counter.
 *
 * PostgreSQL row locks make the increment atomic across application copies.
 * `statement_timeout` is 1.5 seconds for that transaction only. If the read or
 * the write times out or errors, the caller fails open: sign-in continues, the
 * visitor still sees the generic invalid message, and the account is not
 * disabled. A failed reset after a real sign-in does not turn that sign-in
 * into a failure.
 *
 * Redis is not consulted. `REDIS_URL` has no effect on this path. A future
 * Redis counter would be allowed only with a 200ms command timeout, no
 * retries, and fail-open on timeout or connection error. A Redis error must
 * not be treated as a successful sign-in and must not clear the counter.
 * Until that client exists, this database is the shared store.
 */
export const PASSWORD_FAILURE_STATEMENT_TIMEOUT_MS = 1500;

export const REDIS_SIGN_IN_POLICY = {
  used: false,
  commandTimeoutMs: 200,
  retries: 0,
  onTimeout: "fail-open",
  onConnectionError: "fail-open",
} as const;

type FailureRow = {
  failureCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

function toState(row: FailureRow): PasswordFailureState {
  return {
    failureCount: row.failureCount,
    windowStartedAtMs: row.windowStartedAt.getTime(),
    lockedUntilMs: row.lockedUntil?.getTime() ?? null,
  };
}

export function createPrismaPasswordFailureStore(): PasswordFailureStore {
  return {
    async read(accountKey, nowMs) {
      const row = await prisma.authPasswordFailure.findUnique({
        where: { accountKey },
        select: { failureCount: true, windowStartedAt: true, lockedUntil: true },
      });
      if (!row) return null;
      return normalisePasswordFailureState(toState(row), nowMs);
    },

    async recordFailure(accountKey, nowMs) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(PASSWORD_FAILURE_STATEMENT_TIMEOUT_MS)}, true)`;
        await tx.$executeRaw`
          INSERT INTO "AuthPasswordFailure" ("accountKey", "failureCount", "windowStartedAt", "lockedUntil", "updatedAt")
          VALUES (${accountKey}, 0, ${new Date(nowMs)}, NULL, ${new Date(nowMs)})
          ON CONFLICT ("accountKey") DO NOTHING
        `;
        await tx.$queryRaw`
          SELECT "accountKey" FROM "AuthPasswordFailure"
          WHERE "accountKey" = ${accountKey}
          FOR UPDATE
        `;
        const row = await tx.authPasswordFailure.findUnique({
          where: { accountKey },
          select: { failureCount: true, windowStartedAt: true, lockedUntil: true },
        });
        const next = recordConfirmedPasswordFailure(row ? toState(row) : null, nowMs);
        const saved = await tx.authPasswordFailure.update({
          where: { accountKey },
          data: {
            failureCount: next.state.failureCount,
            windowStartedAt: new Date(next.state.windowStartedAtMs),
            lockedUntil:
              next.state.lockedUntilMs == null ? null : new Date(next.state.lockedUntilMs),
          },
          select: { failureCount: true, windowStartedAt: true, lockedUntil: true },
        });
        return {
          state: toState(saved),
          justLocked: next.justLocked,
        };
      });
    },

    async reset(accountKey) {
      await prisma.authPasswordFailure.deleteMany({ where: { accountKey } });
    },
  };
}

export const passwordFailureStore = createPrismaPasswordFailureStore();
