/**
 * Autopart IMAP password helpers — thin wrappers over shared AES-256-GCM encryption.
 */
export { encryptSecret as encryptImapPassword, decryptSecret as decryptImapPassword } from "@/server/crypto/secret";
