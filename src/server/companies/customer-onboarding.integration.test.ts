/**
 * Onboarding summary and sales-account assignment.
 * Writes only to the dedicated test database.
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
import { completeCustomerSalesCutoverWithoutHistory } from "@/server/companies/customer-sales-history-import";
import { createCompany, getCompanyWorkspace, inviteCompanyUser, updateCompany } from "@/server/companies/service";

const stamp = Date.now();
const code = `ONB${String(stamp).slice(-6)}`;

let adminId = "";
let salesId = "";
let staffId = "";
let companyId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
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
  adminId = await ensureUser(`onb.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`onb.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  staffId = await ensureUser(`onb.staff.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  const rep = await prisma.salesRep.create({
    data: { userId: salesId, code: `R${String(stamp).slice(-5)}`, active: true },
  });
  const created = await createCompany(adminId, {
    name: `Onboarding ${stamp}`,
    status: "PROSPECT",
    salesRepId: rep.id,
  });
  companyId = created.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer onboarding foundation", () => {
  it("keeps a new prospect unfinished and does not treat a saved code as verified", async () => {
    const fresh = await getCompanyWorkspace(adminId, companyId);
    expect(fresh.company.id).toBe(companyId);
    expect(fresh.onboarding.activationComplete).toBe(false);
    expect(fresh.onboarding.onboardingComplete).toBe(false);
    expect(fresh.onboarding.next?.id).toBe("activation");
    expect(fresh.onboarding.steps.find((step) => step.id === "trading")?.summary).toContain("Default Trade Price");

    const assigned = await setCompanyAutopartCustomerCode(adminId, { companyId, code });
    expect(assigned.verified).toBe(false);
    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.id).toBe(companyId);
    expect(row.autopartCustomerCode).toBe(code);
    expect(row.autopartCustomerCodeVerifiedAt).toBeNull();
    expect(row.autopartCustomerCodeVerifiedById).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { companyId, action: "company.autopart_account.assigned" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);
    expect(audit?.after).toMatchObject({
      autopartCustomerCode: code,
      verification: "not_verified",
    });

    const awaiting = await getCompanyWorkspace(adminId, companyId);
    expect(awaiting.company.autopartAccount.verified).toBe(false);
    expect(awaiting.onboarding.next?.id).toBe("autopart");
    expect(awaiting.onboarding.next?.state).toBe("awaiting_verification");
    expect(awaiting.onboarding.steps.find((step) => step.id === "autopart")?.summary).toContain(
      "407EXP master is not linked",
    );
  });

  it("records the staff member when the sales account is verified and refuses a silent replacement", async () => {
    const verified = await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    expect(verified.verified).toBe(true);
    expect(verified.verifiedBy?.id).toBe(adminId);
    const verifiedRow = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const verifiedAt = verifiedRow.autopartCustomerCodeVerifiedAt;
    expect(verifiedAt).toBeTruthy();

    const again = await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: code.toLowerCase() });
    expect(again.verifiedBy?.id).toBe(adminId);
    const kept = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(kept.autopartCustomerCode).toBe(code);
    expect(kept.autopartCustomerCodeVerifiedAt?.toISOString()).toBe(verifiedAt?.toISOString());

    await expect(
      setCompanyAutopartCustomerCode(adminId, { companyId, code: `${code}X` }),
    ).rejects.toMatchObject({ code: "AUTOPART_CODE_VERIFIED" });
    const unchanged = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(unchanged.autopartCustomerCode).toBe(code);
    expect(unchanged.autopartCustomerCodeVerifiedById).toBe(adminId);

    const audit = await prisma.auditEvent.findFirst({
      where: { companyId, action: "company.autopart_account.linked_verified" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);
    expect(audit?.after).toMatchObject({ autopartCustomerCode: code, verifiedById: adminId });
  });

  it("shows the same history decision to admin and sales, and does not invent sales", async () => {
    await updateCompany(adminId, { id: companyId, status: "ACTIVE" });
    const beforeHistory = await getCompanyWorkspace(adminId, companyId);
    expect(beforeHistory.onboarding.activationComplete).toBe(true);
    expect(beforeHistory.onboarding.onboardingComplete).toBe(false);
    expect(beforeHistory.onboarding.next?.id).toBe("history");
    expect(beforeHistory.onboarding.next?.action?.tab).toBe("Autopart");

    const salesView = await getCompanyWorkspace(salesId, companyId);
    expect(salesView.onboarding.next?.id).toBe("history");
    expect(salesView.onboarding.next?.summary).toBe(beforeHistory.onboarding.next?.summary);
    expect(salesView.onboarding.next?.action).toBeNull();
    expect(salesView.onboarding.steps.find((step) => step.id === "portal")?.action).toBeNull();

    const documentsBefore = await prisma.autopartSalesDocument.count({ where: { companyId } });
    const linesBefore = await prisma.autopartSalesLine.count({ where: { companyId } });
    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      reason: "New account with no historical purchases",
      confirmAccount: code,
    });
    expect(await prisma.autopartSalesDocument.count({ where: { companyId } })).toBe(documentsBefore);
    expect(await prisma.autopartSalesLine.count({ where: { companyId } })).toBe(linesBefore);

    const done = await getCompanyWorkspace(adminId, companyId);
    const history = done.onboarding.steps.find((step) => step.id === "history");
    expect(history?.state).toBe("complete");
    expect(history?.summary).toContain("No historical purchases");
    expect(history?.summary).not.toContain("deliberately discarded");
    expect(done.company.id).toBe(companyId);
  });

  it("shows an existing portal user as complete and refuses an internal invitation", async () => {
    await expect(
      inviteCompanyUser(adminId, { companyId, email: `onb.staff.${stamp}@example.invalid`, role: "TRADE_BUYER" }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(await prisma.companyUser.count({ where: { companyId, userId: staffId } })).toBe(0);

    const buyer = await prisma.user.create({
      data: {
        email: `onb.buyer.${stamp}@example.invalid`,
        name: "Buyer",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    });
    await prisma.companyUser.create({
      data: { companyId, userId: buyer.id, role: "TRADE_BUYER", status: "ACTIVE" },
    });
    const workspace = await getCompanyWorkspace(adminId, companyId);
    expect(workspace.onboarding.steps.find((step) => step.id === "portal")?.state).toBe("complete");
    expect(workspace.onboarding.onboardingComplete).toBe(true);

    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-ONB-${String(stamp).slice(-6)}`,
        companyId,
        status: "SUBMITTED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        autopartCustomerCodeSnapshot: code,
        autopartAccountLinked: true,
        contactSnapshot: { name: "Buyer", email: buyer.email },
        deliveryAddress: { line1: "1 Road", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      },
    });
    const withOrder = await getCompanyWorkspace(adminId, companyId);
    expect(withOrder.company.id).toBe(companyId);
    expect(withOrder.onboarding.orders.count).toBe(1);
    expect(withOrder.onboarding.orders.recent[0]?.id).toBe(order.id);
    expect(withOrder.company.priceListId).toBeNull();
  });
});
