/**
 * Confirmed incorrect passwords for one account.
 *
 * Five failures inside 15 minutes pause password sign-in for 15 minutes.
 * A completed sign-in clears the count. Starting an authenticator challenge
 * does not. The pause does not disable the account.
 *
 * Redis is not used. See `password-failure-store.ts` for the shared database
 * counter and for the Redis timeout rule that would be required before Redis
 * could be added.
 */

export const PASSWORD_FAILURE_LIMIT = 5;
export const PASSWORD_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;

/** Shown for a wrong password, an unknown address, a pause, and a blocked account. */
export const UNAUTHENTICATED_SIGN_IN_ERROR = "Invalid email or password";

export const PASSWORD_LOCK_ALERT_KIND = "REPEATED_SIGN_IN_FAILURE";
export const PASSWORD_LOCK_ALERT_SUMMARY =
  "Sign-in for one account was paused for 15 minutes after repeated incorrect attempts.";

export type PasswordFailureState = {
  failureCount: number;
  windowStartedAtMs: number;
  lockedUntilMs: number | null;
};

export type PasswordFailureStore = {
  read(accountKey: string, nowMs: number): Promise<PasswordFailureState | null>;
  recordFailure(
    accountKey: string,
    nowMs: number,
  ): Promise<{ state: PasswordFailureState; justLocked: boolean }>;
  reset(accountKey: string): Promise<void>;
};

export type PasswordSignInClassification = "invalid-credentials" | "account-blocked" | "other";

export type PasswordAttemptOutcome =
  | "complete"
  | "mfa-challenge"
  | "confirmed-incorrect"
  | "account-blocked"
  | "unknown";

export function normalisePasswordFailureState(
  state: PasswordFailureState | null,
  nowMs: number,
): PasswordFailureState | null {
  if (!state || state.failureCount <= 0) return null;
  if (state.lockedUntilMs != null) {
    if (nowMs < state.lockedUntilMs) return state;
    return null;
  }
  if (nowMs - state.windowStartedAtMs >= PASSWORD_FAILURE_WINDOW_MS) return null;
  return state;
}

export function passwordAuthRestricted(
  state: PasswordFailureState | null,
  nowMs: number,
): boolean {
  const current = normalisePasswordFailureState(state, nowMs);
  return current?.lockedUntilMs != null && nowMs < current.lockedUntilMs;
}

export function recordConfirmedPasswordFailure(
  state: PasswordFailureState | null,
  nowMs: number,
): { state: PasswordFailureState; justLocked: boolean } {
  const current = normalisePasswordFailureState(state, nowMs);
  if (current?.lockedUntilMs != null && nowMs < current.lockedUntilMs) {
    return { state: current, justLocked: false };
  }
  const failureCount = (current?.failureCount ?? 0) + 1;
  const windowStartedAtMs = current?.windowStartedAtMs ?? nowMs;
  const justLocked = failureCount >= PASSWORD_FAILURE_LIMIT;
  return {
    state: {
      failureCount,
      windowStartedAtMs,
      lockedUntilMs: justLocked ? nowMs + PASSWORD_LOCK_MS : null,
    },
    justLocked,
  };
}

/**
 * Count only a confirmed wrong password on an account that has a password.
 * An unknown address uses the same visitor message and is not stored.
 * A correct password on a disabled or held account is not a failure and does not clear the count.
 */
export function shouldCountPasswordFailure(input: {
  hasCredentialAccount: boolean;
  classification: PasswordSignInClassification;
}): boolean {
  return input.hasCredentialAccount && input.classification === "invalid-credentials";
}

export function classifyPasswordSignInError(error: unknown): PasswordSignInClassification {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Account is disabled")) return "account-blocked";
  const body =
    error && typeof error === "object" && "body" in error
      ? (error as { body?: { code?: unknown } }).body
      : undefined;
  if (body?.code === "INVALID_EMAIL_OR_PASSWORD") return "invalid-credentials";
  return "other";
}

export function passwordLockDedupeKey(accountKey: string, lockedUntilMs: number): string {
  return `sign-in-lock:${accountKey}:${lockedUntilMs}`;
}

export function createMemoryPasswordFailureStore(): PasswordFailureStore {
  const rows = new Map<string, PasswordFailureState>();
  const tails = new Map<string, Promise<void>>();

  async function exclusive<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    read(accountKey, nowMs) {
      return exclusive(accountKey, () =>
        normalisePasswordFailureState(rows.get(accountKey) ?? null, nowMs),
      );
    },
    recordFailure(accountKey, nowMs) {
      return exclusive(accountKey, () => {
        const next = recordConfirmedPasswordFailure(rows.get(accountKey) ?? null, nowMs);
        rows.set(accountKey, next.state);
        return next;
      });
    },
    reset(accountKey) {
      return exclusive(accountKey, () => {
        rows.delete(accountKey);
      });
    },
  };
}

/**
 * Apply one already-classified sign-in result.
 * `mfa-challenge` leaves the counter unchanged.
 * `complete` clears it, unless a pause landed while the password was being checked.
 */
export async function settlePasswordAttempt(input: {
  store: PasswordFailureStore;
  accountKey: string;
  nowMs: number;
  outcome: PasswordAttemptOutcome;
  onJustLocked?: (lockedUntilMs: number) => Promise<void>;
}): Promise<{ result: "success" | "mfa" | "invalid"; justLocked: boolean }> {
  if (input.outcome === "confirmed-incorrect") {
    const recorded = await input.store.recordFailure(input.accountKey, input.nowMs);
    if (recorded.justLocked && recorded.state.lockedUntilMs != null) {
      await input.onJustLocked?.(recorded.state.lockedUntilMs);
    }
    return { result: "invalid", justLocked: recorded.justLocked };
  }

  if (input.outcome === "complete") {
    const state = await input.store.read(input.accountKey, input.nowMs);
    if (passwordAuthRestricted(state, input.nowMs)) {
      return { result: "invalid", justLocked: false };
    }
    await input.store.reset(input.accountKey);
    return { result: "success", justLocked: false };
  }

  if (input.outcome === "mfa-challenge") {
    const state = await input.store.read(input.accountKey, input.nowMs);
    if (passwordAuthRestricted(state, input.nowMs)) {
      return { result: "invalid", justLocked: false };
    }
    return { result: "mfa", justLocked: false };
  }

  return { result: "invalid", justLocked: false };
}
