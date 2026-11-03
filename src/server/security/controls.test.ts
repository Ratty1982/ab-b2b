import { describe, expect, it } from "vitest";

import { auditEventCreateData } from "@/server/audit/record";
import { securityAccountKey } from "@/server/security/account-key";
import { buildSecurityAlertMessage, securityAlertRecipient } from "@/server/security/alert-message";
import { assessAttempt } from "@/server/security/attempts";
import { clientAddress } from "@/server/security/client-address";
import { SECURITY_POLICY } from "@/server/security/policy";
import { assessPublicForm } from "@/server/security/public-forms";
import { createFixedWindowLimiter } from "@/server/security/rate-limit";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("security rate limits", () => {
  it("limits authenticator guesses per sign-in cookie, not per forwarded address", () => {
    const limiter = createFixedWindowLimiter(() => 6_000);
    const first = headers({ cookie: "session=one", "x-forwarded-for": "203.0.113.1" });
    const second = headers({ cookie: "session=two", "cf-connecting-ip": "203.0.113.1" });
    for (let i = 0; i < SECURITY_POLICY.mfaCookie.limit; i += 1) {
      expect(
        assessAttempt({ scope: "mfa", headers: first, limiter, pepper: "test-pepper" }).allowed,
      ).toBe(true);
    }
    expect(assessAttempt({ scope: "mfa", headers: first, limiter, pepper: "test-pepper" }).allowed).toBe(
      false,
    );
    expect(assessAttempt({ scope: "mfa", headers: second, limiter, pepper: "test-pepper" }).allowed).toBe(
      true,
    );
    for (let i = 0; i < 30; i += 1) {
      expect(
        assessAttempt({
          scope: "mfa",
          headers: headers({ "x-real-ip": `198.51.100.${i}` }),
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    expect(assessAttempt({ scope: "mfa", headers: second, limiter, pepper: "test-pepper" }).allowed).toBe(
      true,
    );
  });

  it("ignores forged, conflicting, missing and proxy-shaped forwarding headers", () => {
    const forged = clientAddress(
      headers({
        "cf-connecting-ip": "203.0.113.9",
        "x-real-ip": "198.51.100.8",
        "x-forwarded-for": "203.0.113.8, 10.0.0.1",
      }),
    );
    const missing = clientAddress(headers({}));
    const notAnAddress = clientAddress(headers({ "x-forwarded-for": "not an address" }));
    const proxyShaped = clientAddress(
      headers({
        "cf-connecting-ip": "203.0.113.50",
        "x-real-ip": "203.0.113.50",
        "x-forwarded-for": "203.0.113.50, 172.16.0.1",
      }),
    );
    for (const result of [forged, missing, notAnAddress, proxyShaped]) {
      expect(result.trusted).toBe(false);
      expect(result.address).toBeNull();
      expect(result.reason).toBe("no-trusted-proxy-configured");
    }
  });

  it("does not let one trade-application sender use up another sender's allowance", () => {
    const limiter = createFixedWindowLimiter(() => 9_000);
    const attacker = {
      primaryContact: { email: "office@garage.example", phone: "0121 000 0000" },
    };
    for (let i = 0; i < SECURITY_POLICY.tradeApplicationEmail.limit; i += 1) {
      expect(
        assessPublicForm({
          form: "trade-application",
          headers: headers({
            "cf-connecting-ip": "203.0.113.20",
            "x-forwarded-for": "198.51.100.20, 10.0.0.1",
          }),
          payload: attacker,
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    expect(
      assessPublicForm({
        form: "trade-application",
        headers: headers({}),
        payload: attacker,
        limiter,
        pepper: "test-pepper",
      }).allowed,
    ).toBe(false);
    expect(
      assessPublicForm({
        form: "trade-application",
        headers: headers({ "cf-connecting-ip": "203.0.113.21", "x-real-ip": "198.51.100.99" }),
        payload: { primaryContact: { email: "other@garage.example", phone: "0121 111 1111" } },
        limiter,
        pepper: "test-pepper",
      }).allowed,
    ).toBe(true);
  });

  it("does not let anonymous callback traffic exhaust a shared form bucket", () => {
    const limiter = createFixedWindowLimiter(() => 9_000);
    for (let i = 0; i < 45; i += 1) {
      expect(
        assessPublicForm({
          form: "callback",
          headers: headers({ "x-forwarded-for": `203.0.113.${i % 20}` }),
          payload: { email: `person-${i}@customer.example`, message: "please call" },
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    for (let i = 0; i < 20; i += 1) {
      expect(
        assessPublicForm({
          form: "callback",
          headers: headers({}),
          payload: { message: `no contact ${i}` },
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    for (let i = 0; i < SECURITY_POLICY.callbackEmail.limit; i += 1) {
      expect(
        assessPublicForm({
          form: "callback",
          payload: { email: "kept@customer.example" },
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    expect(
      assessPublicForm({
        form: "callback",
        headers: headers({ "cf-connecting-ip": "203.0.113.77" }),
        payload: { email: "kept@customer.example" },
        limiter,
        pepper: "test-pepper",
      }).allowed,
    ).toBe(false);
    expect(
      assessPublicForm({
        form: "motorsport",
        payload: { email: "partner@example.com" },
        limiter,
        pepper: "test-pepper",
      }).allowed,
    ).toBe(true);
  });

  it("limits password-reset completion without keeping the raw token", () => {
    const limiter = createFixedWindowLimiter(() => 9_000);
    const token = "reset-token-value-not-stored";
    for (let i = 0; i < SECURITY_POLICY.passwordResetCompleteToken.limit; i += 1) {
      expect(
        assessAttempt({
          scope: "password-reset-complete",
          headers: headers({ "x-real-ip": `198.51.100.${i}` }),
          subject: token,
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    const blocked = assessAttempt({
      scope: "password-reset-complete",
      headers: headers({ "cf-connecting-ip": "203.0.113.31", "x-forwarded-for": "10.1.1.1" }),
      subject: token,
      limiter,
      pepper: "test-pepper",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.accountKey).not.toContain(token);
    expect(blocked.accountKey).not.toContain("reset-token");
    expect(blocked.trustedAddress).toBeNull();
  });
});

describe("security alert content", () => {
  it("builds a notice without passwords, tokens, or email addresses", () => {
    const message = buildSecurityAlertMessage({
      kind: "REPEATED_LOGIN_FAILURE",
      summary: "Repeated sign-in attempts were blocked.",
      occurredAt: new Date("2026-11-02T17:00:00.000Z"),
    });
    expect(message.subject.toLowerCase()).toContain("security alert");
    expect(message.text.toLowerCase()).not.toContain("password");
    expect(message.text.toLowerCase()).not.toContain("token");
    expect(message.text).not.toMatch(/@/);
  });

  it("accepts one configured recipient and ignores a list", () => {
    const previous = process.env["SECURITY_ALERT_EMAIL"];
    process.env["SECURITY_ALERT_EMAIL"] = "security@automotivebrands.co.uk";
    expect(securityAlertRecipient()).toBe("security@automotivebrands.co.uk");
    process.env["SECURITY_ALERT_EMAIL"] = "one@example.com, two@example.com";
    expect(securityAlertRecipient()).toBeNull();
    process.env["SECURITY_ALERT_EMAIL"] = "";
    expect(securityAlertRecipient()).toBeNull();
    if (previous == null) delete process.env["SECURITY_ALERT_EMAIL"];
    else process.env["SECURITY_ALERT_EMAIL"] = previous;
  });

  it("does not store the email address in the account key", () => {
    const email = "buyer@customer.example";
    const key = securityAccountKey(email, "pepper");
    expect(key).not.toContain("buyer");
    expect(key).not.toContain("@");
    expect(securityAccountKey(email, "pepper")).toBe(key);
    expect(securityAccountKey(email, "other")).not.toBe(key);
  });
});

describe("audit redaction", () => {
  it("removes secrets and bounds client details", () => {
    const data = auditEventCreateData({
      action: "LOGIN_FAILED",
      entityType: "User",
      ipAddress: "203.0.113.10\ninjected",
      userAgent: `Mozilla\r\n${"A".repeat(500)}`,
      metadata: {
        accountKey: "abc",
        password: "hunter2",
        refreshToken: "refresh-value",
        nested: { accessToken: "access-value", note: "kept" },
      },
    });
    expect(data.ipAddress).toBe("203.0.113.10 injected");
    expect(data.userAgent?.length).toBeLessThanOrEqual(300);
    expect(data.userAgent).not.toContain("\n");
    const metadata = data.metadata as {
      accountKey: string;
      password: string;
      refreshToken: string;
      nested: { accessToken: string; note: string };
    };
    expect(metadata.accountKey).toBe("abc");
    expect(metadata.password).toBe("[redacted]");
    expect(metadata.refreshToken).toBe("[redacted]");
    expect(metadata.nested.accessToken).toBe("[redacted]");
    expect(metadata.nested.note).toBe("kept");
  });
});
