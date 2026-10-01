import { describe, expect, it } from "vitest";
import {
  MFA_REQUIRED_SYSTEM_ROLES,
  profileRequiresMfa,
  roleRequiresMfa,
} from "@/domain/mfa-policy";

describe("mfa policy", () => {
  it("requires MFA for SUPER_ADMIN and ACCOUNTS only", () => {
    expect(MFA_REQUIRED_SYSTEM_ROLES).toEqual(["SUPER_ADMIN", "ACCOUNTS"]);
    expect(roleRequiresMfa("SUPER_ADMIN")).toBe(true);
    expect(roleRequiresMfa("ACCOUNTS")).toBe(true);
    expect(roleRequiresMfa("MARKETING")).toBe(false);
    expect(profileRequiresMfa(["SALES_REPRESENTATIVE"])).toBe(false);
    expect(profileRequiresMfa(["ACCOUNTS", "MARKETING"])).toBe(true);
  });
});
