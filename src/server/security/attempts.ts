import { securityAccountKey, securityPepper } from "@/server/security/account-key";
import { clientAddress } from "@/server/security/client-address";
import { SECURITY_POLICY, type AttemptScope } from "@/server/security/policy";
import { securityLimiter, type FixedWindowLimiter } from "@/server/security/rate-limit";

export type AttemptDecision = {
  allowed: boolean;
  accountKey: string | null;
  ip: string;
};

function allow(decision: { allowed: boolean }[]): boolean {
  return decision.every((item) => item.allowed);
}

/**
 * Limit credential attempts before a password or reset token is checked.
 * An unknown IP is not used as a shared bucket.
 */
export function assessAttempt(input: {
  scope: AttemptScope;
  headers: Headers;
  /** Email address, or a reset token. Only a hash of this value is kept. */
  subject?: string | null;
  limiter?: FixedWindowLimiter;
  pepper?: string;
}): AttemptDecision {
  const limiter = input.limiter ?? securityLimiter;
  const ip = clientAddress(input.headers);
  const subject = input.subject?.trim() ?? "";
  const pepper = input.pepper ?? securityPepper();
  const accountKey = subject ? securityAccountKey(subject, pepper) : null;
  const checks = [];

  if (input.scope === "login") {
    if (accountKey) {
      const rule = SECURITY_POLICY.loginAccount;
      checks.push(limiter.take(`login:account:${accountKey}`, rule.limit, rule.windowMs));
    }
    if (ip !== "unknown") {
      const rule = SECURITY_POLICY.loginIp;
      checks.push(limiter.take(`login:ip:${ip}`, rule.limit, rule.windowMs));
    }
  } else if (input.scope === "mfa") {
    const rule = SECURITY_POLICY.mfaIp;
    const cookie = input.headers.get("cookie")?.trim() ?? "";
    const bucket =
      ip !== "unknown"
        ? `mfa:ip:${ip}`
        : cookie
          ? `mfa:cookie:${securityAccountKey(cookie, pepper)}`
          : null;
    if (bucket) checks.push(limiter.take(bucket, rule.limit, rule.windowMs));
  } else if (input.scope === "password-reset") {
    if (accountKey) {
      const rule = SECURITY_POLICY.passwordResetAccount;
      checks.push(limiter.take(`reset:account:${accountKey}`, rule.limit, rule.windowMs));
    }
    if (ip !== "unknown") {
      const rule = SECURITY_POLICY.passwordResetIp;
      checks.push(limiter.take(`reset:ip:${ip}`, rule.limit, rule.windowMs));
    }
  } else {
    const rule = SECURITY_POLICY.passwordResetCompleteIp;
    if (ip !== "unknown") {
      checks.push(limiter.take(`reset-complete:ip:${ip}`, rule.limit, rule.windowMs));
    }
    if (accountKey) {
      checks.push(limiter.take(`reset-complete:token:${accountKey}`, rule.limit, rule.windowMs));
    }
  }

  if (checks.length === 0) {
    return { allowed: true, accountKey, ip };
  }
  return { allowed: allow(checks), accountKey, ip };
}
