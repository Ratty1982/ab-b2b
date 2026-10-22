import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  confirmCustomerSalesImport,
  previewCustomerSalesImport,
} from "@/server/companies/customer-sales-import";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let adminId = "";
let companyId = "";
let otherCompanyId = "";
let account = "";
let otherAccount = "";
let orderNumber = "";
let otherOrderNumber = "";
let orderId = "";

async function ensureUser(email: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Customer sales importer",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  return user.id;
}

async function uniqueOrderNumber() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
    const candidate = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate an order number");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`customer-sales.${stamp}@example.invalid`);
  account = `CS${stamp.slice(0, 8).toUpperCase()}`;
  otherAccount = `CX${stamp.slice(0, 8).toUpperCase()}`;
  const company = await prisma.company.create({
    data: { name: `Customer Sales ${stamp}`, status: "ACTIVE" },
  });
  const other = await prisma.company.create({
    data: { name: `Other Sales ${stamp}`, status: "ACTIVE" },
  });
  companyId = company.id;
  otherCompanyId = other.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: otherCompanyId, code: otherAccount });
  await prisma.autopartCustomerAccountAlias.create({
    data: { companyId, alias: `AL${stamp.slice(0, 8).toUpperCase()}`, verifiedById: adminId },
  });
  orderNumber = await uniqueOrderNumber();
  otherOrderNumber = await uniqueOrderNumber();
  const order = await prisma.order.create({
    data: {
      companyId,
      orderNumber,
      status: "CONFIRMED",
      subtotal: "10.00",
      vatTotal: "2.00",
      grandTotal: "12.00",
      deliveryAddress: { line1: "1 Test Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Buyer", email: "buyer@example.invalid", phone: "01130000000" },
    },
  });
  orderId = order.id;
  await prisma.order.create({
    data: {
      companyId: otherCompanyId,
      orderNumber: otherOrderNumber,
      status: "CONFIRMED",
      subtotal: "5.00",
      vatTotal: "1.00",
      grandTotal: "6.00",
      deliveryAddress: { line1: "2 Test Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
      contactSnapshot: { name: "Other", email: "other@example.invalid", phone: "01130000001" },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer-specific sales import", () => {
  it("imports only the selected account and does not fulfil, move stock, or email", async () => {
    const doc = `SS${stamp.slice(0, 8).toUpperCase()}`;
    const otherDoc = `SX${stamp.slice(0, 8).toUpperCase()}`;
    const trm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${doc},29/09/2026,PART-${stamp.slice(0, 6)},Widget,2,10.00,4.00,6.00,60.000
${otherAccount},GRP,${otherDoc},29/09/2026,PART-${stamp.slice(0, 6)},Other,1,5.00,2.00,3.00,60.000
`;
    const report504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${doc},29/09/2026,13:05,CUSTOMER SALES,10.00,2.00,12.00,WR,${orderNumber}
ACCOUNT,${otherDoc},29/09/2026,13:06,OTHER SALES,5.00,1.00,6.00,WR,${otherOrderNumber}
`;
    const reservationsBefore = await prisma.orderStockReservation.count();
    const emailsBefore = await prisma.transactionalEmail.count();

    const preview = await previewCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: trm,
      filename: "TRM21QC.csv",
    });
    expect(preview.kind).toBe("TRM21QC");
    expect(preview.counts.import).toBe(1);
    expect(preview.counts.rejected).toBe(1);
    expect(preview.canCommit).toBe(true);

    const imported = await confirmCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: trm,
      filename: "TRM21QC.csv",
    });
    expect(imported.rowsImported).toBe(1);
    const mine = await prisma.autopartSalesLine.findMany({ where: { documentReference: doc } });
    const theirs = await prisma.autopartSalesLine.findMany({ where: { documentReference: otherDoc } });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.companyId).toBe(companyId);
    expect(mine[0]?.documentType).toBe("INVOICE");
    expect(theirs).toHaveLength(0);

    const again = await confirmCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: trm,
      filename: "TRM21QC.csv",
    });
    expect(again.rowsImported).toBe(0);
    expect(await prisma.autopartSalesLine.count({ where: { documentReference: doc } })).toBe(1);

    const headerPreview = await previewCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: report504,
      filename: "504.csv",
    });
    expect(headerPreview.counts.import + headerPreview.counts.update).toBe(1);
    expect(headerPreview.counts.rejected).toBe(1);
    await confirmCustomerSalesImport(adminId, {
      companyId,
      accountCode: account,
      text: report504,
      filename: "504.csv",
    });
    const header = await prisma.autopartSalesDocument.findFirst({ where: { documentReference: doc, companyId } });
    const otherHeader = await prisma.autopartSalesDocument.findFirst({ where: { documentReference: otherDoc } });
    expect(header?.companyId).toBe(companyId);
    expect(header?.has504).toBe(true);
    expect(header?.fulfilmentStatus).toBeNull();
    expect(otherHeader).toBeNull();

    await expect(
      previewCustomerSalesImport(adminId, {
        companyId,
        accountCode: account,
        text: "CUSTOMER SALES FOR PART NUMBERS BY INVOICE LINE (561L)\n",
        filename: "561L.txt",
      }),
    ).resolves.toMatchObject({ canCommit: false, kind: "HISTORICAL_561L_SLRB" });
    await expect(
      confirmCustomerSalesImport(adminId, {
        companyId,
        accountCode: otherAccount,
        text: trm,
        filename: "TRM21QC.csv",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("CONFIRMED");
    expect(await prisma.orderStockReservation.count()).toBe(reservationsBefore);
    expect(await prisma.transactionalEmail.count()).toBe(emailsBefore);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "autopart.customer_sales_import_committed", entityId: imported.runId },
    });
    expect(audit?.metadata).toMatchObject({ companyId, accountCode: account, kind: "TRM21QC" });
  });
});
