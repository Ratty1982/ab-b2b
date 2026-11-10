import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { completeCustomerSalesCutoverWithoutHistory } from "@/server/companies/customer-sales-history-import";
import {
  getCustomerSetup,
  saveCustomerSetupAndEnableOrdering,
  assertCompanyReadyForStaffOrders,
} from "@/server/companies/customer-setup";
import { saveCustomerCreationDetails } from "@/server/companies/customer-creation-wizard";
import { AuthError } from "@/server/rbac/guards";
import { CUSTOMER_SALES_READY_ENFORCE_FROM } from "@/domain/customer-sales-readiness";

const prisma = new PrismaClient();
const stamp = Date.now().toString();
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`setup.ready.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer setup READY_FOR_SALES", { timeout: 30_000 }, () => {
  it("verifies Autopart, activates prospect, completes setup, then allows staff orders", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Setup Co ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `setup-${local}@example.invalid`,
      phone: "01130000000",
      customerType: "Motor Factor",
    });
    const companyId = created.companyId;
    const code = `SU${local.slice(-8).toUpperCase()}`;

    const before = await getCustomerSetup(adminId, companyId);
    expect(before.company.status).toBe("PROSPECT");
    expect(before.salesReadiness.canCreateStaffOrder).toBe(false);

    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    const afterVerify = await getCustomerSetup(adminId, companyId);
    expect(afterVerify.company.status).toBe("ACTIVE");
    expect(afterVerify.company.autopartAccount.verified).toBe(true);
    expect(afterVerify.salesReadiness.readyForSales).toBe(false);

    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      confirmAccount: code,
      reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
    });

    await expect(assertCompanyReadyForStaffOrders(companyId)).rejects.toBeInstanceOf(AuthError);

    const saved = await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimit: null,
      creditLimitReviewed: true,
      contacts: [
        {
          firstName: "Sam",
          lastName: "Buyer",
          email: `buyer-${local}@example.invalid`,
          phone: "01130000001",
          jobTitle: "Buyer",
          isPrimary: true,
          isPurchasing: true,
          isAccounts: false,
        },
      ],
      addresses: [
        {
          type: "TRADING",
          line1: "1 High Street",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
          isDefaultBilling: true,
          isDefaultDelivery: true,
        },
      ],
      enableOrdering: true,
    });

    expect(saved.salesReadiness.readyForSales).toBe(true);
    expect(saved.salesReadiness.label).toBe("READY_FOR_SALES");
    await expect(assertCompanyReadyForStaffOrders(companyId)).resolves.toMatchObject({
      readyForSales: true,
    });

    // Repeated save is idempotent.
    const again = await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimit: null,
      creditLimitReviewed: true,
      contacts: [],
      addresses: [],
      enableOrdering: true,
    });
    expect(again.salesReadiness.readyForSales).toBe(true);

    await prisma.address.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("does not activate suspended accounts on Autopart verify", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: {
        name: `Suspended ${local}`,
        status: "SUSPENDED",
        createdAt: new Date(CUSTOMER_SALES_READY_ENFORCE_FROM),
      },
    });
    const code = `SX${local.slice(-8).toUpperCase()}`;
    await expect(
      linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code }),
    ).resolves.toMatchObject({ verified: true });
    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      select: { status: true },
    });
    expect(row.status).toBe("SUSPENDED");
    await prisma.company.delete({ where: { id: company.id } });
  });

  it("grandfathers pre-rollout Active customers for staff ordering", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: {
        name: `Legacy ${local}`,
        status: "ACTIVE",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    await expect(assertCompanyReadyForStaffOrders(company.id)).resolves.toMatchObject({
      legacyEligible: true,
      canCreateStaffOrder: true,
    });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
