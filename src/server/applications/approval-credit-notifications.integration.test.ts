/**
 * Trade approval with credit limit + internal/PL notification idempotency.
 * Compatible with PR #88 wizard handoff behaviour.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  approveTradeApplication,
  getTradeApplication,
  submitTradeApplication,
  TRADE_APPROVAL_SIDE_EFFECTS,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import { getCustomerCreationWizard } from "@/server/companies/customer-creation-wizard";
import { sendMissingAutopartCodeNotificationIfNeeded } from "@/server/email/transactional";
import { MISSING_AUTOPART_CODE_NOTIFY_EMAIL } from "@/server/email/approval-internal-templates";
import { formatCreditLimitGbp } from "@/domain/credit-limit";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email,
        actorType: "INTERNAL",
        status: "ACTIVE",
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

async function ensureTradeRecipients(emails: string[]) {
  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled: false,
      tradeApplicationRecipients: emails,
    },
    update: {
      enabled: false,
      tradeApplicationRecipients: emails,
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`appr.credit.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await ensureTradeRecipients([`trade.internal.${stamp}@example.invalid`]);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("trade approval credit + notifications", () => {
  it("sends PL missing-code email only when Autopart claim is blank", async () => {
    const missing = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Missing Code Co ${stamp}`,
        email: `missing.code.${stamp}@example.invalid`,
        claimedAutopartCustomerCode: "   ",
        existingAccountClaim: "no",
      }),
    );
    const plRows = await prisma.transactionalEmail.findMany({
      where: {
        purpose: "TRADE_APPLICATION_MISSING_AUTOPART_CODE",
        entityId: missing.id,
      },
    });
    expect(plRows.length).toBe(1);
    expect(plRows[0]!.toEmail).toBe(MISSING_AUTOPART_CODE_NOTIFY_EMAIL);
    expect(plRows[0]!.subject).toContain("Check MAM");

    // Idempotent resend path
    await sendMissingAutopartCodeNotificationIfNeeded(missing.id);
    expect(
      await prisma.transactionalEmail.count({
        where: {
          purpose: "TRADE_APPLICATION_MISSING_AUTOPART_CODE",
          entityId: missing.id,
        },
      }),
    ).toBe(1);

    const withCode = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Has Code Co ${stamp}`,
        email: `has.code.${stamp}@example.invalid`,
        claimedAutopartCustomerCode: "S19789",
        existingAccountClaim: "yes",
      }),
    );
    expect(
      await prisma.transactionalEmail.count({
        where: {
          purpose: "TRADE_APPLICATION_MISSING_AUTOPART_CODE",
          entityId: withCode.id,
        },
      }),
    ).toBe(0);

    // Existing internal recipients still notified on submit
    expect(
      await prisma.transactionalEmail.count({
        where: {
          purpose: "TRADE_APPLICATION_INTERNAL_NOTIFICATION",
          entityId: missing.id,
        },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("stores agreed credit, notifies internals once, keeps wizard handoff, omits invented limits", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Credit Approve ${stamp}`,
        email: `credit.approve.${stamp}@example.invalid`,
        claimedAutopartCustomerCode: null,
        existingAccountClaim: "no",
      }),
    );
    const detail = await getTradeApplication(adminId, submitted.id);
    expect(detail.approvalSideEffects).toEqual([...TRADE_APPROVAL_SIDE_EFFECTS]);
    expect(detail.approvalSideEffects.some((s) => /credit limit/i.test(s))).toBe(true);

    const approved = await approveTradeApplication(adminId, {
      id: submitted.id,
      creditLimit: "£2,500.00",
      paymentTerms: "30 days",
    });
    expect(approved.created).toBe(true);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: approved.companyId } });
    expect(formatCreditLimitGbp(company.creditLimit?.toString() ?? null)).toBe("£2,500.00");
    expect(company.paymentTerms).toBe("30 days");

    const internal = await prisma.transactionalEmail.findMany({
      where: {
        purpose: "TRADE_ACCOUNT_APPROVED_INTERNAL",
        entityId: submitted.id,
      },
    });
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal.every((row) => row.textBody.includes("£2,500.00"))).toBe(true);
    expect(internal.every((row) => !/token=/i.test(row.textBody))).toBe(true);
    expect(internal.every((row) => !/token=/i.test(row.htmlBody ?? ""))).toBe(true);

    const customerApproved = await prisma.transactionalEmail.findMany({
      where: {
        purpose: "TRADE_APPLICATION_APPROVED",
        entityId: submitted.id,
      },
    });
    // Activation email may or may not exist depending on invite path; when present include limit
    for (const row of customerApproved) {
      expect(row.textBody).toContain("£2,500.00");
      expect(row.textBody).not.toMatch(/Agreed credit limit: £0\.00/);
    }

    const again = await approveTradeApplication(adminId, {
      id: submitted.id,
      creditLimit: "9999",
    });
    expect(again.created).toBe(false);
    expect(
      await prisma.transactionalEmail.count({
        where: {
          purpose: "TRADE_ACCOUNT_APPROVED_INTERNAL",
          entityId: submitted.id,
        },
      }),
    ).toBe(internal.length);

    // Credit must not change on idempotent re-approve
    const unchanged = await prisma.company.findUniqueOrThrow({ where: { id: approved.companyId } });
    expect(formatCreditLimitGbp(unchanged.creditLimit?.toString() ?? null)).toBe("£2,500.00");

    const wizard = await getCustomerCreationWizard(adminId, approved.companyId);
    expect(wizard.source?.key).toBe("TRADE_APPLICATION");
    expect(wizard.company.id).toBe(approved.companyId);
    expect(wizard.company.creditLimit).toBe("2500.00");
  });

  it("does not invent a credit limit when approval leaves it unset", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `No Credit ${stamp}`,
        email: `no.credit.${stamp}@example.invalid`,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: approved.companyId } });
    expect(company.creditLimit).toBeNull();

    const internal = await prisma.transactionalEmail.findMany({
      where: {
        purpose: "TRADE_ACCOUNT_APPROVED_INTERNAL",
        entityId: submitted.id,
      },
    });
    expect(internal.every((row) => !/Agreed credit limit/i.test(row.textBody))).toBe(true);
  });
});
