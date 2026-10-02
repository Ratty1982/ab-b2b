import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { LAST_ACTIVE_THROTTLE_MS, touchLastActive } from "@/server/audit/last-active";
import {
  getStaffActivityOverview,
  getStaffUserActivity,
  listStaffLoginHistory,
} from "@/server/audit/staff-activity-service";
import { recordStaffWorkspaceOpen } from "@/server/audit/staff-workspace-open";
import { listStaffUsers } from "@/server/users/service";

const prisma = new PrismaClient();
const stamp = Date.now().toString(36);

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { actorType: "INTERNAL", status: "ACTIVE" },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  const hasCredential = await prisma.authAccount.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!hasCredential) {
    await prisma.authAccount.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword("StaffActivityPass99!"),
      },
    });
  }
  return user.id;
}

describe("Super Admin staff activity", () => {
  let superAdminId = "";
  let managementId = "";
  let salesRepId = "";
  let tradeUserId = "";
  let subjectId = "";

  beforeAll(async () => {
    await bootstrapRbac(prisma);
    superAdminId = await ensureUser(`sa.activity.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    managementId = await ensureUser(`mgmt.activity.${stamp}@example.invalid`, ["MANAGEMENT"]);
    salesRepId = await ensureUser(`rep.activity.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
    subjectId = await ensureUser(`subject.activity.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);

    let trade = await prisma.user.findUnique({
      where: { email: `trade.activity.${stamp}@example.invalid` },
    });
    if (!trade) {
      trade = await prisma.user.create({
        data: {
          email: `trade.activity.${stamp}@example.invalid`,
          name: "Trade Activity",
          status: "ACTIVE",
          actorType: "TRADE",
          emailVerified: true,
        },
      });
    }
    tradeUserId = trade.id;

    await prisma.user.update({
      where: { id: subjectId },
      data: {
        lastLoginAt: new Date("2026-10-02T07:14:00.000Z"),
        lastActiveAt: new Date("2026-10-02T15:42:00.000Z"),
        // Sort early so the user appears within listStaffUsers take:500 on polluted DBs.
        name: "AAA Luke Activity",
        email: `aaa.subject.activity.${stamp}@example.invalid`,
      },
    });

    await recordAuditEvent({
      action: "LOGIN_SUCCESS",
      entityType: "User",
      entityId: subjectId,
      actorUserId: subjectId,
      ipAddress: "203.0.113.10",
      userAgent: "Vitest",
    });
    await recordAuditEvent({
      action: "sales_followup.created",
      entityType: "Task",
      entityId: `task-${stamp}`,
      actorUserId: subjectId,
      metadata: { detail: "Call regarding Power Maxed range", companyName: "Bennetts" },
    });
    await recordAuditEvent({
      action: "sales_followup.completed",
      entityType: "Task",
      entityId: `task-${stamp}`,
      actorUserId: subjectId,
      metadata: { detail: "Completed follow-up", companyName: "Bennetts" },
    });
    await recordAuditEvent({
      action: "company.updated",
      entityType: "Company",
      entityId: `co-${stamp}`,
      actorUserId: subjectId,
      metadata: { companyName: "Halfords", detail: "Updated contact details" },
    });
    await recordAuditEvent({
      action: "quote.created",
      entityType: "Quote",
      entityId: `q-${stamp}`,
      actorUserId: subjectId,
      metadata: { quoteNumber: "Q-1001" },
    });
    await recordAuditEvent({
      action: "order.created",
      entityType: "Order",
      entityId: `o-${stamp}`,
      actorUserId: subjectId,
      metadata: { orderNumber: "AB-001234" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows Super Admin to view staff activity and overview", async () => {
    const overview = await getStaffActivityOverview(superAdminId);
    expect(overview.internalUsers).toBeGreaterThanOrEqual(3);
    expect(overview.meaningfulActionsToday).toBeGreaterThanOrEqual(0);

    const detail = await getStaffUserActivity(superAdminId, {
      userId: subjectId,
      period: "30d",
      area: "all",
      page: 1,
      pageSize: 25,
    });
    expect(detail.user.name).toContain("Luke");
    expect(detail.lastLoginAt).toBeTruthy();
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect(detail.timeline[0]!.atLabel).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(detail.timeline.some((row) => row.actionLabel === "Completed follow-up")).toBe(true);
    expect(detail.timeline.some((row) => row.actionLabel === "Logged in")).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/password|token|secret|cookie/i);

    const listed = await listStaffUsers(superAdminId);
    expect(listed.activityOverview).not.toBeNull();
    expect(listed.canGrantSuperAdmin).toBe(true);
    const row = listed.items.find((item) => item.id === subjectId);
    expect(row).toBeTruthy();
    expect(row!.actions30d ?? 0).toBeGreaterThanOrEqual(1);
    expect(row!.lastLoginLabel).toBeTruthy();
    expect(row!.lastActiveAt).toBeTruthy();
  }, 20_000);

  it("denies Management, Sales Rep and Trade from staff activity loaders", async () => {
    await expect(getStaffUserActivity(managementId, { userId: subjectId })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getStaffUserActivity(salesRepId, { userId: subjectId })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getStaffUserActivity(tradeUserId, { userId: subjectId })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getStaffActivityOverview(managementId)).rejects.toBeInstanceOf(AuthError);
    await expect(listStaffLoginHistory(salesRepId, { userId: subjectId })).rejects.toBeInstanceOf(
      AuthError,
    );
    // Non-Super-Admin staff typically lack users.manage — list itself is denied.
    await expect(listStaffUsers(managementId)).rejects.toBeInstanceOf(AuthError);
  });

  it("throttles lastActiveAt and never writes AuditEvent heartbeats", async () => {
    const beforeCount = await prisma.auditEvent.count({ where: { actorUserId: subjectId } });
    await prisma.user.update({
      where: { id: subjectId },
      data: { lastActiveAt: null },
    });
    await touchLastActive(subjectId);
    const mid = await prisma.user.findUniqueOrThrow({ where: { id: subjectId } });
    expect(mid.lastActiveAt).toBeTruthy();
    const first = mid.lastActiveAt!.getTime();

    await touchLastActive(subjectId);
    const again = await prisma.user.findUniqueOrThrow({ where: { id: subjectId } });
    expect(again.lastActiveAt!.getTime()).toBe(first);

    await prisma.user.update({
      where: { id: subjectId },
      data: { lastActiveAt: new Date(Date.now() - LAST_ACTIVE_THROTTLE_MS - 1000) },
    });
    await touchLastActive(subjectId);
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: subjectId } });
    expect(refreshed.lastActiveAt!.getTime()).toBeGreaterThan(first);

    const afterCount = await prisma.auditEvent.count({ where: { actorUserId: subjectId } });
    expect(afterCount).toBe(beforeCount);
  });

  it("records throttled Sales Intelligence workspace opens", async () => {
    await recordStaffWorkspaceOpen({
      actorUserId: subjectId,
      action: "si.daily_brief.opened",
      detail: "Viewed own sales brief",
    });
    await recordStaffWorkspaceOpen({
      actorUserId: subjectId,
      action: "si.daily_brief.opened",
      detail: "Viewed own sales brief",
    });
    const opens = await prisma.auditEvent.count({
      where: { actorUserId: subjectId, action: "si.daily_brief.opened" },
    });
    expect(opens).toBe(1);

    const detail = await getStaffUserActivity(superAdminId, {
      userId: subjectId,
      period: "30d",
      area: "sales_intelligence",
      page: 1,
    });
    expect(detail.timeline.some((row) => row.action === "si.daily_brief.opened")).toBe(true);
    expect(detail.breakdown.find((b) => b.key === "sales_intelligence")?.count).toBeGreaterThanOrEqual(1);
  });

  it("supports area filter, newest-first timeline, and snapshot labels", async () => {
    const security = await getStaffUserActivity(superAdminId, {
      userId: subjectId,
      period: "90d",
      area: "security",
      page: 1,
    });
    expect(security.timeline.every((row) => row.area === "security")).toBe(true);

    const customers = await getStaffUserActivity(superAdminId, {
      userId: subjectId,
      period: "90d",
      area: "customers",
      page: 1,
    });
    expect(customers.timeline.some((row) => row.recordLabel === "Halfords")).toBe(true);

    const all = await getStaffUserActivity(superAdminId, {
      userId: subjectId,
      period: "90d",
      area: "all",
      page: 1,
      pageSize: 50,
    });
    const times = all.timeline.map((row) => new Date(row.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const logins = await listStaffLoginHistory(superAdminId, { userId: subjectId, page: 1 });
    expect(logins.items.some((row) => row.action === "LOGIN_SUCCESS")).toBe(true);
    expect(logins.items.some((row) => row.ipAddress === "203.0.113.10")).toBe(true);
  });

  it("scrubs secrets from audit metadata", async () => {
    await recordAuditEvent({
      action: "company.updated",
      entityType: "Company",
      entityId: `secret-${stamp}`,
      actorUserId: subjectId,
      metadata: {
        companyName: "Secret Co",
        password: "should-not-persist",
        resetToken: "tok",
        sessionToken: "sess",
      },
    });
    const row = await prisma.auditEvent.findFirst({
      where: { entityId: `secret-${stamp}` },
    });
    expect(JSON.stringify(row?.metadata)).toContain("[redacted]");
    expect(JSON.stringify(row?.metadata)).not.toContain("should-not-persist");
  });
});
