/**
 * Server-only AES-256-GCM secret encryption.
 * Reuses the established AUTH_SECRET key derivation used by Autopart IMAP credentials.
 * Never import from client/route modules.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFromSecret(): Buffer {
  const secret = process.env["AUTH_SECRET"]?.trim() || "dev-only-change-me-to-a-long-random-string!!";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a secret. Output format: v1:iv:tag:ciphertext (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a secret stored by encryptSecret. Returns null on missing/invalid ciphertext. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const parts = stored.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
