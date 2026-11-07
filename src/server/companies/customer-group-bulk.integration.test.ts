/**
 * Bulk Customer Group assignment — safety and scale.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { createCustomerGroup } from "@/server/companies/customer-groups";
import {
  confirmBulkCustomerGroupAssign,
  previewBulkCustomerGroupAssign,
  resolveAllCompaniesForBulkCustomerGroupAssign,
  searchCompaniesForBulkCustomerGroupAssign,
} from "@/server/companies/customer-group-bulk";

const prisma = new PrismaClient();
const stamp = Date.now();
const BULK = 142;

let adminId = "";
let salesId = "";
let targetGroupId = "";
let otherGroupId = "";
const companyIds: string[] = [];

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
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`cg.bulk.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`cg.bulk.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);

  const target = await createCustomerGroup(adminId, {
    name: `Vertu Bulk ${stamp}`,
    description: "Bulk assign integration target",
  });
  targetGroupId = target.id;
  const other = await createCustomerGroup(adminId, {
    name: `Other Bulk ${stamp}`,
    description: "Conflict group",
  });
  otherGroupId = other.id;

  // 142 separate Company records with VERTU-like Autopart codes (+ a few edge cases).
  const rows = Array.from({ length: BULK }, (_, index) => {
    const n = String(index + 1).padStart(3, "0");
    const code = `VERTU${n}${String(stamp).slice(-4)}`;
    return {
      name: `Vertu Site ${n} ${stamp}`,
      status: "ACTIVE" as const,
      autopartCustomerCode: code,
      customerGroupId: index === 0 ? otherGroupId : index === 1 ? targetGroupId : null,
    };
  });
  // createMany cannot return ids on all providers — create in batches via create.
  for (const row of rows) {
    const company = await prisma.company.create({ data: row, select: { id: true } });
    companyIds.push(company.id);
  }
}, 120_000);

afterAll(async () => {
  if (companyIds.length) {
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
  if (targetGroupId) await prisma.customerGroup.deleteMany({ where: { id: targetGroupId } });
  if (otherGroupId) await prisma.customerGroup.deleteMany({ where: { id: otherGroupId } });
  await prisma.$disconnect();
});

describe("bulk customer group assignment", () => {
  // Unique seed marker appears in Company.name; Autopart codes are VERTU{nnn}{stamp4}.
  const seedQ = String(stamp);

  it("searches 142 Vertu-coded companies with pagination and Autopart code match", async () => {
    const page1 = await searchCompaniesForBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      q: seedQ,
      status: "ACTIVE",
      membership: "ALL",
      page: 1,
      pageSize: 50,
    });
    expect(page1.total).toBe(BULK);
    expect(page1.items).toHaveLength(50);
    expect(page1.items[0]?.autopartAccountCodes[0]).toMatch(/^VERTU/);

    const page3 = await searchCompaniesForBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      q: seedQ,
      status: "ACTIVE",
      page: 3,
      pageSize: 50,
    });
    expect(page3.items.length).toBe(BULK - 100);

    const byExact = await searchCompaniesForBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      q: page1.items[0]!.autopartCustomerCode,
      page: 1,
      pageSize: 10,
    });
    expect(byExact.items.some((row) => row.id === page1.items[0]!.id)).toBe(true);
  });

  it("resolves select-all matches and previews without silently moving other-group members", async () => {
    const resolved = await resolveAllCompaniesForBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      q: seedQ,
      status: "ACTIVE",
      membership: "ALL",
    });
    expect(resolved.total).toBe(BULK);
    expect(resolved.companyIds).toHaveLength(BULK);

    const preview = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: resolved.companyIds,
      allowReassignment: false,
    });
    expect(preview.counts.selected).toBe(BULK);
    expect(preview.counts.alreadyInTarget).toBe(1);
    expect(preview.counts.conflicts).toBe(1);
    expect(preview.counts.assignable).toBe(BULK - 2);
    expect(preview.conflicts[0]?.currentGroupName).toContain("Other Bulk");
  });

  it("assigns eligible companies, skips conflicts, and is idempotent on repeat preview confirm", async () => {
    const resolved = await resolveAllCompaniesForBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      q: seedQ,
      status: "ACTIVE",
      membership: "UNGROUPED",
    });
    expect(resolved.total).toBe(BULK - 2);

    const preview = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: resolved.companyIds,
      allowReassignment: false,
    });
    const first = await confirmBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: resolved.companyIds,
      allowReassignment: false,
      previewToken: preview.previewToken,
    });
    expect(first.summary.assigned).toBe(BULK - 2);
    expect(first.summary.failed).toBe(0);
    expect(first.bulkOperationId).toBeTruthy();

    const conflictCompanyId = companyIds[0]!;
    const stillOther = await prisma.company.findUniqueOrThrow({ where: { id: conflictCompanyId } });
    expect(stillOther.customerGroupId).toBe(otherGroupId);

    const inTarget = await prisma.company.count({
      where: { id: { in: companyIds }, customerGroupId: targetGroupId },
    });
    expect(inTarget).toBe(BULK - 1); // original already-in-target + newly assigned

    const audit = await prisma.auditEvent.findFirst({
      where: {
        entityId: targetGroupId,
        action: "customer_group.bulk_assign_completed",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);
    expect((audit?.metadata as { bulkOperationId?: string } | null)?.bulkOperationId).toBe(
      first.bulkOperationId,
    );

    // Stale preview token after mutations must fail.
    await expect(
      confirmBulkCustomerGroupAssign(adminId, {
        targetGroupId,
        companyIds: resolved.companyIds,
        allowReassignment: false,
        previewToken: preview.previewToken,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const againPreview = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: resolved.companyIds,
      allowReassignment: false,
    });
    expect(againPreview.counts.alreadyInTarget).toBe(BULK - 2);
    expect(againPreview.counts.assignable).toBe(0);
    const again = await confirmBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: resolved.companyIds,
      allowReassignment: false,
      previewToken: againPreview.previewToken,
    });
    expect(again.summary.assigned).toBe(0);
    expect(again.summary.alreadyAssigned).toBe(BULK - 2);
  });

  it("reassigns only when explicitly allowed and blocks sales reps without manage", async () => {
    const conflictId = companyIds[0]!;
    const previewBlocked = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: [conflictId],
      allowReassignment: false,
    });
    expect(previewBlocked.counts.conflicts).toBe(1);

    const previewMove = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: [conflictId],
      allowReassignment: true,
    });
    expect(previewMove.counts.assignable).toBe(1);
    const moved = await confirmBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: [conflictId],
      allowReassignment: true,
      previewToken: previewMove.previewToken,
    });
    expect(moved.summary.assigned).toBe(1);
    expect(moved.summary.moved).toBe(1);
    const row = await prisma.company.findUniqueOrThrow({ where: { id: conflictId } });
    expect(row.customerGroupId).toBe(targetGroupId);

    await expect(
      searchCompaniesForBulkCustomerGroupAssign(salesId, {
        targetGroupId,
        q: "VERTU",
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("does not alter Autopart verification, status, or pricing during bulk assign", async () => {
    const sampleId = companyIds[10]!;
    await prisma.company.update({
      where: { id: sampleId },
      data: {
        paymentTerms: "30 DAYS",
        autopartCustomerCodeVerifiedAt: new Date("2026-01-15T12:00:00.000Z"),
        autopartCustomerCodeVerifiedById: adminId,
        status: "ACTIVE",
      },
    });
    const before = await prisma.company.findUniqueOrThrow({ where: { id: sampleId } });
    // already in target from earlier test — preview/confirm no-op path
    const preview = await previewBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: [sampleId],
      allowReassignment: false,
    });
    await confirmBulkCustomerGroupAssign(adminId, {
      targetGroupId,
      companyIds: [sampleId],
      allowReassignment: false,
      previewToken: preview.previewToken,
    });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: sampleId } });
    expect(after.paymentTerms).toBe(before.paymentTerms);
    expect(after.status).toBe(before.status);
    expect(after.autopartCustomerCodeVerifiedAt?.toISOString()).toBe(
      before.autopartCustomerCodeVerifiedAt?.toISOString(),
    );
    expect(after.autopartCustomerCodeVerifiedById).toBe(before.autopartCustomerCodeVerifiedById);
    expect(after.autopartCustomerCode).toBe(before.autopartCustomerCode);
  });
});
