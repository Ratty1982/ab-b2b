import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSecurityAlertMessage } from "@/server/security/alert-message";
import {
  PASSWORD_FAILURE_LIMIT,
  PASSWORD_FAILURE_WINDOW_MS,
  PASSWORD_LOCK_ALERT_KIND,
  PASSWORD_LOCK_ALERT_SUMMARY,
  PASSWORD_LOCK_MS,
  UNAUTHENTICATED_SIGN_IN_ERROR,
  classifyPasswordSignInError,
  createMemoryPasswordFailureStore,
  passwordAuthRestricted,
  passwordLockDedupeKey,
  recordConfirmedPasswordFailure,
  settlePasswordAttempt,
  shouldCountPasswordFailure,
} from "@/server/security/password-failure";
import {
  PASSWORD_FAILURE_STATEMENT_TIMEOUT_MS,
  REDIS_SIGN_IN_POLICY,
} from "@/server/security/password-failure-store";

const KEY = "account-key";

describe("confirmed password failures", () => {
  it("pauses password sign-in on the fifth failure inside 15 minutes", () => {
    let state = null;
    const start = 1_000_000;
    for (let i = 0; i < PASSWORD_FAILURE_LIMIT - 1; i += 1) {
      const next = recordConfirmedPasswordFailure(state, start + i * 1_000);
      state = next.state;
      expect(next.justLocked).toBe(false);
      expect(passwordAuthRestricted(state, start + i * 1_000)).toBe(false);
    }
    const fifth = recordConfirmedPasswordFailure(state, start + 4_000);
    expect(fifth.justLocked).toBe(true);
    expect(fifth.state.failureCount).toBe(5);
    expect(fifth.state.lockedUntilMs).toBe(start + 4_000 + PASSWORD_LOCK_MS);
    expect(passwordAuthRestricted(fifth.state, start + 4_000 + PASSWORD_LOCK_MS - 1)).toBe(true);
  });

  it("starts a fresh count when the 15-minute window has elapsed", () => {
    let state = recordConfirmedPasswordFailure(null, 0).state;
    state = recordConfirmedPasswordFailure(state, 1_000).state;
    const later = recordConfirmedPasswordFailure(state, PASSWORD_FAILURE_WINDOW_MS);
    expect(later.justLocked).toBe(false);
    expect(later.state.failureCount).toBe(1);
    expect(passwordAuthRestricted(later.state, PASSWORD_FAILURE_WINDOW_MS)).toBe(false);
  });

  it("allows password sign-in again when the pause expires", () => {
    let state = null;
    for (let i = 0; i < PASSWORD_FAILURE_LIMIT; i += 1) {
      state = recordConfirmedPasswordFailure(state, 10_000).state;
    }
    const lockedUntil = state?.lockedUntilMs ?? 0;
    expect(passwordAuthRestricted(state, lockedUntil - 1)).toBe(true);
    expect(passwordAuthRestricted(state, lockedUntil)).toBe(false);
    const after = recordConfirmedPasswordFailure(state, lockedUntil);
    expect(after.justLocked).toBe(false);
    expect(after.state.failureCount).toBe(1);
  });

  it("clears the count after a completed sign-in and not when authenticator setup starts", async () => {
    const store = createMemoryPasswordFailureStore();
    for (let i = 0; i < 4; i += 1) {
      await settlePasswordAttempt({
        store,
        accountKey: KEY,
        nowMs: 5_000,
        outcome: "confirmed-incorrect",
      });
    }
    const challenged = await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 5_000,
      outcome: "mfa-challenge",
    });
    expect(challenged.result).toBe("mfa");
    expect((await store.read(KEY, 5_000))?.failureCount).toBe(4);

    const finished = await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 6_000,
      outcome: "complete",
    });
    expect(finished.result).toBe("success");
    expect(await store.read(KEY, 6_000)).toBeNull();
  });

  it("does not clear or increase the count for a blocked account or an unknown address", async () => {
    const store = createMemoryPasswordFailureStore();
    await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 1,
      outcome: "confirmed-incorrect",
    });
    await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 2,
      outcome: "account-blocked",
    });
    await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 3,
      outcome: "unknown",
    });
    expect((await store.read(KEY, 3))?.failureCount).toBe(1);
    expect(shouldCountPasswordFailure({
      hasCredentialAccount: false,
      classification: "invalid-credentials",
    })).toBe(false);
    expect(shouldCountPasswordFailure({
      hasCredentialAccount: true,
      classification: "account-blocked",
    })).toBe(false);
    expect(shouldCountPasswordFailure({
      hasCredentialAccount: true,
      classification: "invalid-credentials",
    })).toBe(true);
  });

  it("does not let a completed sign-in clear a pause that landed during the check", async () => {
    const store = createMemoryPasswordFailureStore();
    for (let i = 0; i < PASSWORD_FAILURE_LIMIT; i += 1) {
      await store.recordFailure(KEY, 20);
    }
    const raced = await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 21,
      outcome: "complete",
    });
    expect(raced.result).toBe("invalid");
    expect((await store.read(KEY, 21))?.failureCount).toBe(5);
    const challenged = await settlePasswordAttempt({
      store,
      accountKey: KEY,
      nowMs: 22,
      outcome: "mfa-challenge",
    });
    expect(challenged.result).toBe("invalid");
  });

  it("emits one lock notice when many confirmed failures arrive together", async () => {
    const store = createMemoryPasswordFailureStore();
    const lockedUntil: number[] = [];
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        settlePasswordAttempt({
          store,
          accountKey: KEY,
          nowMs: 50_000,
          outcome: "confirmed-incorrect",
          onJustLocked: async (until) => {
            lockedUntil.push(until);
          },
        }),
      ),
    );
    expect(results.filter((result) => result.justLocked)).toHaveLength(1);
    expect(lockedUntil).toHaveLength(1);
    expect(new Set(lockedUntil.map((until) => passwordLockDedupeKey(KEY, until))).size).toBe(1);
    const state = await store.read(KEY, 50_000);
    expect(state?.failureCount).toBe(PASSWORD_FAILURE_LIMIT);
    expect(passwordAuthRestricted(state, 50_000)).toBe(true);
    const other = await store.read("other-account", 50_000);
    expect(other).toBeNull();
  });

  it("keeps the visitor message free of status and remaining attempts", () => {
    const message = UNAUTHENTICATED_SIGN_IN_ERROR.toLowerCase();
    expect(UNAUTHENTICATED_SIGN_IN_ERROR).toBe("Invalid email or password");
    expect(message).not.toContain("remain");
    expect(message).not.toContain("disabled");
    expect(message).not.toContain("locked");
    expect(message).not.toContain("attempt");
    expect(message).not.toContain("exist");
    const notice = buildSecurityAlertMessage({
      kind: PASSWORD_LOCK_ALERT_KIND,
      summary: PASSWORD_LOCK_ALERT_SUMMARY,
      occurredAt: new Date("2026-11-02T22:00:00.000Z"),
    });
    expect(notice.text.toLowerCase()).not.toContain("password");
    expect(notice.text.toLowerCase()).not.toContain("token");
    expect(notice.text).not.toContain("@");
    expect(classifyPasswordSignInError({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } })).toBe(
      "invalid-credentials",
    );
    expect(classifyPasswordSignInError(new Error("Account is disabled"))).toBe("account-blocked");
  });

  it("defines a database timeout and does not call Redis", () => {
    expect(REDIS_SIGN_IN_POLICY.used).toBe(false);
    expect(REDIS_SIGN_IN_POLICY.commandTimeoutMs).toBe(200);
    expect(REDIS_SIGN_IN_POLICY.retries).toBe(0);
    expect(REDIS_SIGN_IN_POLICY.onTimeout).toBe("fail-open");
    expect(REDIS_SIGN_IN_POLICY.onConnectionError).toBe("fail-open");
    expect(PASSWORD_FAILURE_STATEMENT_TIMEOUT_MS).toBe(1500);
    const store = readFileSync(
      join(process.cwd(), "src/server/security/password-failure-store.ts"),
      "utf8",
    );
    expect(store).toContain("FOR UPDATE");
    expect(store).toContain("statement_timeout");
    expect(store).toContain("Redis is not consulted");
    expect(store).not.toContain("ioredis");
    expect(store).not.toContain("redis.createClient");
    const session = readFileSync(join(process.cwd(), "src/server/auth/session.ts"), "utf8");
    expect(session).toContain("UNAUTHENTICATED_SIGN_IN_ERROR");
    expect(session).toContain("settlePasswordAttempt");
    expect(session).not.toContain("Too many sign-in attempts");
    expect(session).not.toContain('scope: "login"');
  });
});
