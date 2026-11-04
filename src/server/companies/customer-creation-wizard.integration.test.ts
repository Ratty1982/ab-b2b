/**
 * Guided customer creation against the isolated test database.
 * Does not send invitations or import Autopart sales.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import {
  linkAndVerifyCompanyAutopartCustomerCode,
  setCompanyAutopartCustomerCode,
} from "@/server/companies/autopart-account";
import { linkAutopartAccountToCompany } from "@/server/companies/autopart-master-import";
import {
  completeCustomerSalesCutoverWithoutHistory,
  startCustomerSalesHistoryBaseline,
} from "@/server/companies/customer-sales-history-import";
import { setCompanyCustomerGroup } from "@/server/companies/customer-groups";
import { inviteCompanyUser, updateCompany } from "@/server/companies/service";
import {
  getCustomerCreationWizard,
  saveCustomerCreationDetails,
  searchCustomerCreationDuplicates,
} from "@/server/companies/customer-creation-wizard";
import { wizardFinishPlan } from "@/domain/customer-creation-wizard";

const stamp = Date.now();
const name = `Wizard Motors ${stamp}`;
const salesCode = `WIZ${String(stamp).slice(-6)}`;

let adminId = "";
let limitedId = "";
let staffEmailUserId = "";
let companyId = "";

async function ensureUser(email: string, roleKey: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`wizard.admin.${stamp}@example.invalid`, "SUPER_ADMIN");
  const limitedRole = await prisma.role.create({
    data: {
      key: `wizard-limited-${stamp}`,
      name: `Wizard limited ${stamp}`,
      permissions: {
        create: ["companies.view", "companies.create"].map((key) => ({
          permission: { connect: { key } },
        })),
      },
    },
  });
  const limited = await prisma.user.create({
    data: {
      email: `wizard.limited.${stamp}@example.invalid`,
      name: "Wizard limited",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  await prisma.userRole.create({ data: { userId: limited.id, roleId: limitedRole.id } });
  limitedId = limited.id;
  staffEmailUserId = (
    await prisma.user.create({
      data: {
        email: `wizard.staff.${stamp}@example.invalid`,
        name: "Wizard staff",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer creation wizard", () => {
  it("creates one prospect with a contact and address and does not verify, invite, or invent history", async () => {
    const created = await saveCustomerCreationDetails(adminId, {
      name,
      customerType: "Motor Factor",
      status: "PROSPECT",
      phone: "0114000111",
      primaryEmail: `wizard.${stamp}@example.invalid`,
      notes: "Created from the guided setup.",
      contact: {
        firstName: "Ada",
        lastName: "Parts",
        email: `ada.${stamp}@example.invalid`,
        phone: "0114000111",
      },
      address: { line1: "1 Test Street", town: "Sheffield", postcode: "S1 1AA", country: "GB" },
    });
    companyId = created.companyId;
    expect(created.created).toBe(true);

    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.status).toBe("PROSPECT");
    expect(row.autopartCustomerCode).toBeNull();
    expect(row.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(row.notes).toContain("Customer type: Motor Factor");
    expect(await prisma.contact.count({ where: { companyId } })).toBe(1);
    expect(await prisma.address.count({ where: { companyId, isDefaultDelivery: true } })).toBe(1);
    expect(await prisma.userInvitation.count({ where: { companyId } })).toBe(0);
    expect(await prisma.companyUser.count({ where: { companyId } })).toBe(0);
    expect(await prisma.customerSalesCutover.count({ where: { companyId } })).toBe(0);
    expect(await prisma.order.count({ where: { companyId } })).toBe(0);
    expect(await prisma.autopartSalesDocument.count({ where: { companyId } })).toBe(0);

    const wizard = await getCustomerCreationWizard(adminId, companyId);
    expect(wizard.company.id).toBe(companyId);
    expect(wizard.company.customerType).toBe("Motor Factor");
    expect(wizard.onboarding.onboardingComplete).toBe(false);
    expect(wizard.onboarding.activationComplete).toBe(false);
    expect(wizard.suggestedStep).toBe(2);
    expect(wizard.history.status).toBe("NOT_STARTED");
    expect(wizard.masters).toEqual([]);
  });

  it("blocks an exact duplicate until staff confirm, and opening the match does not create another company", async () => {
    await expect(
      saveCustomerCreationDetails(adminId, {
        name,
        status: "PROSPECT",
        primaryEmail: `other.${stamp}@example.invalid`,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_CUSTOMER" });
    expect(await prisma.company.count({ where: { name } })).toBe(1);

    const matches = await searchCustomerCreationDuplicates(adminId, { name });
    expect(matches[0]?.id).toBe(companyId);
    expect(matches[0]?.strength).toBe("strong");
    const opened = await getCustomerCreationWizard(adminId, matches[0]!.id);
    expect(opened.company.id).toBe(companyId);
    expect(await prisma.company.count({ where: { name } })).toBe(1);
  });

  it("links a 407EXP master without copying a verified sales code", async () => {
    const account = await prisma.autopartAccount.create({
      data: {
        accountCode: salesCode,
        originalName: name,
        classification: "TRADE_CANDIDATE",
      },
    });
    await linkAutopartAccountToCompany(adminId, {
      accountId: account.id,
      companyId,
      setPrimary: false,
    });
    const linked = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(linked.autopartCustomerCode).toBeNull();
    expect(linked.autopartCustomerCodeVerifiedAt).toBeNull();

    const saved = await setCompanyAutopartCustomerCode(adminId, { companyId, code: salesCode });
    expect(saved.verified).toBe(false);
    const unverified = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(unverified.autopartCustomerCode).toBe(salesCode);
    expect(unverified.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(unverified.autopartCustomerCodeVerifiedById).toBeNull();

    const verified = await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId,
      code: salesCode,
    });
    expect(verified.verified).toBe(true);
    expect(verified.verifiedBy?.id).toBe(adminId);
    const audit = await prisma.auditEvent.findFirst({
      where: { companyId, action: "company.autopart_account.linked_verified" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);
  });

  it("keeps a prospect conversion code unverified when the wizard is reopened", async () => {
    const prospect = await saveCustomerCreationDetails(adminId, {
      name: `Prospect conversion ${stamp}`,
      status: "PROSPECT",
    });
    const code = `PR${String(stamp).slice(-5)}`;
    await setCompanyAutopartCustomerCode(adminId, { companyId: prospect.companyId, code });
    const wizard = await getCustomerCreationWizard(adminId, prospect.companyId);
    expect(wizard.company.status).toBe("PROSPECT");
    expect(wizard.company.autopartAccount.code).toBe(code);
    expect(wizard.company.autopartAccount.verified).toBe(false);
    expect(wizard.onboarding.steps.find((step) => step.id === "autopart")?.state).toBe(
      "awaiting_verification",
    );
    const row = await prisma.company.findUniqueOrThrow({ where: { id: prospect.companyId } });
    expect(row.autopartCustomerCodeVerifiedAt).toBeNull();
  });

  it("assigns commercial terms through the existing company update and leaves verification untouched", async () => {
    const list = await prisma.priceList.create({
      data: { code: `WIZ-${stamp}`, name: `Wizard list ${stamp}` },
    });
    const group = await prisma.customerGroup.create({
      data: { name: `Wizard group ${stamp}` },
    });
    await updateCompany(adminId, {
      id: companyId,
      paymentTerms: "30 DAYS",
      priceListId: list.id,
    });
    await setCompanyCustomerGroup(adminId, { companyId, customerGroupId: group.id });
    const wizard = await getCustomerCreationWizard(adminId, companyId);
    expect(wizard.company.paymentTerms).toBe("30 DAYS");
    expect(wizard.company.priceList?.id).toBe(list.id);
    expect(wizard.company.customerGroup?.id).toBe(group.id);
    expect(wizard.company.autopartAccount.verified).toBe(true);
    expect(wizard.company.id).toBe(companyId);
  });

  it("records no historical purchases only when staff confirm the verified account", async () => {
    await updateCompany(adminId, { id: companyId, status: "ACTIVE" });
    const recorded = await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      reason: "New account with no Autopart purchases before launch.",
      confirmAccount: salesCode,
    });
    expect(recorded.historyStatus).toBe("COMPLETE");
    const wizard = await getCustomerCreationWizard(adminId, companyId);
    expect(wizard.history.kind).toBe("NO_HISTORICAL_SALES");
    expect(wizard.history.status).toBe("COMPLETE");
    expect(await prisma.autopartSalesDocument.count({ where: { companyId } })).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(0);
    await expect(startCustomerSalesHistoryBaseline(adminId, companyId)).rejects.toBeInstanceOf(
      AuthError,
    );

    const discarded = await saveCustomerCreationDetails(adminId, {
      name: `Discarded baseline ${stamp}`,
      status: "ACTIVE",
      confirmActivation: true,
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: discarded.companyId,
      code: `DB${String(stamp).slice(-5)}`,
    });
    const baseline = await startCustomerSalesHistoryBaseline(adminId, discarded.companyId);
    expect(baseline.kind).toBe("PRELAUNCH_HISTORY_DISCARDED");
    await expect(
      completeCustomerSalesCutoverWithoutHistory(adminId, {
        companyId: discarded.companyId,
        reason: "This must not overwrite a discarded baseline.",
        confirmAccount: `DB${String(stamp).slice(-5)}`,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("adds a portal contact without sending an invitation, and still refuses a staff email", async () => {
    const before = await prisma.userInvitation.count({ where: { companyId } });
    await saveCustomerCreationDetails(adminId, {
      companyId,
      name,
      status: "ACTIVE",
      confirmActivation: true,
      customerType: "Motor Factor",
      notes: "Created from the guided setup.",
    });
    expect(await prisma.userInvitation.count({ where: { companyId } })).toBe(before);
    await expect(
      inviteCompanyUser(adminId, {
        companyId,
        email: `wizard.staff.${stamp}@example.invalid`,
        role: "TRADE_BUYER",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(staffEmailUserId).toBeTruthy();
    const prospect = await saveCustomerCreationDetails(adminId, {
      name: `No invite prospect ${stamp}`,
      status: "PROSPECT",
    });
    await expect(
      inviteCompanyUser(adminId, {
        companyId: prospect.companyId,
        email: `portal.${stamp}@example.invalid`,
        role: "TRADE_BUYER",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.userInvitation.count({ where: { companyId: prospect.companyId } })).toBe(0);
  });

  it("refuses commercial edits and account verification without those permissions", async () => {
    const visible = await getCustomerCreationWizard(limitedId, companyId);
    expect(visible.permissions.canEditCompany).toBe(false);
    expect(visible.permissions.canVerifyAccount).toBe(false);
    expect(visible.permissions.canEditPricing).toBe(false);
    expect(visible.permissions.canManageGroups).toBe(false);
    expect(visible.permissions.canImportHistory).toBe(false);
    expect(visible.permissions.canManageUsers).toBe(false);

    await expect(
      updateCompany(limitedId, { id: companyId, paymentTerms: "7 DAYS" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      setCompanyAutopartCustomerCode(limitedId, { companyId, code: "NOPE" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      linkAndVerifyCompanyAutopartCustomerCode(limitedId, { companyId, code: salesCode }),
    ).rejects.toBeInstanceOf(AuthError);
    const unchanged = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(unchanged.autopartCustomerCode).toBe(salesCode);
    expect(unchanged.paymentTerms).toBe("30 DAYS");

    const alone = await saveCustomerCreationDetails(limitedId, {
      name: `Limited creator ${stamp}`,
      status: "PROSPECT",
    });
    expect(alone.created).toBe(true);
    await expect(
      saveCustomerCreationDetails(limitedId, {
        name: `Limited contact ${stamp}`,
        status: "PROSPECT",
        contact: { firstName: "No", lastName: "Permission" },
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(await prisma.company.count({ where: { name: `Limited contact ${stamp}` } })).toBe(0);
  });

  it("reopens the same company and finishing plans no writes", async () => {
    const again = await getCustomerCreationWizard(adminId, companyId);
    expect(again.company.id).toBe(companyId);
    expect(again.contacts.length).toBeGreaterThan(0);
    expect(wizardFinishPlan(companyId).mutations).toEqual([]);
    expect(wizardFinishPlan(companyId).activatesCustomer).toBe(false);
    expect(wizardFinishPlan(companyId).sendsInvitation).toBe(false);
  });
});
