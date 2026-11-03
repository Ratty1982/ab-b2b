import { createOTP } from "@better-auth/utils/otp";
import { describe, expect, it } from "vitest";

/**
 * Same TOTP helper Better Auth 1.7.4 uses (digits 6, period 30, window 1).
 * This checks the code window. It does not open a database session.
 */
describe("authenticator code window", () => {
  const otp = createOTP("automotive-brands-totp-test-secret", { digits: 6, period: 30 });

  it("accepts the current code and rejects a different code", async () => {
    const code = await otp.totp();
    expect(code).toMatch(/^\d{6}$/);
    expect(await otp.verify(code)).toBe(true);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await otp.verify(wrong)).toBe(false);
  });

  it("rejects a code from two periods ago and still accepts the previous period", async () => {
    const periodMs = 30_000;
    const counter = Math.floor(Date.now() / periodMs);
    const previous = await otp.hotp(counter - 1);
    const expired = await otp.hotp(counter - 2);
    expect(await otp.verify(previous)).toBe(true);
    if (expired !== previous) {
      expect(await otp.verify(expired)).toBe(false);
    }
  });
});
