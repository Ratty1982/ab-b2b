import { securityAccountKey, securityPepper } from "@/server/security/account-key";
import { clientAddress } from "@/server/security/client-address";
import { SECURITY_POLICY, type PublicFormName } from "@/server/security/policy";
import { securityLimiter, type FixedWindowLimiter } from "@/server/security/rate-limit";
import { AuthError } from "@/server/rbac/guards";

export function emailFromPublicPayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const direct = record["email"];
  if (typeof direct === "string" && direct.includes("@")) return direct;
  const contact = record["primaryContact"];
  if (contact && typeof contact === "object") {
    const email = (contact as Record<string, unknown>)["email"];
    if (typeof email === "string" && email.includes("@")) return email;
  }
  return null;
}

export function assessPublicForm(input: {
  form: PublicFormName;
  headers: Headers;
  email?: string | null;
  limiter?: FixedWindowLimiter;
  pepper?: string;
}): { allowed: boolean } {
  const limiter = input.limiter ?? securityLimiter;
  const ip = clientAddress(input.headers);
  const checks = [];

  if (input.form === "trade-application") {
    const ipRule = SECURITY_POLICY.tradeApplicationIp;
    const emailRule = SECURITY_POLICY.tradeApplicationEmail;
    const globalRule = SECURITY_POLICY.tradeApplicationGlobal;
    if (ip !== "unknown") checks.push(limiter.take(`apply:ip:${ip}`, ipRule.limit, ipRule.windowMs));
    if (input.email) {
      const key = securityAccountKey(input.email, input.pepper ?? securityPepper());
      checks.push(limiter.take(`apply:email:${key}`, emailRule.limit, emailRule.windowMs));
    }
    checks.push(limiter.take("apply:global", globalRule.limit, globalRule.windowMs));
  } else if (input.form === "callback") {
    const ipRule = SECURITY_POLICY.callbackIp;
    const globalRule = SECURITY_POLICY.callbackGlobal;
    if (ip !== "unknown") checks.push(limiter.take(`callback:ip:${ip}`, ipRule.limit, ipRule.windowMs));
    checks.push(limiter.take("callback:global", globalRule.limit, globalRule.windowMs));
  } else {
    const ipRule = SECURITY_POLICY.motorsportIp;
    const globalRule = SECURITY_POLICY.motorsportGlobal;
    if (ip !== "unknown") checks.push(limiter.take(`motorsport:ip:${ip}`, ipRule.limit, ipRule.windowMs));
    checks.push(limiter.take("motorsport:global", globalRule.limit, globalRule.windowMs));
  }

  return { allowed: checks.every((item) => item.allowed) };
}

export function assertPublicFormAllowed(input: {
  form: PublicFormName;
  headers: Headers;
  email?: string | null;
}): void {
  const decision = assessPublicForm(input);
  if (!decision.allowed) {
    throw new AuthError(
      "Please wait a few minutes before sending another message.",
      "RATE_LIMITED",
      429,
    );
  }
}
