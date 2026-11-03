import { securityAccountKey, securityPepper } from "@/server/security/account-key";
import { clientAddress } from "@/server/security/client-address";
import { SECURITY_POLICY, type AttemptScope } from "@/server/security/policy";
import { securityLimiter, type FixedWindowLimiter } from "@/server/security/rate-limit";

export type AttemptDecision = {
  allowed: boolean;
  accountKey: string | null;
  /** Hash of the sign-in cookie for authenticator attempts. Not an IP address. */
  clientKey: string | null;
  trustedAddress: null;
};

function allow(decision: { allowed: boolean }[]): boolean {
  return decision.every((item) => item.allowed);
}

/**
 * Limit credential attempts before a password or reset token is checked.
 * Forwarding headers are ignored. A missing address does not remove the
 * per-account, per-token, or per-cookie limit.
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
  const address = clientAddress(input.headers);
  const subject = input.subject?.trim() ?? "";
  const pepper = input.pepper ?? securityPepper();
  const accountKey = subject ? securityAccountKey(subject, pepper) : null;
  const cookie = input.headers.get("cookie")?.trim() ?? "";
  const clientKey = cookie ? securityAccountKey(cookie, pepper) : null;
  const checks = [];

  if (input.scope === "mfa") {
    if (clientKey) {
      const rule = SECURITY_POLICY.mfaCookie;
      checks.push(limiter.take(`mfa:cookie:${clientKey}`, rule.limit, rule.windowMs));
    }
  } else if (input.scope === "password-reset") {
    if (accountKey) {
      const rule = SECURITY_POLICY.passwordResetAccount;
      checks.push(limiter.take(`reset:account:${accountKey}`, rule.limit, rule.windowMs));
    }
  } else if (accountKey) {
    const rule = SECURITY_POLICY.passwordResetCompleteToken;
    checks.push(limiter.take(`reset-complete:token:${accountKey}`, rule.limit, rule.windowMs));
  }

  const decision = {
    accountKey,
    clientKey,
    trustedAddress: address.address,
  };
  if (checks.length === 0) {
    return { allowed: true, ...decision };
  }
  return { allowed: allow(checks), ...decision };
}
