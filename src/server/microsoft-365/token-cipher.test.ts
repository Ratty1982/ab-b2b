import { afterEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/server/crypto/secret";
import { decryptMicrosoftToken, encryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";

const DEDICATED = "microsoft-dedicated-key-at-least-32-characters";
const AUTH = "auth-secret-for-v1-compatibility-test";
const previousAuth = process.env["AUTH_SECRET"];
const previousKey = process.env["MICROSOFT_365_ENCRYPTION_KEY"];

afterEach(() => {
  if (previousAuth === undefined) delete process.env["AUTH_SECRET"];
  else process.env["AUTH_SECRET"] = previousAuth;
  if (previousKey === undefined) delete process.env["MICROSOFT_365_ENCRYPTION_KEY"];
  else process.env["MICROSOFT_365_ENCRYPTION_KEY"] = previousKey;
});

describe("Microsoft 365 token cipher", () => {
  it("writes v2 ciphertext that does not open with AUTH_SECRET", () => {
    process.env["AUTH_SECRET"] = AUTH;
    process.env["MICROSOFT_365_ENCRYPTION_KEY"] = DEDICATED;
    const stored = encryptMicrosoftToken("refresh-token");
    expect(stored.startsWith("v2:")).toBe(true);
    expect(decryptMicrosoftToken(stored)).toBe("refresh-token");
    expect(decryptSecret(stored)).toBeNull();
    process.env["AUTH_SECRET"] = "a-different-auth-secret-value-here!!";
    expect(decryptMicrosoftToken(stored)).toBe("refresh-token");
  });

  it("still opens v1 ciphertext with AUTH_SECRET", () => {
    process.env["AUTH_SECRET"] = AUTH;
    process.env["MICROSOFT_365_ENCRYPTION_KEY"] = DEDICATED;
    const legacy = encryptSecret("legacy-refresh");
    expect(decryptMicrosoftToken(legacy)).toBe("legacy-refresh");
    process.env["AUTH_SECRET"] = "rotated-auth-secret-value-here!!!!";
    expect(decryptMicrosoftToken(legacy)).toBeNull();
  });

  it("refuses to encrypt when the dedicated key is missing or short", () => {
    expect(() => encryptMicrosoftToken("refresh-token")).toThrow(/not configured/);
    process.env["MICROSOFT_365_ENCRYPTION_KEY"] = "short";
    expect(() => encryptMicrosoftToken("refresh-token")).toThrow(/not configured/);
    expect(decryptMicrosoftToken("v2:aa:bb:cc")).toBeNull();
  });
});
