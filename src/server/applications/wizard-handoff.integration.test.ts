/**
 * Phase 3 — trade approval → customer wizard handoff.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  approveTradeApplication,
  getTradeApplication,
  rejectTradeApplication,
  submitTradeApplication,
  TRADE_APPROVAL_SIDE_EFFECTS,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import { getCustomerCreationWizard } from "@/server/companies/customer-creation-wizard";
import { createCompany } from "@/server/companies/service";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";
let limitedId = "";

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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`wiz.hand.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  limitedId = await ensureUser(`wiz.hand.view.${stamp}@example.invalid`, ["ACCOUNTS"]);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("trade application wizard handoff", () => {
  it("surfaces company matches, side-effect disclosure, and unverified applicant claims before approval", async () => {
    const existing = await createCompany(adminId, {
      name: `Existing Match Factors ${stamp}`,
      primaryEmail: `existing.match.${stamp}@example.invalid`,
      status: "PROSPECT",
    });
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Existing Match Factors ${stamp}`,
        email: `applicant.match.${stamp}@example.invalid`,
        claimedAutopartCustomerCode: "S19789",
        existingAccountClaim: "yes",
      }),
    );
    const detail = await getTradeApplication(adminId, submitted.id);
    expect(detail.approvalSideEffects).toEqual([...TRADE_APPROVAL_SIDE_EFFECTS]);
    expect(detail.applicantDeclared?.autopartCustomerCode).toBe("S19789");
    expect(detail.applicantDeclared?.autopartVerified).toBe(false);
    expect(detail.possibleCompanyMatches.some((row) => row.id === existing.id)).toBe(true);
    expect(detail.setupPath).toBeNull();
    expect(detail.companyId).toBeNull();
  });

  it("approves once, opens the same company in the wizard, and keeps claimed Autopart unverified", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Wizard Hand Off ${stamp}`,
        email: `wizard.hand.${stamp}@example.invalid`,
        claimedAutopartCustomerCode: "WIZ99",
        existingAccountClaim: "yes",
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);
    expect(approved.companyId).toBeTruthy();

    const again = await approveTradeApplication(adminId, { id: submitted.id });
    expect(again.created).toBe(false);
    expect(again.companyId).toBe(approved.companyId);

    const detail = await getTradeApplication(adminId, submitted.id);
    expect(detail.status).toBe("APPROVED");
    expect(detail.companyId).toBe(approved.companyId);
    expect(detail.setupPath).toBe(`/admin/customers/setup?companyId=${approved.companyId}`);
    expect(detail.company?.autopartCustomerCode).toBeNull();

    const company = await prisma.company.findUniqueOrThrow({ where: { id: approved.companyId } });
    expect(company.status).toBe("ACTIVE");
    expect(company.autopartCustomerCode).toBeNull();
    expect(company.autopartCustomerCodeVerifiedAt).toBeNull();

    const wizard = await getCustomerCreationWizard(adminId, approved.companyId);
    expect(wizard.source?.key).toBe("TRADE_APPLICATION");
    expect(wizard.source?.applicantClaimedAutopartCode).toBe("WIZ99");
    expect(wizard.company.autopartAccount.verified).toBe(false);
    expect(wizard.company.id).toBe(approved.companyId);
  });

  it("keeps rejection unchanged and blocks limited roles from approving", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Reject Keep ${stamp}`,
        email: `reject.keep.${stamp}@example.invalid`,
      }),
    );
    await expect(approveTradeApplication(limitedId, { id: submitted.id })).rejects.toBeInstanceOf(
      AuthError,
    );
    const rejected = await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Not a fit",
    });
    expect(rejected.status).toBe("REJECTED");
    await expect(approveTradeApplication(adminId, { id: submitted.id })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
