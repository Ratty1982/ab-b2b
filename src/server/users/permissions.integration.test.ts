import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { loadAccessProfile } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { listVersionUpdatesAdmin } from "@/server/system/version-updates";
import { getStockOverview } from "@/server/purchasing/stock-overview";
import { listPurchasingForecast } from "@/server/purchasing/service";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import {
  applyBulkStaffPermissions,
  getStaffUserPermissions,
  previewBulkStaffPermissions,
  saveStaffUserPermissions,
} from "@/server/users/permissions";

const prisma = new PrismaClient();
const suffix = `up${Date.now().toString(36)}`;

let adminId = "";
let salesId = "";
let peerId = "";
let tradeId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType,
      emailVerified: true,
    },
  });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`perm.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`perm.sales.${suffix}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  peerId = await ensureUser(`perm.peer.${suffix}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  tradeId = await ensureUser(`perm.trade.${suffix}@example.invalid`, [], "TRADE");
});

afterAll(async () => {
  await prisma.userPermissionOverride.deleteMany({
    where: { userId: { in: [adminId, salesId, peerId, tradeId].filter(Boolean) } },
  });
  await prisma.companyAssignment.deleteMany({
    where: { company: { accountNumber: { startsWith: `UP-${suffix}` } } },
  });
  await prisma.company.deleteMany({ where: { accountNumber: { startsWith: `UP-${suffix}` } } });
  await prisma.salesRep.deleteMany({ where: { userId: { in: [salesId].filter(Boolean) } } });
  await prisma.user.deleteMany({
    where: { email: { in: [
      `perm.admin.${suffix}@example.invalid`,
      `perm.sales.${suffix}@example.invalid`,
      `perm.peer.${suffix}@example.invalid`,
      `perm.trade.${suffix}@example.invalid`,
    ] } },
  });
  await prisma.$disconnect();
});

describe("per-user permission overrides", () => {
  it("rejects staff who are not Super Admin", async () => {
    await expect(
      saveStaffUserPermissions(salesId, {
        userId: peerId,
        confirmSensitive: true,
        overrides: [{ permissionKey: "orders.edit", effect: "ALLOW" }],
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("allows a permission the role lacks, denies one it grants, and leaves a peer unchanged", async () => {
    const beforePeer = await loadAccessProfile(peerId);
    expect(beforePeer?.permissions.has("orders.edit")).toBe(false);
    expect(beforePeer?.permissions.has("orders.view")).toBe(true);

    const saved = await saveStaffUserPermissions(adminId, {
      userId: salesId,
      overrides: [
        { permissionKey: "orders.edit", effect: "ALLOW" },
        { permissionKey: "orders.view", effect: "DENY" },
      ],
    });
    const orders = saved.categories.flatMap((category) => category.sections).find((section) => section.id === "orders");
    expect(orders?.permissions.find((row) => row.key === "orders.edit")).toMatchObject({
      effect: "ALLOW",
      effective: true,
      roleGranted: false,
    });
    expect(orders?.permissions.find((row) => row.key === "orders.view")).toMatchObject({
      effect: "DENY",
      effective: false,
    });
    expect(saved.customisedCount).toBe(2);

    const profile = await loadAccessProfile(salesId);
    expect(profile?.permissions.has("orders.edit")).toBe(true);
    expect(profile?.permissions.has("orders.view")).toBe(false);
    await expect(requireSystemPermission(salesId, "orders.view")).rejects.toBeInstanceOf(AuthError);
    await expect(requireSystemPermission(salesId, "orders.edit")).resolves.toBeTruthy();

    const peer = await loadAccessProfile(peerId);
    expect(peer?.permissions.has("orders.view")).toBe(true);
    expect(peer?.permissions.has("orders.edit")).toBe(false);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_PERMISSIONS_UPDATED", targetUserId: salesId, actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.before).toMatchObject({ overrides: [] });
    expect(audit?.after).toMatchObject({
      overrides: expect.arrayContaining([
        expect.objectContaining({ permissionKey: "orders.view", effect: "DENY" }),
        expect.objectContaining({ permissionKey: "orders.edit", effect: "ALLOW" }),
      ]),
    });
  });

  it("resets to the role default", async () => {
    const reset = await saveStaffUserPermissions(adminId, {
      userId: salesId,
      overrides: [],
    });
    expect(reset.customisedCount).toBe(0);
    const profile = await loadAccessProfile(salesId);
    expect(profile?.permissions.has("orders.view")).toBe(true);
    expect(profile?.permissions.has("orders.edit")).toBe(false);
    expect(profile?.deniedPermissions.size).toBe(0);
  });

  it("keeps sales assignment when all-account access is denied, even with admin access", async () => {
    const rep = await prisma.salesRep.create({
      data: { userId: salesId, code: `UP${suffix}`.slice(0, 20), active: true },
    });
    const assigned = await prisma.company.create({
      data: { name: "Assigned", accountNumber: `UP-${suffix}-A`, status: "ACTIVE" },
    });
    const other = await prisma.company.create({
      data: { name: "Other", accountNumber: `UP-${suffix}-B`, status: "ACTIVE" },
    });
    await prisma.companyAssignment.create({
      data: { companyId: assigned.id, salesRepId: rep.id, isPrimary: true },
    });

    const scoped = await loadAccessProfile(salesId);
    expect(await canAccessCompanyAsSales(scoped!, assigned.id)).toBe(true);
    expect(await canAccessCompanyAsSales(scoped!, other.id)).toBe(false);

    await saveStaffUserPermissions(adminId, {
      userId: adminId,
      confirmSensitive: true,
      overrides: [{ permissionKey: "sales.view_all_accounts", effect: "DENY" }],
    });
    const narrowed = await loadAccessProfile(adminId);
    expect(narrowed?.permissions.has("admin.access")).toBe(true);
    expect(narrowed?.permissions.has("sales.view_all_accounts")).toBe(false);
    expect(await canAccessCompanyAsSales(narrowed!, other.id)).toBe(false);

    await saveStaffUserPermissions(adminId, {
      userId: adminId,
      confirmSensitive: true,
      overrides: [],
    });
    const restored = await loadAccessProfile(adminId);
    expect(await canAccessCompanyAsSales(restored!, other.id)).toBe(true);
  });

  it("does not let an allow override grant Super Admin only actions or trade permissions", async () => {
    await saveStaffUserPermissions(adminId, {
      userId: salesId,
      confirmSensitive: true,
      overrides: [{ permissionKey: "version_updates.manage", effect: "ALLOW" }],
    });
    const profile = await loadAccessProfile(salesId);
    expect(profile?.permissions.has("version_updates.manage")).toBe(true);
    expect(profile?.systemRoles).not.toContain("SUPER_ADMIN");
    await expect(listVersionUpdatesAdmin(salesId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await prisma.userPermissionOverride.create({
      data: { userId: tradeId, permissionKey: "users.manage", effect: "ALLOW" },
    });
    const trade = await loadAccessProfile(tradeId);
    expect(trade?.actorType).toBe("TRADE");
    expect(trade?.permissions.has("users.manage")).toBe(false);

    await saveStaffUserPermissions(adminId, {
      userId: salesId,
      confirmSensitive: true,
      overrides: [],
    });
  });

  it("refuses to remove user management from the last effective Super Admin", async () => {
    const others = await prisma.user.count({
      where: {
        id: { not: adminId },
        status: "ACTIVE",
        actorType: "INTERNAL",
        userRoles: { some: { role: { key: "SUPER_ADMIN" } } },
      },
    });
    const save = saveStaffUserPermissions(adminId, {
      userId: adminId,
      confirmSensitive: true,
      overrides: [{ permissionKey: "users.manage", effect: "DENY" }],
    });
    if (others === 0) {
      await expect(save).rejects.toThrow(/last Super Admin/);
      return;
    }
    const saved = await save;
    expect(saved.categories.flatMap((category) => category.permissions).find((row) => row.key === "users.manage")?.effective).toBe(false);
    const reloaded = await getStaffUserPermissions(adminId, adminId);
    expect(reloaded.customisedCount).toBe(1);
    await saveStaffUserPermissions(adminId, {
      userId: adminId,
      confirmSensitive: true,
      overrides: [],
    });
  });

  it("requires confirmation for a sensitive change", async () => {
    await expect(
      saveStaffUserPermissions(adminId, {
        userId: salesId,
        overrides: [{ permissionKey: "users.manage", effect: "ALLOW" }],
      }),
    ).rejects.toMatchObject({ code: "CONFIRM_SENSITIVE" });
  });

  it("enforces a denied purchasing section without closing its siblings", async () => {
    const accountsId = await ensureUser(`perm.accounts.${suffix}@example.invalid`, ["ACCOUNTS"]);
    await expect(getStockOverview(accountsId, {})).resolves.toBeTruthy();
    await saveStaffUserPermissions(adminId, {
      userId: accountsId,
      overrides: [{ permissionKey: "purchasing.stock.view", effect: "DENY" }],
    });
    await expect(getStockOverview(accountsId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(listPurchasingForecast(accountsId, {})).resolves.toBeTruthy();

    const limitedId = await ensureUser(`perm.limited.${suffix}@example.invalid`, ["CUSTOMER_SERVICE"]);
    await saveStaffUserPermissions(adminId, {
      userId: limitedId,
      overrides: [{ permissionKey: "purchasing.stock.view", effect: "ALLOW" }],
    });
    await expect(getStockOverview(limitedId, {})).resolves.toBeTruthy();
    await expect(listPurchasingForecast(limitedId, {})).rejects.toBeInstanceOf(AuthError);
    const profile = await loadAccessProfile(limitedId);
    expect(await resolveSalesIntelligenceCompanyScope(profile!)).toEqual([]);

    await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [accountsId, limitedId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [accountsId, limitedId] } } });
  });

  it("applies bulk allow, deny, and reset without touching unrelated overrides", async () => {
    const firstId = await ensureUser(`perm.bulk1.${suffix}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    const secondId = await ensureUser(`perm.bulk2.${suffix}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    await saveStaffUserPermissions(adminId, {
      userId: firstId,
      overrides: [
        { permissionKey: "orders.edit", effect: "ALLOW" },
        { permissionKey: "companies.create", effect: "ALLOW" },
      ],
    });
    await saveStaffUserPermissions(adminId, {
      userId: secondId,
      overrides: [{ permissionKey: "orders.view", effect: "DENY" }],
    });

    await expect(
      applyBulkStaffPermissions(salesId, {
        userIds: [firstId],
        changes: [{ permissionKey: "orders.edit", effect: "ALLOW" }],
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      applyBulkStaffPermissions(adminId, {
        userIds: [firstId],
        changes: [{ permissionKey: "users.manage", effect: "ALLOW" }],
      }),
    ).rejects.toMatchObject({ code: "CONFIRM_SENSITIVE" });

    const preview = await previewBulkStaffPermissions(adminId, {
      userIds: [firstId, secondId],
      changes: [{ permissionKey: "pricing.view", effect: "DENY" }],
    });
    expect(preview.users).toHaveLength(2);
    expect(preview.changes[0]?.rows.every((row) => row.beforeEffective && !row.afterEffective)).toBe(true);

    await applyBulkStaffPermissions(adminId, {
      userIds: [firstId, secondId],
      changes: [{ permissionKey: "pricing.view", effect: "DENY" }],
    });
    const first = await loadAccessProfile(firstId);
    const second = await loadAccessProfile(secondId);
    expect(first?.permissions.has("pricing.view")).toBe(false);
    expect(first?.permissions.has("orders.edit")).toBe(true);
    expect(first?.permissions.has("companies.create")).toBe(true);
    expect(second?.permissions.has("orders.view")).toBe(false);
    expect(second?.permissions.has("orders.edit")).toBe(false);

    await applyBulkStaffPermissions(adminId, {
      userIds: [firstId],
      changes: [{ permissionKey: "orders.edit", effect: "INHERIT" }],
    });
    const reset = await loadAccessProfile(firstId);
    expect(reset?.permissions.has("orders.edit")).toBe(false);
    expect(reset?.permissions.has("companies.create")).toBe(true);
    expect(reset?.permissions.has("pricing.view")).toBe(false);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "USER_PERMISSIONS_UPDATED", targetUserId: firstId, actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.before).toMatchObject({
      overrides: expect.arrayContaining([
        expect.objectContaining({ permissionKey: "orders.edit", effect: "ALLOW" }),
        expect.objectContaining({ permissionKey: "companies.create", effect: "ALLOW" }),
      ]),
    });
    expect(audit?.after).toMatchObject({
      overrides: expect.arrayContaining([
        expect.objectContaining({ permissionKey: "companies.create", effect: "ALLOW" }),
        expect.objectContaining({ permissionKey: "pricing.view", effect: "DENY" }),
      ]),
    });
    const afterOverrides = (audit?.after as { overrides?: Array<{ permissionKey: string }> } | null)?.overrides ?? [];
    expect(afterOverrides.some((row) => row.permissionKey === "orders.edit")).toBe(false);

    await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [firstId, secondId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [firstId, secondId] } } });
  });
});
