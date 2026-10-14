import { describe, expect, it } from "vitest";

import { ALL_PERMISSIONS, PERMISSIONS } from "@/domain/permissions";
import { SYSTEM_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import { previewBackOfficeNavigation } from "@/lib/app-nav";
import {
  PERMISSION_CATEGORIES,
  allowsListedPermissions,
  applyUserPermissionOverrides,
  cataloguePermissionKeys,
  effectForDesiredGrant,
  removesLastEffectiveSuperAdmin,
  sensitivePermissionChanges,
  withPermissionEffects,
} from "@/domain/user-permissions";

describe("user permission overrides", () => {
  it("lists every enforced permission once", () => {
    const keys = cataloguePermissionKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("inherits the role, allows extras, and deny beats the role", () => {
    const role = new Set(SYSTEM_ROLE_PERMISSIONS.SALES_REPRESENTATIVE);
    expect(role.has("orders.edit")).toBe(false);
    expect(role.has("orders.view")).toBe(true);

    const applied = applyUserPermissionOverrides(role, [
      { permissionKey: "orders.edit", effect: "ALLOW" },
      { permissionKey: "orders.view", effect: "DENY" },
    ]);
    expect(applied.effective.has("orders.edit")).toBe(true);
    expect(applied.effective.has("orders.view")).toBe(false);
    expect(applied.denied.has("orders.view")).toBe(true);
    expect(applied.effective.has("quotes.view")).toBe(true);
  });

  it("does not let admin.access bypass an explicit deny", () => {
    const applied = applyUserPermissionOverrides(ALL_PERMISSIONS, [
      { permissionKey: "products.cost.view", effect: "DENY" },
      { permissionKey: "sales.view_all_accounts", effect: "DENY" },
    ]);
    expect(applied.effective.has("admin.access")).toBe(true);
    expect(
      allowsListedPermissions(applied.effective, applied.denied, ["products.cost.view", "admin.access"]),
    ).toBe(false);
    expect(
      allowsListedPermissions(applied.effective, applied.denied, ["orders.view", "admin.access"]),
    ).toBe(true);
    expect(
      allowsListedPermissions(applied.effective, applied.denied, [
        "sales.view_all_accounts",
        "admin.access",
      ]),
    ).toBe(false);
  });

  it("resets a category to the role and can clear it", () => {
    const role = new Set(SYSTEM_ROLE_PERMISSIONS.CUSTOMER_SERVICE);
    const orders = PERMISSION_CATEGORIES.find((category) => category.id === "orders")!;
    const granted = withPermissionEffects({}, orders.permissions, role, "grant");
    expect(granted["orders.edit"]).toBeUndefined();
    expect(granted["orders.place_for_customer"]).toBe("ALLOW");

    const cleared = withPermissionEffects(granted, orders.permissions, role, "clear");
    expect(cleared["orders.view"]).toBe("DENY");
    expect(cleared["orders.place_for_customer"]).toBeUndefined();
    expect(effectForDesiredGrant(true, true)).toBe("INHERIT");
    expect(effectForDesiredGrant(true, false)).toBe("DENY");

    const reset = withPermissionEffects(cleared, orders.permissions, role, "reset");
    expect(reset["orders.view"]).toBeUndefined();
  });

  it("flags sensitive changes and the last effective super admin", () => {
    expect(sensitivePermissionChanges({}, { "users.manage": "DENY" })).toEqual(["users.manage"]);
    expect(sensitivePermissionChanges({ "orders.view": "DENY" }, {})).toEqual([]);
    expect(
      removesLastEffectiveSuperAdmin({
        targetHasSuperAdminRole: true,
        targetKeepsUsersManage: false,
        otherEffectiveSuperAdmins: 0,
      }),
    ).toBe(true);
    expect(
      removesLastEffectiveSuperAdmin({
        targetHasSuperAdminRole: true,
        targetKeepsUsersManage: false,
        otherEffectiveSuperAdmins: 1,
      }),
    ).toBe(false);
    expect(
      removesLastEffectiveSuperAdmin({
        targetHasSuperAdminRole: false,
        targetKeepsUsersManage: false,
        otherEffectiveSuperAdmins: 0,
      }),
    ).toBe(false);
  });

  it("hides a denied navigation item even when admin access remains", () => {
    const open = previewBackOfficeNavigation({
      permissions: ALL_PERMISSIONS,
    });
    expect(open.flatMap((section) => section.items)).toContain("Cost Intelligence");

    const denied = previewBackOfficeNavigation({
      permissions: ALL_PERMISSIONS.filter((key) => key !== "products.cost.view"),
      denied: ["products.cost.view"],
    });
    expect(denied.flatMap((section) => section.items)).not.toContain("Cost Intelligence");
  });
});
