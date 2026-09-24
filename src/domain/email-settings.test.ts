/**
 * Domain + unit tests for email settings validation and SMTP error sanitisation.
 */
import { describe, expect, it } from "vitest";
import {
  emailSettingsUpdateSchema,
  isSenderConfigured,
  isSmtpConfigured,
  normalizeRecipientList,
  validateEmailSettingsSave,
} from "@/domain/email-settings";
import { sanitiseSmtpError } from "@/infra/email/smtp";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret";

describe("email settings validation", () => {
  it("accepts valid update payloads", () => {
    const parsed = emailSettingsUpdateSchema.parse({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "SSL_TLS",
      smtpUsername: "trade@example.com",
      fromEmail: "trade@example.com",
      tradeApplicationRecipients: ["ops@example.com"],
      orderNotificationRecipients: ["orders@example.com", "ops@example.com"],
    });
    expect(parsed.smtpPort).toBe(465);
    expect(parsed.orderNotificationRecipients).toHaveLength(2);
  });

  it("rejects invalid port", () => {
    expect(() => emailSettingsUpdateSchema.parse({ smtpPort: 0 })).toThrow();
    expect(() => emailSettingsUpdateSchema.parse({ smtpPort: 70000 })).toThrow();
  });

  it("rejects invalid email addresses", () => {
    const err = validateEmailSettingsSave(
      { fromEmail: "not-an-email" },
      { hasPassword: true },
    );
    expect(err).toMatch(/email/i);
  });

  it("normalises recipient lists and dedupes", () => {
    expect(
      normalizeRecipientList(["Ops@Example.com", "ops@example.com", "bad", 12]),
    ).toEqual(["ops@example.com"]);
  });

  it("requires host when provided blank", () => {
    const err = validateEmailSettingsSave(
      { smtpHost: "  " },
      { hasPassword: true },
    );
    expect(err).toMatch(/host/i);
  });

  it("configured flags", () => {
    expect(
      isSmtpConfigured({
        smtpHost: "h",
        smtpUsername: "u",
        smtpPasswordConfigured: true,
      }),
    ).toBe(true);
    expect(
      isSmtpConfigured({
        smtpHost: "h",
        smtpUsername: "u",
        smtpPasswordConfigured: false,
      }),
    ).toBe(false);
    expect(isSenderConfigured({ fromEmail: "a@b.com" })).toBe(true);
    expect(isSenderConfigured({ fromEmail: null })).toBe(false);
  });
});

describe("secret encryption", () => {
  it("round-trips SMTP passwords", () => {
    const cipher = encryptSecret("siteground-secret");
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(decryptSecret(cipher)).toBe("siteground-secret");
  });

  it("returns null for invalid ciphertext", () => {
    expect(decryptSecret("not-valid")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
});

describe("sanitiseSmtpError", () => {
  it("maps common failures without leaking credentials", () => {
    expect(sanitiseSmtpError(new Error("Invalid login: 535"))).toBe("Authentication failed");
    expect(sanitiseSmtpError(new Error("connect ETIMEDOUT"))).toBe("Connection timed out");
    expect(sanitiseSmtpError(new Error("getaddrinfo ENOTFOUND smtp.bad"))).toBe(
      "Unable to resolve SMTP host",
    );
    expect(sanitiseSmtpError(new Error("SSL routines wrong version number"))).toBe(
      "TLS connection failed",
    );
    expect(sanitiseSmtpError(new Error("ECONNREFUSED"))).toBe("SMTP server rejected connection");
    const msg = sanitiseSmtpError(new Error("password=secret123 auth fail"));
    expect(msg).not.toContain("secret123");
  });
});
