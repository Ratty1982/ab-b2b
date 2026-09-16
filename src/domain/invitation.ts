import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const COMPANY_USER_ROLES = [
  "TRADE_ADMIN",
  "TRADE_BUYER",
  "TRADE_ACCOUNTS",
  "TRADE_READ_ONLY",
] as const;

export const inviteUserSchema = z.object({
  companyId: z.string().cuid(),
  email: z.string().trim().email().max(320),
  role: z.enum(COMPANY_USER_ROLES).default("TRADE_BUYER"),
  /** Days until invite expires */
  expiresInDays: z.number().int().min(1).max(30).default(14),
});

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}
