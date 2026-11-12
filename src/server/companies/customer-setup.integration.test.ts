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

async function cleanupCompany(companyId: string) {
  await prisma.address.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.customerSalesCutover.deleteMany({ where: { companyId } });
  await prisma.order.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`setup.ready.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer setup READY_FOR_SALES", { timeout: 60_000 }, () => {
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
    expect(before.salesReadiness.orderingApproved).toBe(false);

    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    const afterVerify = await getCustomerSetup(adminId, companyId);
    expect(afterVerify.company.status).toBe("ACTIVE");
    expect(afterVerify.company.autopartAccount.verified).toBe(true);
    expect(afterVerify.salesReadiness.setupRequirementsComplete).toBe(false);
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

    expect(saved.mode).toBe("enabled");
    expect(saved.orderingEnabled).toBe(true);
    expect(saved.salesReadiness.setupRequirementsComplete).toBe(true);
    expect(saved.salesReadiness.orderingApproved).toBe(true);
    expect(saved.salesReadiness.readyForSales).toBe(true);
    expect(saved.salesReadiness.label).toBe("READY_FOR_SALES");
    await expect(assertCompanyReadyForStaffOrders(companyId)).resolves.toMatchObject({
      readyForSales: true,
      canCreateStaffOrder: true,
    });

    const stamped = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { orderingEnabledAt: true },
    });
    expect(stamped.orderingEnabledAt).toBeTruthy();

    // Repeated save is idempotent and does not duplicate contacts/addresses.
    const again = await saveCustomerSetupAndEnableOrdering(adminId, {
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
    expect(again.salesReadiness.readyForSales).toBe(true);
    expect(await prisma.contact.count({ where: { companyId } })).toBe(1);
    expect(await prisma.address.count({ where: { companyId } })).toBe(1);

    await cleanupCompany(companyId);
  });

  it("rolls back enable attempts when requirements are incomplete (no partial commit)", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Partial ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `partial-${local}@example.invalid`,
    });
    const companyId = created.companyId;

    await expect(
      saveCustomerSetupAndEnableOrdering(adminId, {
        companyId,
        paymentTerms: "30 DAYS",
        creditLimitReviewed: true,
        contacts: [
          {
            firstName: "Pat",
            lastName: "Fail",
            email: `pat-${local}@example.invalid`,
            isPrimary: true,
          },
        ],
        addresses: [
          {
            type: "TRADING",
            line1: "9 Fail Street",
            town: "York",
            postcode: "YO1 1AA",
            country: "GB",
            isDefaultBilling: true,
            isDefaultDelivery: true,
          },
        ],
        enableOrdering: true,
      }),
    ).rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });

    expect(await prisma.contact.count({ where: { companyId } })).toBe(0);
    expect(await prisma.address.count({ where: { companyId } })).toBe(0);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { paymentTerms: true, orderingEnabledAt: true },
    });
    expect(company.paymentTerms).toBeNull();
    expect(company.orderingEnabledAt).toBeNull();

    await cleanupCompany(companyId);
  });

  it("saves a draft without enabling ordering", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Draft ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `draft-${local}@example.invalid`,
    });
    const companyId = created.companyId;

    const draft = await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "45 DAYS",
      creditLimitReviewed: false,
      contacts: [
        {
          firstName: "Drew",
          lastName: "Draft",
          email: `drew-${local}@example.invalid`,
          isPrimary: true,
        },
      ],
      addresses: [],
      enableOrdering: false,
    });

    expect(draft.mode).toBe("draft");
    expect(draft.message).toBe("Draft saved — ordering not enabled");
    expect(draft.orderingEnabled).toBe(false);
    expect(draft.salesReadiness.orderingApproved).toBe(false);
    expect(draft.salesReadiness.canCreateStaffOrder).toBe(false);
    expect(await prisma.contact.count({ where: { companyId } })).toBe(1);

    await cleanupCompany(companyId);
  });

  it("rejects concurrent edits when expectedUpdatedAt does not match", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Concurrent ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `concurrent-${local}@example.invalid`,
    });
    const companyId = created.companyId;
    const setup = await getCustomerSetup(adminId, companyId);

    await prisma.company.update({
      where: { id: companyId },
      data: { phone: "01139998877" },
    });

    await expect(
      saveCustomerSetupAndEnableOrdering(adminId, {
        companyId,
        paymentTerms: "30 DAYS",
        creditLimitReviewed: false,
        contacts: [],
        addresses: [],
        enableOrdering: false,
        expectedUpdatedAt: setup.company.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await cleanupCompany(companyId);
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
    await cleanupCompany(company.id);
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
      orderingApproved: false,
      readyForSales: false,
    });
    await cleanupCompany(company.id);
  });

  it("does not grandfather a post-rollout customer just because an order exists", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: {
        name: `New With Order ${local}`,
        status: "ACTIVE",
        createdAt: new Date("2026-11-10T12:00:00.000Z"),
      },
    });
    await prisma.order.create({
      data: {
        companyId: company.id,
        orderNumber: `POST-ROLL-${local}`,
        status: "DRAFT",
        currency: "GBP",
        subtotal: 0,
        vatTotal: 0,
        grandTotal: 0,
        placedAt: new Date("2026-11-10T13:00:00.000Z"),
        createdAt: new Date("2026-11-10T13:00:00.000Z"),
      },
    });
    await expect(assertCompanyReadyForStaffOrders(company.id)).rejects.toBeInstanceOf(AuthError);
    const readiness = await getCustomerSetup(adminId, company.id);
    expect(readiness.salesReadiness.legacyEligible).toBe(false);
    expect(readiness.salesReadiness.canCreateStaffOrder).toBe(false);
    await cleanupCompany(company.id);
  });

  it("blocks new orders when an approved customer later loses live requirements", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Approved Then Broken ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `broken-${local}@example.invalid`,
    });
    const companyId = created.companyId;
    const code = `BR${local.slice(-8).toUpperCase()}`;

    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      confirmAccount: code,
      reason: "Zero history for approved-then-broken regression.",
    });
    await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimitReviewed: true,
      contacts: [
        {
          firstName: "Ann",
          lastName: "Approved",
          email: `ann-${local}@example.invalid`,
          isPrimary: true,
        },
      ],
      addresses: [
        {
          type: "TRADING",
          line1: "2 Ready Road",
          town: "Leeds",
          postcode: "LS2 2BB",
          country: "GB",
          isDefaultBilling: true,
          isDefaultDelivery: true,
        },
      ],
      enableOrdering: true,
    });

    await expect(assertCompanyReadyForStaffOrders(companyId)).resolves.toMatchObject({
      readyForSales: true,
    });

    await prisma.contact.deleteMany({ where: { companyId } });
    await expect(assertCompanyReadyForStaffOrders(companyId)).rejects.toBeInstanceOf(AuthError);
    const after = await getCustomerSetup(adminId, companyId);
    expect(after.salesReadiness.orderingApproved).toBe(true);
    expect(after.salesReadiness.setupRequirementsComplete).toBe(false);
    expect(after.salesReadiness.canCreateStaffOrder).toBe(false);

    await cleanupCompany(companyId);
  });

  it("requires approval stamp even when the checklist is already complete", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: `Checklist Only ${local}`,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `checklist-${local}@example.invalid`,
    });
    const companyId = created.companyId;
    const code = `CL${local.slice(-8).toUpperCase()}`;

    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      confirmAccount: code,
      reason: "Checklist complete without approval stamp.",
    });
    await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimitReviewed: true,
      contacts: [
        {
          firstName: "Chris",
          lastName: "Check",
          email: `chris-${local}@example.invalid`,
          isPrimary: true,
        },
      ],
      addresses: [
        {
          type: "TRADING",
          line1: "3 Checklist Close",
          town: "Leeds",
          postcode: "LS3 3CC",
          country: "GB",
          isDefaultBilling: true,
          isDefaultDelivery: true,
        },
      ],
      enableOrdering: false,
    });

    const setup = await getCustomerSetup(adminId, companyId);
    expect(setup.salesReadiness.setupRequirementsComplete).toBe(true);
    expect(setup.salesReadiness.orderingApproved).toBe(false);
    expect(setup.salesReadiness.readyForSales).toBe(false);
    expect(setup.salesReadiness.canCreateStaffOrder).toBe(false);
    await expect(assertCompanyReadyForStaffOrders(companyId)).rejects.toBeInstanceOf(AuthError);

    await cleanupCompany(companyId);
  });

  it("saves billing and delivery company names and does not replace a saved name", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const registered = `Branch Co ${local}`;
    const created = await saveCustomerCreationDetails(adminId, {
      name: registered,
      status: "PROSPECT",
      taxStatus: "STANDARD",
      primaryEmail: `branch-${local}@example.invalid`,
      phone: "01130000002",
      customerType: "Motor Factor",
    });
    const companyId = created.companyId;
    const code = `BR${local.slice(-8).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code });
    await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId,
      confirmAccount: code,
      reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
    });

    const saved = await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimit: null,
      creditLimitReviewed: true,
      contacts: [
        {
          firstName: "Sam",
          lastName: "Buyer",
          email: `buyer-branch-${local}@example.invalid`,
          phone: "01130000003",
          isPrimary: true,
          isPurchasing: true,
        },
      ],
      addresses: [
        {
          type: "BILLING",
          label: "Accounts",
          line1: "1 Billing Street",
          town: "Leeds",
          postcode: "LS1 1BB",
          country: "GB",
          companyName: registered,
          isDefaultBilling: true,
          contactName: "Accounts Team",
        },
        {
          type: "DELIVERY",
          label: "Leeds warehouse",
          line1: "2 Warehouse Road",
          town: "Leeds",
          postcode: "LS2 2WW",
          country: "GB",
          companyName: "Leeds Depot Ltd",
          isDefaultDelivery: true,
          contactName: "Goods In",
        },
        {
          type: "DELIVERY",
          label: "Manchester warehouse",
          line1: "3 Depot Lane",
          town: "Manchester",
          postcode: "M1 1DD",
          country: "GB",
          isDefaultDelivery: false,
          contactName: "Night Gate",
        },
      ],
      enableOrdering: true,
    });
    expect(saved.salesReadiness.readyForSales).toBe(true);

    const stored = await prisma.address.findMany({
      where: { companyId },
      orderBy: { line1: "asc" },
    });
    expect(stored.map((row) => [row.line1, row.companyName, row.contactName])).toEqual([
      ["1 Billing Street", registered, "Accounts Team"],
      ["2 Warehouse Road", "Leeds Depot Ltd", "Goods In"],
      ["3 Depot Lane", null, "Night Gate"],
    ]);

    const reloaded = await getCustomerSetup(adminId, companyId);
    const warehouse = reloaded.addresses.find((row) => row.line1 === "2 Warehouse Road");
    expect(warehouse?.companyName).toBe("Leeds Depot Ltd");
    expect(warehouse?.contactName).toBe("Goods In");

    await saveCustomerSetupAndEnableOrdering(adminId, {
      companyId,
      paymentTerms: "30 DAYS",
      creditLimit: null,
      creditLimitReviewed: true,
      contacts: [
        {
          firstName: "Sam",
          lastName: "Buyer",
          email: `buyer-branch-${local}@example.invalid`,
          phone: "01130000003",
          isPrimary: true,
          isPurchasing: true,
        },
      ],
      addresses: stored.map((row) => ({
        id: row.id,
        type: row.type,
        label: row.label,
        line1: row.line1,
        town: row.town,
        postcode: row.postcode,
        country: row.country,
        isDefaultBilling: row.isDefaultBilling,
        isDefaultDelivery: row.isDefaultDelivery,
        contactName: row.contactName,
      })),
      enableOrdering: true,
    });
    const preserved = await prisma.address.findMany({
      where: { companyId },
      orderBy: { line1: "asc" },
    });
    expect(preserved.map((row) => row.companyName)).toEqual([
      registered,
      "Leeds Depot Ltd",
      null,
    ]);

    await cleanupCompany(companyId);
  });
});
