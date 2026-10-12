import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("auth and transport security configuration", () => {
  it("keeps Better Auth rate limits and secure cookie settings", () => {
    const source = readFileSync(join(process.cwd(), "src/infra/auth/auth.ts"), "utf8");
    expect(source).toContain("rateLimit");
    expect(source).toContain('"/sign-in/email"');
    expect(source).toContain('"/forget-password"');
    expect(source).toContain('sameSite: "lax"');
    expect(source).toContain("httpOnly: true");
    expect(source).toContain("Session revocation reads the database");
    expect(source).toContain("enabled: false");
    expect(source).toContain("twoFactor");
    expect(source).toContain("Automotive Brands");
  });

  it("keeps CSRF middleware active for server functions", () => {
    const source = readFileSync(join(process.cwd(), "src/start.ts"), "utf8");
    expect(source).toContain("createCsrfMiddleware");
    expect(source).toContain('handlerType === "serverFn"');
    expect(source).toContain("Strict-Transport-Security");
    expect(source).toContain("Content-Security-Policy");
    expect(source).toContain("frame-ancestors 'none'");
    expect(source).toContain("object-src 'none'");
  });

  it("documents MFA enforcement opt-in", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/mfa-policy.ts"), "utf8");
    expect(source).toContain("MFA_ENFORCE_PRIVILEGED");
    expect(source).toContain("SUPER_ADMIN");
    expect(source).toContain("ACCOUNTS");
  });
});
