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
  it("blocks the next sign-in for one account after the configured limit", () => {
    let now = 1_000_000;
    const limiter = createFixedWindowLimiter(() => now);
    const requestHeaders = headers({ "x-real-ip": "203.0.113.10" });
    for (let i = 0; i < SECURITY_POLICY.loginAccount.limit; i += 1) {
      const decision = assessAttempt({
        scope: "login",
        headers: requestHeaders,
        subject: "buyer@customer.example",
        limiter,
        pepper: "test-pepper",
      });
      expect(decision.allowed).toBe(true);
    }
    const blocked = assessAttempt({
      scope: "login",
      headers: requestHeaders,
      subject: "buyer@customer.example",
      limiter,
      pepper: "test-pepper",
    });
    expect(blocked.allowed).toBe(false);
    const otherAccount = assessAttempt({
      scope: "login",
      headers: requestHeaders,
      subject: "other@customer.example",
      limiter,
      pepper: "test-pepper",
    });
    expect(otherAccount.allowed).toBe(true);
  });

  it("does not treat a missing address as one shared sign-in bucket", () => {
    const limiter = createFixedWindowLimiter(() => 5_000);
    for (let i = 0; i < SECURITY_POLICY.loginAccount.limit; i += 1) {
      assessAttempt({
        scope: "login",
        headers: headers({}),
        subject: `person-${i}@customer.example`,
        limiter,
        pepper: "test-pepper",
      });
    }
    const next = assessAttempt({
      scope: "login",
      headers: headers({}),
      subject: "fresh@customer.example",
      limiter,
      pepper: "test-pepper",
    });
    expect(next.allowed).toBe(true);
    expect(next.ip).toBe("unknown");
  });

  it("uses a single IP header and ignores a value that is not an IP", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "not an address" }))).toBe("unknown");
    expect(clientAddress(headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" }))).toBe(
      "203.0.113.8",
    );
    expect(clientAddress(headers({ "cf-connecting-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("limits public trade applications by email and by a site-wide ceiling", () => {
    const limiter = createFixedWindowLimiter(() => 9_000);
    const requestHeaders = headers({ "x-real-ip": "198.51.100.20" });
    for (let i = 0; i < SECURITY_POLICY.tradeApplicationEmail.limit; i += 1) {
      expect(
        assessPublicForm({
          form: "trade-application",
          headers: requestHeaders,
          email: "office@garage.example",
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    expect(
      assessPublicForm({
        form: "trade-application",
        headers: headers({ "x-real-ip": "198.51.100.21" }),
        email: "office@garage.example",
        limiter,
        pepper: "test-pepper",
      }).allowed,
    ).toBe(false);
  });

  it("limits password-reset completion without keeping the raw token", () => {
    const limiter = createFixedWindowLimiter(() => 9_000);
    const token = "reset-token-value-not-stored";
    for (let i = 0; i < SECURITY_POLICY.passwordResetCompleteIp.limit; i += 1) {
      expect(
        assessAttempt({
          scope: "password-reset-complete",
          headers: headers({ "x-real-ip": "198.51.100.30" }),
          subject: token,
          limiter,
          pepper: "test-pepper",
        }).allowed,
      ).toBe(true);
    }
    const blocked = assessAttempt({
      scope: "password-reset-complete",
      headers: headers({ "x-real-ip": "198.51.100.31" }),
      subject: token,
      limiter,
      pepper: "test-pepper",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.accountKey).not.toContain(token);
    expect(blocked.accountKey).not.toContain("reset-token");
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
