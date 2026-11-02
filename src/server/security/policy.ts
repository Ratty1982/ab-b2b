/**
 * Application-level security thresholds.
 * These limits sit in front of the sign-in server functions. Better Auth's
 * HTTP rate limit does not cover those functions, because the login page
 * calls them directly.
 */
export const SECURITY_POLICY = {
  loginAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  loginIp: { limit: 80, windowMs: 15 * 60 * 1000 },
  mfaIp: { limit: 10, windowMs: 10 * 60 * 1000 },
  passwordResetAccount: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordResetIp: { limit: 12, windowMs: 60 * 60 * 1000 },
  passwordResetCompleteIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  tradeApplicationIp: { limit: 5, windowMs: 60 * 60 * 1000 },
  tradeApplicationEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
  tradeApplicationGlobal: { limit: 30, windowMs: 10 * 60 * 1000 },
  callbackIp: { limit: 8, windowMs: 60 * 60 * 1000 },
  callbackGlobal: { limit: 40, windowMs: 10 * 60 * 1000 },
  motorsportIp: { limit: 5, windowMs: 60 * 60 * 1000 },
  motorsportGlobal: { limit: 20, windowMs: 10 * 60 * 1000 },
  exportAlertCount: 30,
  exportAlertWindowMs: 60 * 60 * 1000,
  alertCooldownMs: 60 * 60 * 1000,
} as const;

export type AttemptScope = "login" | "mfa" | "password-reset" | "password-reset-complete";

export type PublicFormName = "trade-application" | "callback" | "motorsport";
