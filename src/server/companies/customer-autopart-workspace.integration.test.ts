/**
 * Autopart workspace read model: verified sales account is not a 407EXP master link.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import {
  getCustomerAutopartWorkspace,
  listCustomerAutopartImportDetails,
} from "@/server/companies/customer-autopart-workspace";

const stamp = Date.now();

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer Autopart workspace", () => {
  it("shows a verified sales account without treating a missing 407EXP link as unverified", async () => {
    const adminId = await ensureUser(`autopart.workspace.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const strangerId = await ensureUser(`autopart.stranger.${stamp}@example.invalid`, []);
    const code = `WRK${String(stamp).slice(-6)}`;
    const company = await prisma.company.create({
      data: {
        name: `Autopart workspace ${stamp}`,
        status: "ACTIVE",
        accountNumber: `AW-${stamp}`,
        autopartCustomerCode: code,
        autopartCustomerCodeVerifiedAt: new Date(),
      },
    });
    await expect(getCustomerAutopartWorkspace(strangerId, company.id)).rejects.toBeInstanceOf(AuthError);
    const snapshot = await getCustomerAutopartWorkspace(adminId, company.id);
    expect(snapshot.salesAccount.verified).toBe(true);
    expect(snapshot.salesAccount.code).toBe(code);
    expect(snapshot.master.linked).toBe(false);
    expect(snapshot.history.label).toBe("Not started");
    expect(snapshot.primaryAction).toBe("import-history");
    expect(snapshot.automaticImportEnabled).toBe(false);
    expect(snapshot.coverage.productLineCount).toBe(0);
  });

  it("keeps exception review ahead of current sales and scopes import details", async () => {
    const adminId = await ensureUser(`autopart.workspace.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const other = await prisma.company.create({
      data: {
        name: `Autopart review ${stamp}`,
        status: "ACTIVE",
        autopartCustomerCode: `RVW${String(stamp).slice(-6)}`,
        autopartCustomerCodeVerifiedAt: new Date(),
        salesCutover: { create: { historyStatus: "REVIEW", evidence: { kind: "561L_SLRB" } } },
      },
    });
    const snapshot = await getCustomerAutopartWorkspace(adminId, other.id);
    expect(snapshot.primaryAction).toBe("review-exceptions");
    expect(snapshot.stages.find((stage) => stage.id === "current")?.state).toBe("NOT_STARTED");
    const run = await prisma.autopartCustomerImportRun.create({
      data: { companyId: other.id, type: "ONGOING_504", status: "COMMITTED", dryRun: false, filename: "recent.txt" },
    });
    const foreign = await prisma.company.create({ data: { name: `Other ${stamp}`, status: "ACTIVE" } });
    await expect(
      listCustomerAutopartImportDetails(adminId, { companyId: foreign.id, runId: run.id }),
    ).rejects.toBeInstanceOf(AuthError);
    const details = await listCustomerAutopartImportDetails(adminId, { companyId: other.id, runId: run.id });
    expect(details.hasRowDiagnostics).toBe(false);
    expect(details.storedIssue).toBeNull();
  });
});
