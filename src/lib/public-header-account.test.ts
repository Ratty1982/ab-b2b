import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/domain/permissions";
import { SYSTEM_ROLE_PERMISSIONS, TRADE_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import { ROUTES } from "@/lib/app-nav";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import type { ClientSession } from "@/server/auth/session";

function tradeSession(partial: Partial<Extract<ClientSession, { signedIn: true }>["user"]> = {}): ClientSession {
  return {
    signedIn: true,
    user: {
      id: "u-trade",
      email: "buyer@example.com",
      name: "Trade Buyer",
      actorType: "TRADE",
      systemRoles: [],
      displayRole: "TRADE BUYER · Example Factors",
      companyId: "co1",
      companyName: "Example Factors",
      accountNumber: "AB-100",
      tradeRole: "TRADE_BUYER",
      navPermissions: [...TRADE_ROLE_PERMISSIONS.TRADE_BUYER],
      actingFor: null,
      ...partial,
    },
  };
}

function adminSession(): ClientSession {
  return {
    signedIn: true,
    user: {
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
      actorType: "INTERNAL",
      systemRoles: ["SUPER_ADMIN"],
      displayRole: "Super Admin",
      companyId: null,
      companyName: null,
      accountNumber: null,
      tradeRole: null,
      navPermissions: [...ALL_PERMISSIONS],
      actingFor: null,
    },
  };
}

function salesSession(): ClientSession {
  return {
    signedIn: true,
    user: {
      id: "u-sales",
      email: "sales@example.com",
      name: "Sales",
      actorType: "INTERNAL",
      systemRoles: ["SALES_REPRESENTATIVE"],
      displayRole: "Sales Representative",
      companyId: null,
      companyName: null,
      accountNumber: null,
      tradeRole: null,
      navPermissions: [...SYSTEM_ROLE_PERMISSIONS.SALES_REPRESENTATIVE],
      actingFor: null,
    },
  };
}

describe("publicHeaderAccountLinks", () => {
  it("anonymous has no account destinations", () => {
    expect(publicHeaderAccountLinks({ signedIn: false })).toEqual([]);
  });

  it("trade customer gets My Account → /portal and never /admin", () => {
    const links = publicHeaderAccountLinks(tradeSession());
    expect(links).toEqual([{ key: "my-account", label: "My Account", to: ROUTES.portal }]);
    expect(links.every((l) => l.to !== ROUTES.admin)).toBe(true);
    expect(links.every((l) => l.label !== "Account")).toBe(true);
  });

  it("internal admin gets Admin → /admin, not ambiguous Account", () => {
    const links = publicHeaderAccountLinks(adminSession());
    expect(links).toEqual([{ key: "admin", label: "Admin", to: ROUTES.admin }]);
    expect(links.every((l) => l.label !== "Account")).toBe(true);
    expect(links.every((l) => l.to !== ROUTES.portal)).toBe(true);
  });

  it("admin with acting-for-customer gets Trade Portal + Admin", () => {
    const session: ClientSession = {
      signedIn: true,
      user: {
        id: "u-admin",
        email: "admin@example.com",
        name: "Admin",
        actorType: "INTERNAL",
        systemRoles: ["SUPER_ADMIN"],
        displayRole: "Super Admin",
        companyId: null,
        companyName: null,
        accountNumber: null,
        tradeRole: null,
        navPermissions: [...ALL_PERMISSIONS],
        actingFor: {
          companyId: "co-act",
          companyName: "Acting Co",
          accountNumber: "AB-9",
        },
      },
    };
    expect(publicHeaderAccountLinks(session)).toEqual([
      { key: "trade-portal", label: "Trade Portal", to: ROUTES.portal },
      { key: "admin", label: "Admin", to: ROUTES.admin },
    ]);
  });

  it("sales-only internal gets Sales destination, not Account or admin portal for trade", () => {
    const links = publicHeaderAccountLinks(salesSession());
    expect(links).toHaveLength(1);
    expect(links[0]!.label).toBe("Sales");
    expect(links[0]!.to).toBe(ROUTES.sales);
    expect(links.every((l) => l.label !== "Account")).toBe(true);
  });
});
