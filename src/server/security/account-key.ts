import { createHash } from "node:crypto";

/**
 * Stable, non-reversible grouping key for an email address.
 * The address itself is not stored in security alerts.
 */
export function securityAccountKey(email: string, pepper: string): string {
  const normalised = email.trim().toLowerCase().slice(0, 320);
  return createHash("sha256")
    .update(`ab-security-v1\n${pepper}\n${normalised}`)
    .digest("hex")
    .slice(0, 32);
}

export function securityPepper(): string {
  return process.env["AUTH_SECRET"]?.trim() || "dev-only-change-me-to-a-long-random-string!!";
}
