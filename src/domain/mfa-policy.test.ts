import { afterEach, describe, expect, it } from "vitest";
import { authenticatorResetNotice } from "@/server/auth/mfa-notice";
import {
  MFA_REQUIRED_SYSTEM_ROLES,
  canResetAnotherUsersAuthenticator,
  isCustomerMfaEnforced,
  isPrivilegedMfaEnforced,
  isStaffMfaEnforced,
  mfaEnrollmentRequired,
  profileRequiresMfa,
  roleRequiresMfa,
} from "@/domain/mfa-policy";

const FLAG_NAMES = ["MFA_ENFORCE_PRIVILEGED", "MFA_ENFORCE_STAFF", "MFA_ENFORCE_CUSTOMERS"] as const;

function clearFlags() {
  for (const name of FLAG_NAMES) delete process.env[name];
}

describe("mfa policy", () => {
  afterEach(() => {
    clearFlags();
  });

  it("requires MFA for SUPER_ADMIN and ACCOUNTS only in the privileged set", () => {
    expect(MFA_REQUIRED_SYSTEM_ROLES).toEqual(["SUPER_ADMIN", "ACCOUNTS"]);
    expect(roleRequiresMfa("SUPER_ADMIN")).toBe(true);
    expect(roleRequiresMfa("ACCOUNTS")).toBe(true);
    expect(roleRequiresMfa("MANAGEMENT")).toBe(false);
    expect(roleRequiresMfa("MARKETING")).toBe(false);
    expect(profileRequiresMfa(["SALES_REPRESENTATIVE"])).toBe(false);
    expect(profileRequiresMfa(["ACCOUNTS", "MARKETING"])).toBe(true);
  });

  it("leaves every enforcement stage off unless a flag is explicitly on", () => {
    expect(isPrivilegedMfaEnforced()).toBe(false);
    expect(isStaffMfaEnforced()).toBe(false);
    expect(isCustomerMfaEnforced()).toBe(false);
    process.env["MFA_ENFORCE_PRIVILEGED"] = "false";
    process.env["MFA_ENFORCE_STAFF"] = "0";
    process.env["MFA_ENFORCE_CUSTOMERS"] = "off";
    expect(isPrivilegedMfaEnforced()).toBe(false);
    expect(isStaffMfaEnforced()).toBe(false);
    expect(isCustomerMfaEnforced()).toBe(false);
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        twoFactorEnabled: false,
      }),
    ).toBe(false);
  });

  it("blocks only privileged roles when the first stage is on", () => {
    process.env["MFA_ENFORCE_PRIVILEGED"] = "true";
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        twoFactorEnabled: false,
      }),
    ).toBe(true);
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["ACCOUNTS"],
        twoFactorEnabled: false,
      }),
    ).toBe(true);
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["MANAGEMENT"],
        twoFactorEnabled: false,
      }),
    ).toBe(false);
    expect(
      mfaEnrollmentRequired({
        actorType: "TRADE",
        systemRoles: [],
        twoFactorEnabled: false,
      }),
    ).toBe(false);
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        twoFactorEnabled: true,
      }),
    ).toBe(false);
  });

  it("blocks internal staff and management only after the staff stage is on", () => {
    process.env["MFA_ENFORCE_STAFF"] = "on";
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["MANAGEMENT"],
        twoFactorEnabled: false,
      }),
    ).toBe(true);
    expect(
      mfaEnrollmentRequired({
        actorType: "INTERNAL",
        systemRoles: ["SALES_REPRESENTATIVE"],
        twoFactorEnabled: false,
      }),
    ).toBe(true);
    expect(
      mfaEnrollmentRequired({
        actorType: "TRADE",
        systemRoles: [],
        twoFactorEnabled: false,
      }),
    ).toBe(false);
  });

  it("keeps customers optional until their own flag is on", () => {
    expect(
      mfaEnrollmentRequired({
        actorType: "TRADE",
        systemRoles: [],
        twoFactorEnabled: false,
      }),
    ).toBe(false);
    process.env["MFA_ENFORCE_CUSTOMERS"] = "1";
    expect(
      mfaEnrollmentRequired({
        actorType: "TRADE",
        systemRoles: [],
        twoFactorEnabled: false,
      }),
    ).toBe(true);
    expect(
      mfaEnrollmentRequired({
        actorType: "TRADE",
        systemRoles: [],
        twoFactorEnabled: true,
      }),
    ).toBe(false);
  });

  it("sends an authenticator reset note without secrets or recovery codes", () => {
    const notice = authenticatorResetNotice();
    expect(notice.text.toLowerCase()).not.toContain("secret");
    expect(notice.text.toLowerCase()).not.toContain("otpauth");
    expect(notice.text).not.toMatch(/\b[A-Z0-9]{10}\b/);
    expect(notice.subject).not.toContain("@");
  });

  it("lets only a different Super Admin reset another person's authenticator", () => {
    expect(
      canResetAnotherUsersAuthenticator({
        actorUserId: "admin",
        targetUserId: "staff",
        actorIsSuperAdmin: true,
      }),
    ).toBe(true);
    expect(
      canResetAnotherUsersAuthenticator({
        actorUserId: "admin",
        targetUserId: "admin",
        actorIsSuperAdmin: true,
      }),
    ).toBe(false);
    expect(
      canResetAnotherUsersAuthenticator({
        actorUserId: "manager",
        targetUserId: "staff",
        actorIsSuperAdmin: false,
      }),
    ).toBe(false);
  });
});
