/**
 * Ongoing Autopart 504 + TRM21QC import / reconciliation / SI integration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { loadHistoricSalesLines, summarizeHistoricLines } from "@/server/sales-intelligence/historic-lines";

const prisma = new PrismaClient();

let adminId = "";
let companyId = "";
let account = "";
let orderNumber = "";
let orderId = "";
const stamp = Date.now();
const skuA = `SKU-OG-A-${String(stamp).slice(-6)}`;
const skuB = `SKU-OG-B-${String(stamp).slice(-6)}`;
const skuC = `SKU-OG-C-${String(stamp).slice(-6)}`;
const docInv = `SSOG${String(stamp).slice(-6)}`;
const docCr = `SCOG${String(stamp).slice(-6)}`;
const docMam = `SSOM${String(stamp).slice(-6)}`;
const docWait = `SSOW${String(stamp).slice(-6)}`;

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

async function uniqueAbOrderNumber(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
    const orderNumber = `AB-${n}`;
    const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw new Error("Could not allocate AB order number");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`og-sales.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  account = `OG${String(stamp).slice(-8)}`;

  const company = await prisma.company.create({
    data: {
      name: `Ongoing Sales Co ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId,
    code: account,
  });

  const brand = await prisma.brand.create({
    data: { name: `OG Brand ${stamp}`, slug: `og-brand-${stamp}` },
  });
  const category = await prisma.category.create({
    data: { name: `OG Cat ${stamp}`, slug: `og-cat-${stamp}` },
  });
  for (const [sku, name] of [
    [skuA, "Widget A"],
    [skuB, "Widget B"],
  ] as const) {
    const product = await prisma.product.create({
      data: {
        name: `${name} ${stamp}`,
        slug: `og-${sku.toLowerCase()}`,
        brandId: brand.id,
        categoryId: category.id,
        status: "ACTIVE",
        isActive: true,
        isTradeVisible: true,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku,
        isActive: true,
        tradePrice: 10,
      },
    });
  }

  orderNumber = await uniqueAbOrderNumber();
  const order = await prisma.order.create({
    data: {
      companyId,
      orderNumber,
      status: "CONFIRMED",
      subtotal: "303.00",
      vatTotal: "60.60",
      deliveryTotal: "0.00",
      grandTotal: "363.60",
      placedAt: new Date("2026-09-29T12:00:00.000Z"),
      autopartExportStatus: "EXPORTED",
      autopartAccountLinked: true,
      autopartCustomerCodeSnapshot: account,
      deliveryAddress: {
        line1: "1 Test Street",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
      },
      contactSnapshot: { name: "Buyer", email: `buyer-${stamp}@example.test`, phone: "01130000000" },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function sample504(opts?: { creditOnly?: boolean }) {
  if (opts?.creditOnly) {
    return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docCr},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${orderNumber}
`;
  }
  return `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docInv},29/09/2026,13:05,EXAMPLE MOTOR FACTORS,303.00,60.60,363.60,WR,${orderNumber}
ACCOUNT,${docCr},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${orderNumber}
ACCOUNT,${docMam},29/09/2026,15:00,DIRECT MAM CUST,50.00,10.00,60.00,DM,MAM-ONLY-1
`;
}

function sampleTrm() {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${docInv},29/09/2026,${skuA},Widget A,2,200.00,100.00,100.00,50.000
${account},GRP,${docInv},29/09/2026,${skuB},Widget B,1,103.00,50.00,53.00,51.456
${account},GRP,${docCr},29/09/2026,${skuA},Widget A,-1,-33.33,16.00,-17.33,-108.312
${account},GRP,${docMam},29/09/2026,${skuC},Unknown Part,1,50.00,20.00,30.00,60.000
`;
}

describe("ongoing 504 + TRM21QC", () => {
  it("imports 504 then TRM21QC and reconciles NET goods to line sales", async () => {
    const run504 = await confirmAutopart504Import(adminId, {
      text: sample504(),
      filename: "504.csv",
      source: "MANUAL",
    });
    expect(run504.status).toBe("COMMITTED");

    const invoice = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docInv },
    });
    expect(invoice?.has504).toBe(true);
    expect(Number(invoice?.goodsNet)).toBe(303);
    expect(invoice?.abOrderNumber).toBe(orderNumber);
    expect(invoice?.reconciliationStatus).toBe("AWAITING_LINES");

    const credit = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docCr },
    });
    expect(credit?.documentType).toBe("CREDIT");
    expect(Number(credit?.goodsNet)).toBeCloseTo(-33.33, 2);

    const runTrm = await confirmAutopartTrm21qcImport(adminId, {
      text: sampleTrm(),
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(runTrm.status).toBe("COMMITTED");

    const invoiceAfter = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docInv },
      include: { lines: true },
    });
    expect(invoiceAfter?.hasTrm21qc).toBe(true);
    expect(invoiceAfter?.lines).toHaveLength(2);
    expect(["MATCHED", "COMPLETE"]).toContain(invoiceAfter?.reconciliationStatus);

    const creditAfter = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docCr },
      include: { lines: true },
    });
    expect(Number(creditAfter?.lines[0]?.units)).toBe(-1);
    expect(Number(creditAfter?.lines[0]?.salesNet)).toBeCloseTo(-33.33, 2);
    expect(["MATCHED", "COMPLETE"]).toContain(creditAfter?.reconciliationStatus);

    // Idempotent overlap re-import
    const again = await confirmAutopart504Import(adminId, {
      text: sample504(),
      filename: "504-overlap.csv",
      source: "MANUAL",
    });
    expect(again.status).toBe("COMMITTED");
    const docs = await prisma.autopartSalesDocument.count({
      where: { documentReference: { in: [docInv, docCr, docMam] } },
    });
    expect(docs).toBe(3);

    const lines = await loadHistoricSalesLines({
      companyId,
      range: { from: "2026-09-01", to: "2026-09-30" },
    });
    const totals = summarizeHistoricLines(lines);
    // 303 + 50 - 33.33 = 319.67 — VAT excluded; Money scale is 4dp.
    expect(totals.netSalesMinor).toBe(3_196_700n);
    const creditLines = lines.filter((l) => l.documentType === "CREDIT");
    expect(creditLines.length).toBeGreaterThan(0);

    const unknown = await prisma.autopartSalesLine.findFirst({
      where: { documentReference: docMam, sku: skuC },
    });
    expect(unknown?.matchStatus).toBe("NOT_IN_AB_CATALOGUE");
  });

  it("credit-only 504 does not despatch the AB order", async () => {
    // Reset order to CONFIRMED for credit-only path using a fresh order
    const creditOrderNumber = await uniqueAbOrderNumber();
    const creditOrder = await prisma.order.create({
      data: {
        companyId,
        orderNumber: creditOrderNumber,
        status: "CONFIRMED",
        subtotal: "33.33",
        vatTotal: "6.66",
        deliveryTotal: "0.00",
        grandTotal: "39.99",
        placedAt: new Date("2026-09-29T12:00:00.000Z"),
        autopartExportStatus: "EXPORTED",
        autopartAccountLinked: true,
        autopartCustomerCodeSnapshot: account,
        deliveryAddress: {
          line1: "1 Test Street",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        contactSnapshot: { name: "Buyer", email: `cr-${stamp}@example.test`, phone: "01130000000" },
      },
    });
    const creditDoc = `SCCRED${String(stamp).slice(-5)}`;
    const text = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${creditDoc},29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,${creditOrderNumber}
`;
    await confirmAutopart504Import(adminId, {
      text,
      filename: "504-credit-only.csv",
      source: "MANUAL",
    });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: creditOrder.id } });
    expect(after.status).not.toBe("DISPATCHED");
    expect(after.status).toBe("CONFIRMED");

    const inv = await prisma.invoice.findFirst({ where: { externalRef: creditDoc } });
    expect(inv?.autopartDocumentKind).toBe("CREDIT");
  });

  it("awaits companion report without failing", async () => {
    const only504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,${docWait},29/09/2026,13:00,EXAMPLE,10.00,2.00,12.00,WR,NONE
`;
    await confirmAutopart504Import(adminId, {
      text: only504,
      filename: "504-wait.csv",
      source: "MANUAL",
    });
    const doc = await prisma.autopartSalesDocument.findFirst({
      where: { documentReference: docWait },
    });
    expect(doc?.reconciliationStatus).toBe("AWAITING_LINES");
  });
});
