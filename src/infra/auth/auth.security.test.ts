import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STRICT_TRANSPORT_SECURITY } from "@/domain/transport-security";

describe("auth and transport security configuration", () => {
  it("keeps Better Auth rate limits and secure cookie settings", () => {
    const source = readFileSync(join(process.cwd(), "src/infra/auth/auth.ts"), "utf8");
    expect(source).toContain("rateLimit");
    expect(source).toContain('"/sign-in/email"');
    expect(source).toContain('"/forget-password"');
    expect(source).toContain("sameSite: \"lax\"");
    expect(source).toContain("httpOnly: true");
    expect(source).toContain("baseURL: env.APP_URL");
    expect(source).not.toContain("crossSubDomainCookies");
    expect(source).not.toContain("domain:");
    expect(source).toContain("twoFactor");
    expect(source).toContain("trustDeviceMaxAge: 60 * 60 * 24 * 30");
    expect(source).toContain("accountLockout");
    expect(source).toContain("storeBackupCodes: \"encrypted\"");
    expect(source).not.toContain("skipVerificationOnEnable");
    expect(source).toContain("Automotive Brands");
    expect(source).toContain("disableSignUp: true");
    expect(source).toContain("revokeSessionsOnPasswordReset: true");
    expect(source).toContain('ctx.path !== "/change-password"');
    expect(source).toContain("revokeTrustedDevices");
    expect(source).toMatch(/cookieCache:\s*\{[^}]*enabled:\s*false/);
  });

  it("keeps authenticator secrets out of the browser store and the admin reset", () => {
    const page = readFileSync(join(process.cwd(), "src/routes/account.security.tsx"), "utf8");
    const login = readFileSync(join(process.cwd(), "src/routes/login.tsx"), "utf8");
    const mfa = readFileSync(join(process.cwd(), "src/server/auth/mfa.ts"), "utf8");
    const users = readFileSync(join(process.cwd(), "src/server/users/service.ts"), "utf8");
    const guards = readFileSync(join(process.cwd(), "src/server/rbac/guards.ts"), "utf8");
    const phase2 = readFileSync(join(process.cwd(), "src/server/phase2/fns.ts"), "utf8");
    expect(page).not.toContain("localStorage");
    expect(page).not.toContain("sessionStorage");
    expect(page).toContain("setRevealedCodes(heldCodes)");
    expect(login).toContain('fd.get("trustDevice") === "on"');
    expect(login).toContain("safeReturnPath");
    expect(mfa).not.toContain("viewBackupCodes");
    expect(mfa).not.toContain("console.");
    expect(guards).toContain("MFA_ENROLLMENT_REQUIRED");
    expect(phase2).toContain("requireAuthenticatedUser");
    const passwordReset = users.slice(
      users.indexOf("export async function resetStaffUserPassword"),
      users.indexOf("export async function resetUserAuthenticator"),
    );
    expect(passwordReset).toContain("trust-device-");
    expect(passwordReset).not.toContain("twoFactor");
    const authenticatorReset = users.slice(users.indexOf("export async function resetUserAuthenticator"));
    expect(authenticatorReset).toContain("twoFactor.deleteMany");
    expect(authenticatorReset).not.toContain("backupCodes");
    expect(authenticatorReset).not.toContain("viewBackupCodes");
  });

  it("pins single-use recovery codes in the installed Better Auth plugin", () => {
    const source = readFileSync(
      join(process.cwd(), "node_modules/better-auth/dist/plugins/two-factor/backup-codes/index.mjs"),
      "utf8",
    );
    expect(source).toContain("codes.filter((code) => code !== data.code)");
    expect(source).toContain("incrementOne");
  });

  it("keeps CSRF middleware active for server functions", () => {
    const source = readFileSync(join(process.cwd(), "src/start.ts"), "utf8");
    expect(source).toContain("createCsrfMiddleware");
    expect(source).toContain('handlerType === "serverFn"');
    expect(source).toContain("Strict-Transport-Security");
    expect(source).toContain("STRICT_TRANSPORT_SECURITY");
    expect(source).not.toContain("includeSubDomains");
    expect(STRICT_TRANSPORT_SECURITY).toBe("max-age=31536000");
    expect(source).toContain("migrationRequestDecision");
    expect(source).toContain("B2B_LEGACY_REDIRECT");
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
