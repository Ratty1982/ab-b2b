/**
 * Application-level security thresholds.
 *
 * These limits sit on the server functions the website actually calls.
 * Better Auth's HTTP rate limit does not cover those functions.
 *
 * There is no trusted client-address source in this repository, so none of
 * these buckets are keyed by `CF-Connecting-IP`, `X-Real-IP` or
 * `X-Forwarded-For`. A site-wide bucket is also omitted: one sender must not
 * be able to use it up for everyone else.
 *
 * Password guessing is not counted here. Confirmed incorrect passwords use
 * the shared database counter in `src/server/security/password-failure.ts`.
 * The remaining counters are process-local. See `src/server/security/rate-limit.ts`.
 */
export const SECURITY_POLICY = {
  mfaCookie: { limit: 10, windowMs: 10 * 60 * 1000 },
  passwordResetAccount: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordResetCompleteToken: { limit: 10, windowMs: 60 * 60 * 1000 },
  tradeApplicationEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
  tradeApplicationPhone: { limit: 5, windowMs: 60 * 60 * 1000 },
  callbackEmail: { limit: 8, windowMs: 60 * 60 * 1000 },
  callbackPhone: { limit: 8, windowMs: 60 * 60 * 1000 },
  motorsportEmail: { limit: 5, windowMs: 60 * 60 * 1000 },
  motorsportPhone: { limit: 5, windowMs: 60 * 60 * 1000 },
  exportAlertCount: 30,
  exportAlertWindowMs: 60 * 60 * 1000,
  alertCooldownMs: 60 * 60 * 1000,
} as const;

export type AttemptScope = "mfa" | "password-reset" | "password-reset-complete";

export type PublicFormName = "trade-application" | "callback" | "motorsport";
