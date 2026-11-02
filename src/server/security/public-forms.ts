import { securityAccountKey, securityPepper } from "@/server/security/account-key";
import { SECURITY_POLICY, type PublicFormName } from "@/server/security/policy";
import { securityLimiter, type FixedWindowLimiter } from "@/server/security/rate-limit";
import { AuthError } from "@/server/rbac/guards";

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Email and telephone taken from a public form body.
 * These are the rate-limit identities. Network headers are not.
 */
export function publicFormSubjects(data: unknown): { email: string | null; phone: string | null } {
  if (!data || typeof data !== "object") return { email: null, phone: null };
  const record = data as Record<string, unknown>;
  const contact = record["primaryContact"];
  const contactRecord =
    contact && typeof contact === "object" ? (contact as Record<string, unknown>) : null;
  const emailRaw = readString(record, "email") ?? (contactRecord ? readString(contactRecord, "email") : null);
  const phoneRaw =
    readString(record, "telephone") ??
    readString(record, "phone") ??
    (contactRecord ? readString(contactRecord, "phone") : null);
  const email =
    emailRaw && emailRaw.length <= 320 && emailRaw.includes("@") && !/\s/.test(emailRaw)
      ? emailRaw.toLowerCase()
      : null;
  const digits = phoneRaw ? phoneRaw.replace(/\D/g, "") : "";
  const phone = digits.length >= 7 && digits.length <= 20 ? digits : null;
  return { email, phone };
}

export function emailFromPublicPayload(data: unknown): string | null {
  return publicFormSubjects(data).email;
}

function identityRule(form: PublicFormName, kind: "email" | "phone"): { limit: number; windowMs: number } {
  if (form === "trade-application") {
    return kind === "email" ? SECURITY_POLICY.tradeApplicationEmail : SECURITY_POLICY.tradeApplicationPhone;
  }
  if (form === "callback") {
    return kind === "email" ? SECURITY_POLICY.callbackEmail : SECURITY_POLICY.callbackPhone;
  }
  return kind === "email" ? SECURITY_POLICY.motorsportEmail : SECURITY_POLICY.motorsportPhone;
}

/**
 * Limit each email and each telephone on its own.
 * There is no site-wide bucket, and forwarding headers are not a bucket.
 * A body with neither a usable email nor a usable telephone is not given a
 * shared bucket either. The form schema still rejects that body. Repeated
 * abuse from many identities is an edge-firewall concern, not a shared
 * application counter.
 */
export function assessPublicForm(input: {
  form: PublicFormName;
  headers?: Headers;
  payload?: unknown;
  email?: string | null;
  phone?: string | null;
  limiter?: FixedWindowLimiter;
  pepper?: string;
}): { allowed: boolean } {
  const limiter = input.limiter ?? securityLimiter;
  const pepper = input.pepper ?? securityPepper();
  const subjects =
    input.payload !== undefined
      ? publicFormSubjects(input.payload)
      : publicFormSubjects({ email: input.email, telephone: input.phone });
  const email = subjects.email;
  const phone = subjects.phone;
  const checks = [];

  if (email) {
    const rule = identityRule(input.form, "email");
    const key = securityAccountKey(email, pepper);
    checks.push(limiter.take(`${input.form}:email:${key}`, rule.limit, rule.windowMs));
  }
  if (phone) {
    const rule = identityRule(input.form, "phone");
    const key = securityAccountKey(phone, pepper);
    checks.push(limiter.take(`${input.form}:phone:${key}`, rule.limit, rule.windowMs));
  }

  if (checks.length === 0) return { allowed: true };
  return { allowed: checks.every((item) => item.allowed) };
}

export function assertPublicFormAllowed(input: {
  form: PublicFormName;
  headers: Headers;
  payload?: unknown;
  email?: string | null;
  phone?: string | null;
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
