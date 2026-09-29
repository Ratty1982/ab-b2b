/**
 * Company commercial status vs user invite activation on trade approval.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import {
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";
import {
  acceptTradeInvitation,
  approveTradeApplication,
  rejectTradeApplication,
  repairApprovedTradeCompanyStatuses,
  submitTradeApplication,
} from "@/server/applications/service";
import {
  loadApprovedActivationToken,
  validTradeApplicationInput,
} from "@/server/applications/test-fixtures";
import { createCompany } from "@/server/companies/service";

const prisma = new PrismaClient();
const suffix = `co-status-${Date.now()}`;
let adminId = "";

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

async function enableSmtp() {
  const mock = createMockSmtpTransport({
    sendResult: { ok: true, id: "mock-co-status" },
  });
  setEmailTransportForTests(mock);
  setSmtpTransportFactoryForTests(() => mock);
  await updateEmailSettings(adminId, {
    enabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecurity: "STARTTLS",
    smtpUsername: "noreply@example.com",
    smtpPassword: "secret",
    replacePassword: true,
    fromName: "Automotive Brands",
    fromEmail: "noreply@example.com",
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`co.status.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  await prisma.emailSettings.deleteMany({});
  await getOrCreateEmailSettings();
  await enableSmtp();
});

afterAll(async () => {
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  await prisma.$disconnect();
});

describe("Company status on trade approval", () => {
  it("submitted application does not create or activate a Company", async () => {
    const email = `submit.only.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Submit Only ${suffix}`,
        email,
      }),
    );
    const app = await prisma.tradeApplication.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(app.status).toBe("SUBMITTED");
    expect(app.companyId).toBeNull();
    const companies = await prisma.company.findMany({
      where: { name: `Submit Only ${suffix}` },
    });
    expect(companies).toHaveLength(0);
  });

  it("approval makes Company ACTIVE before invite activation", async () => {
    const email = `approve.active.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Approve Active ${suffix}`,
        email,
      }),
    );

    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);

    const app = await prisma.tradeApplication.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(app.status).toBe("APPROVED");
    expect(app.companyId).toBe(approved.companyId);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.status).toBe("ACTIVE");

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("INVITED");

    const membership = await prisma.companyUser.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: company.id, userId: user.id },
      },
    });
    expect(membership.status).toBe("INVITED");
  });

  it("user remains invited until activation; activation does not alter Company status", async () => {
    const email = `activate.keep.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Activate Keep ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });

    const beforeUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(beforeUser.status).toBe("INVITED");

    // Prove activation only touches User/CompanyUser — not commercial Company.status.
    await prisma.company.update({
      where: { id: approved.companyId },
      data: { status: "ON_HOLD" },
    });

    const inviteToken = await loadApprovedActivationToken(prisma, submitted.id);
    const activated = await acceptTradeInvitation({
      token: inviteToken,
      password: "SecurePass-Status1",
      confirmPassword: "SecurePass-Status1",
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: activated.userId } });
    expect(user.status).toBe("ACTIVE");

    const membership = await prisma.companyUser.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: approved.companyId, userId: activated.userId },
      },
    });
    expect(membership.status).toBe("ACTIVE");

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.status).toBe("ON_HOLD");
  });

  it("rejection does not make Company ACTIVE", async () => {
    const email = `reject.no.co.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Reject No Co ${suffix}`,
        email,
      }),
    );
    const rejected = await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Not a trade account",
    });
    expect(rejected.status).toBe("REJECTED");

    const app = await prisma.tradeApplication.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(app.companyId).toBeNull();
    const companies = await prisma.company.findMany({
      where: { name: `Reject No Co ${suffix}` },
    });
    expect(companies).toHaveLength(0);
  });

  it("unrelated CRM prospect remains PROSPECT after repair", async () => {
    const prospect = await createCompany(adminId, {
      name: `CRM Prospect ${suffix}`,
      status: "PROSPECT",
    });
    expect(prospect.status).toBe("PROSPECT");

    const result = await repairApprovedTradeCompanyStatuses(adminId);
    expect(result.repaired.some((r) => r.companyId === prospect.id)).toBe(false);

    const still = await prisma.company.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(still.status).toBe("PROSPECT");
  });

  it("approved legacy application + linked PROSPECT Company can be safely repaired", async () => {
    const email = `legacy.prospect.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Legacy Prospect ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });

    // Simulate legacy bug: approved app linked to a PROSPECT company.
    await prisma.company.update({
      where: { id: approved.companyId },
      data: { status: "PROSPECT" },
    });
    const broken = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(broken.status).toBe("PROSPECT");

    const crmOnly = await createCompany(adminId, {
      name: `Unrelated Prospect ${suffix}`,
      status: "PROSPECT",
    });

    const repaired = await repairApprovedTradeCompanyStatuses(adminId);
    expect(repaired.repairedCount).toBeGreaterThanOrEqual(1);
    expect(repaired.repaired.some((r) => r.companyId === approved.companyId)).toBe(true);
    expect(repaired.repaired.some((r) => r.companyId === crmOnly.id)).toBe(false);

    const fixed = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(fixed.status).toBe("ACTIVE");

    const untouched = await prisma.company.findUniqueOrThrow({ where: { id: crmOnly.id } });
    expect(untouched.status).toBe("PROSPECT");

    // Idempotent re-approve also heals PROSPECT → ACTIVE.
    await prisma.company.update({
      where: { id: approved.companyId },
      data: { status: "PROSPECT" },
    });
    await approveTradeApplication(adminId, { id: submitted.id });
    const healed = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(healed.status).toBe("ACTIVE");
  });

  it("idempotent re-approval does not resurrect ON_HOLD / SUSPENDED / CLOSED", async () => {
    for (const held of ["ON_HOLD", "SUSPENDED", "CLOSED"] as const) {
      const email = `hold.${held.toLowerCase()}.${suffix}@example.invalid`;
      const submitted = await submitTradeApplication(
        validTradeApplicationInput({
          companyName: `Hold ${held} ${suffix}`,
          email,
        }),
      );
      const approved = await approveTradeApplication(adminId, { id: submitted.id });
      await prisma.company.update({
        where: { id: approved.companyId },
        data: { status: held },
      });

      await approveTradeApplication(adminId, { id: submitted.id });
      const still = await prisma.company.findUniqueOrThrow({
        where: { id: approved.companyId },
      });
      expect(still.status).toBe(held);
    }
  });
});
