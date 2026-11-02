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
 * The counters are process-local. See `src/server/security/rate-limit.ts`.
 */
export const SECURITY_POLICY = {
  loginAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
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

export type AttemptScope = "login" | "mfa" | "password-reset" | "password-reset-complete";

export type PublicFormName = "trade-application" | "callback" | "motorsport";
