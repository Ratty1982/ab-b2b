/**
 * AES-256-GCM for Microsoft refresh and access tokens.
 * New ciphertext is v2 and uses MICROSOFT_365_ENCRYPTION_KEY only.
 * v1 ciphertext from the shared AUTH_SECRET helper can still be read so a
 * connection saved before this key existed can be disconnected or refreshed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { Microsoft365Error } from "@/domain/microsoft-365-crm";
import { decryptSecret } from "@/server/crypto/secret";

const MIN_KEY_LENGTH = 32;

function dedicatedKey(): Buffer | null {
  const raw = process.env["MICROSOFT_365_ENCRYPTION_KEY"]?.trim();
  if (!raw || raw.length < MIN_KEY_LENGTH) return null;
  return createHash("sha256").update(raw).digest();
}

function open(stored: string, key: Buffer): string | null {
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Encrypt a Microsoft token. Throws when the dedicated key is missing. */
export function encryptMicrosoftToken(plain: string): string {
  const key = dedicatedKey();
  if (!key) {
    throw new Microsoft365Error("NOT_CONFIGURED", "Microsoft 365 encryption key is not configured");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Decrypt a Microsoft token.
 * v2 uses MICROSOFT_365_ENCRYPTION_KEY. v1 uses AUTH_SECRET, for ciphertext written before the dedicated key.
 */
export function decryptMicrosoftToken(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  if (stored.startsWith("v2:")) {
    const key = dedicatedKey();
    if (!key) return null;
    return open(stored, key);
  }
  if (stored.startsWith("v1:")) return decryptSecret(stored);
  return null;
}
