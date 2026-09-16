import { describe, expect, it } from "vitest";

import { ALL_PERMISSIONS, isPermissionKey } from "@/domain/permissions";
import { SYSTEM_ROLE_PERMISSIONS, TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import { safeReturnPath } from "@/server/auth/redirects";

describe("permission catalogue", () => {
  it("includes required Phase 1 keys", () => {
    const required = [
      "admin.access",
      "companies.view",
      "companies.manage_users",
      "orders.place_for_customer",
      "credit.edit",
      "cms.publish",
      "cms.page.publish",
      "impersonation.order_for_customer",
      "audit.view",
    ];
    for (const key of required) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it("maps SUPER_ADMIN to every permission", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(ALL_PERMISSIONS);
  });

  it("does not give marketing invoice or credit rights", () => {
    const m = SYSTEM_ROLE_PERMISSIONS.MARKETING;
    expect(m).not.toContain("invoices.view");
    expect(m).not.toContain("credit.view");
    expect(m).not.toContain("credit.edit");
    expect(m).toContain("cms.publish");
  });

  it("does not give accounts CMS publish", () => {
    const a = SYSTEM_ROLE_PERMISSIONS.ACCOUNTS;
    expect(a).not.toContain("cms.publish");
    expect(a).not.toContain("cms.edit");
    expect(a).toContain("credit.edit");
  });

  it("does not give sales rep credit.edit or global pricing.edit", () => {
    const r = SYSTEM_ROLE_PERMISSIONS.SALES_REPRESENTATIVE;
    expect(r).not.toContain("credit.edit");
    expect(r).not.toContain("pricing.edit");
    expect(r).toContain("impersonation.order_for_customer");
  });

  it("trade buyer cannot manage company users", () => {
    expect(TRADE_ROLE_PERMISSIONS.TRADE_BUYER).not.toContain("companies.manage_users");
    expect(TRADE_ROLE_PERMISSIONS.TRADE_ACCOUNT_ADMIN).toContain("companies.manage_users");
  });

  it("trade read-only can view pricing but not create orders", () => {
    expect(TRADE_ROLE_PERMISSIONS.TRADE_READ_ONLY).toContain("pricing.view");
    expect(TRADE_ROLE_PERMISSIONS.TRADE_READ_ONLY).not.toContain("orders.create");
  });

  it("trade accounts cannot place orders by default", () => {
    expect(TRADE_ROLE_PERMISSIONS.TRADE_ACCOUNTS).not.toContain("orders.create");
    expect(TRADE_ROLE_PERMISSIONS.TRADE_ACCOUNTS).toContain("invoices.view");
  });
});

describe("safeReturnPath", () => {
  it("rejects open redirects", () => {
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/portal")).toBe("/portal");
  });
});
