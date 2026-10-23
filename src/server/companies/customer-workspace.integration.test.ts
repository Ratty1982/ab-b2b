/**
 * Customer workspace: status, contacts, portal membership, and company-scoped registers.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { prisma } from "@/infra/database/client";
import { updateCompany, updateContact, createContact, updateCompanyMembership } from "@/server/companies/service";
import {
  listCompanyDocuments,
  listCompanyInvoices,
  listCompanyOrders,
  listCompanyQuotes,
  listPortalInvoices,
} from "@/server/companies/customer-workspace-records";
import { requireCompanyPermission } from "@/server/rbac/guards";
import { AuthError } from "@/server/rbac/guards";

const stamp = Date.now();

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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer workspace", () => {
  it("activates a prospect without inviting users or importing sales", async () => {
    const adminId = await ensureUser(`workspace.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const strangerId = await ensureUser(`workspace.stranger.${stamp}@example.invalid`, []);
    const company = await prisma.company.create({
      data: { name: `Prospect ${stamp}`, status: "PROSPECT" },
    });
    await expect(updateCompany(strangerId, { id: company.id, status: "ACTIVE" })).rejects.toBeInstanceOf(AuthError);
    const updated = await updateCompany(adminId, { id: company.id, status: "ACTIVE" });
    expect(updated.status).toBe("ACTIVE");
    expect(await prisma.companyUser.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.userInvitation.count({ where: { companyId: company.id } })).toBe(0);
    const activity = await prisma.activity.findFirst({
      where: { companyId: company.id, subject: "Company updated" },
    });
    expect(activity?.body).toMatch(/ACTIVE/);
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: company.id, action: "company.status_changed" },
    });
    expect(audit).toBeTruthy();
    const suspended = await updateCompany(adminId, { id: company.id, status: "SUSPENDED" });
    expect(suspended.status).toBe("SUSPENDED");
  });

  it("edits a contact in place and keeps a single primary", async () => {
    const adminId = await ensureUser(`workspace.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const company = await prisma.company.create({ data: { name: `Contacts ${stamp}`, status: "ACTIVE" } });
    const first = await createContact(adminId, {
      companyId: company.id,
      firstName: "Ada",
      lastName: "One",
      email: `ada.${stamp}@example.invalid`,
      isPrimary: true,
    });
    const second = await createContact(adminId, {
      companyId: company.id,
      firstName: "Bea",
      lastName: "Two",
      isPrimary: false,
    });
    const saved = await updateContact(adminId, {
      id: second.id,
      companyId: company.id,
      firstName: "Bea",
      lastName: "Updated",
      phone: "0121",
      mobile: "0700",
      jobTitle: "Buyer",
      notes: "Prefers email",
      isPrimary: true,
      isPurchasing: true,
      isAccounts: false,
    });
    expect(saved.id).toBe(second.id);
    expect(saved.lastName).toBe("Updated");
    expect(await prisma.contact.count({ where: { companyId: company.id } })).toBe(2);
    const primary = await prisma.contact.findMany({ where: { companyId: company.id, isPrimary: true } });
    expect(primary.map((row) => row.id)).toEqual([second.id]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: first.id } })).isPrimary).toBe(false);
    const other = await prisma.company.create({ data: { name: `Other contacts ${stamp}`, status: "ACTIVE" } });
    await expect(
      updateContact(adminId, { id: second.id, companyId: other.id, firstName: "Nope", lastName: "Nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("changes one company membership and leaves the other company alone", async () => {
    const adminId = await ensureUser(`workspace.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const person = await prisma.user.create({
      data: {
        email: `portal.person.${stamp}@example.invalid`,
        name: "Portal Person",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    });
    const companyA = await prisma.company.create({ data: { name: `Portal A ${stamp}`, status: "ACTIVE" } });
    const companyB = await prisma.company.create({ data: { name: `Portal B ${stamp}`, status: "ACTIVE" } });
    const membershipA = await prisma.companyUser.create({
      data: { companyId: companyA.id, userId: person.id, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });
    const membershipB = await prisma.companyUser.create({
      data: { companyId: companyB.id, userId: person.id, role: "TRADE_BUYER", status: "ACTIVE" },
    });
    const updated = await updateCompanyMembership(adminId, {
      companyId: companyA.id,
      membershipId: membershipA.id,
      role: "TRADE_ACCOUNTS",
      status: "DISABLED",
    });
    expect(updated.role).toBe("TRADE_ACCOUNTS");
    expect(updated.status).toBe("DISABLED");
    const freshPerson = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(freshPerson.email).toBe(person.email);
    expect(freshPerson.name).toBe("Portal Person");
    const stillB = await prisma.companyUser.findUniqueOrThrow({ where: { id: membershipB.id } });
    expect(stillB.role).toBe("TRADE_BUYER");
    expect(stillB.status).toBe("ACTIVE");
    await expect(requireCompanyPermission(person.id, companyA.id, "orders.view")).rejects.toBeInstanceOf(AuthError);
    await expect(requireCompanyPermission(person.id, companyB.id, "orders.view")).resolves.toBeTruthy();
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: membershipA.id, action: "company.user_membership_updated" },
    });
    expect(audit).toBeTruthy();
    await expect(
      updateCompanyMembership(adminId, {
        companyId: companyB.id,
        membershipId: membershipA.id,
        role: "TRADE_ADMIN",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists only the selected customer's orders, quotes, invoices, and documents", async () => {
    const adminId = await ensureUser(`workspace.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
    const company = await prisma.company.create({
      data: { name: `Register ${stamp}`, status: "ACTIVE", autopartCustomerCode: `REG${stamp}`, autopartCustomerCodeVerifiedAt: new Date() },
    });
    const other = await prisma.company.create({ data: { name: `Register other ${stamp}`, status: "ACTIVE" } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-9${String(stamp).slice(-5)}`,
        companyId: company.id,
        status: "CONFIRMED",
        subtotal: 10,
        vatTotal: 2,
        grandTotal: 12,
        placedAt: new Date(),
        entrySource: "TELEPHONE",
        autopartExportStatus: "EXPORTED",
        externalRef: null,
        items: { create: [{ sku: "REGSKU", name: "Widget", qty: 2, unitPrice: 5, customerUnitPrice: 5, vatRate: 20, lineTotal: 10, lineVat: 2, lineGross: 12 }] },
      },
    });
    await prisma.order.create({
      data: {
        orderNumber: `AB-8${String(stamp).slice(-5)}`,
        companyId: other.id,
        status: "CONFIRMED",
        subtotal: 1,
        vatTotal: 0,
        grandTotal: 1,
        placedAt: new Date(),
        items: { create: [{ sku: "OTHER", name: "Other", qty: 1, unitPrice: 1, customerUnitPrice: 1, vatRate: 0, lineTotal: 1, lineVat: 0, lineGross: 1 }] },
      },
    });
    const quote = await prisma.quote.create({
      data: {
        quoteNumber: `QT-WS-${stamp}`,
        companyId: company.id,
        status: "SENT",
        subtotal: 10,
        vatTotal: 2,
        grandTotal: 12,
        createdById: adminId,
        convertedOrderId: order.id,
      },
    });
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-WS-${stamp}`,
        companyId: company.id,
        orderId: order.id,
        status: "ISSUED",
        subtotal: 10,
        vatTotal: 2,
        grandTotal: 12,
        issuedAt: new Date(),
        externalRef: `DOC-${stamp}`,
      },
    });
    await prisma.autopartSalesDocument.create({
      data: {
        companyId: company.id,
        autopartCustomerCode: `REG${stamp}`,
        documentType: "INVOICE",
        documentReference: `DOC-${stamp}`,
        documentDate: new Date(),
        goodsNet: 10,
        grossTotal: 12,
        source: "ONGOING_504",
        abOrderId: order.id,
      },
    });
    await prisma.autopartSalesDocument.create({
      data: {
        companyId: company.id,
        autopartCustomerCode: `REG${stamp}`,
        documentType: "CREDIT",
        documentReference: `CR-${stamp}`,
        documentDate: new Date(),
        goodsNet: -2,
        grossTotal: -2.4,
        source: "SLRB",
      },
    });
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-OTHER-${stamp}`,
        companyId: other.id,
        status: "ISSUED",
        subtotal: 1,
        vatTotal: 0,
        grandTotal: 1,
        externalRef: `OTHER-${stamp}`,
      },
    });

    const orders = await listCompanyOrders(adminId, { companyId: company.id, page: 1, pageSize: 25 });
    expect(orders.total).toBe(1);
    expect(orders.items[0]?.orderNumber).toBe(order.orderNumber);
    expect(orders.items[0]?.lineCount).toBe(1);
    expect(orders.items[0]?.invoiceCount).toBe(1);
    expect(orders.items.map((row) => row.orderNumber)).not.toContain(`AB-8${String(stamp).slice(-5)}`);

    const quotes = await listCompanyQuotes(adminId, { companyId: company.id });
    expect(quotes.total).toBe(1);
    expect(quotes.items[0]?.quoteNumber).toBe(quote.quoteNumber);
    expect(quotes.items[0]?.orderNumber).toBe(order.orderNumber);

    const invoices = await listCompanyInvoices(adminId, { companyId: company.id });
    const numbers = invoices.items.map((row) => row.number).sort();
    expect(numbers).toEqual([`CR-${stamp}`, `INV-WS-${stamp}`]);
    expect(invoices.items.find((row) => row.number === `INV-WS-${stamp}`)?.origin).toBe("B2B invoice");
    expect(invoices.items.find((row) => row.number === `CR-${stamp}`)?.origin).toBe("Autopart credit");
    expect(invoices.items.every((row) => row.downloadable === false)).toBe(true);
    expect(invoices.items.some((row) => row.number === `OTHER-${stamp}` || row.number === `INV-OTHER-${stamp}`)).toBe(false);

    const documents = await listCompanyDocuments(adminId, { companyId: company.id });
    const titles = documents.items.map((row) => row.title);
    expect(titles).toContain(order.orderNumber);
    expect(titles).toContain(quote.quoteNumber);
    expect(titles).toContain(`INV-WS-${stamp}`);
    expect(titles).toContain(`CR-${stamp}`);
    expect(titles).not.toContain(`DOC-${stamp}`);
    expect(documents.items.every((row) => row.downloadable === false)).toBe(true);

    const buyer = await prisma.user.create({
      data: {
        email: `portal.accounts.${stamp}@example.invalid`,
        name: "Accounts",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    });
    await prisma.companyUser.create({
      data: { companyId: company.id, userId: buyer.id, role: "TRADE_ACCOUNTS", status: "ACTIVE", isDefault: true },
    });
    const portal = await listPortalInvoices(buyer.id, { page: 1 });
    expect(portal.items.map((row) => row.number).sort()).toEqual([`CR-${stamp}`, `INV-WS-${stamp}`]);
    const plainBuyer = await prisma.user.create({
      data: {
        email: `portal.buyer.${stamp}@example.invalid`,
        name: "Buyer",
        status: "ACTIVE",
        actorType: "TRADE",
        emailVerified: true,
      },
    });
    await prisma.companyUser.create({
      data: { companyId: company.id, userId: plainBuyer.id, role: "TRADE_BUYER", status: "ACTIVE" },
    });
    await expect(listPortalInvoices(plainBuyer.id, {})).rejects.toBeInstanceOf(AuthError);
  });
});
