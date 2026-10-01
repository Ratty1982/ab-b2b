/**
 * RETAILA-scale historic-only SKU regression: SSAMZ vs SSAMZ-1, including
 * Autopart Inv & Ln forms that omit the source line number (I/OIN…/).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { confirmAutopartHistoryImport } from "@/server/companies/autopart-history";
import {
  getProductSalesEnquiry,
  searchSalesIntelligenceProducts,
} from "@/server/sales-intelligence/enquiry";

const prisma = new PrismaClient();
const stamp = Date.now();
const account = `RA${String(stamp).slice(-8)}`;
/** Unique per run so product-first SI enquiry does not pick up leftover SKUs from prior suites. */
const skuBase = `SSAMZ${String(stamp).slice(-5)}`;
const skuListing = `${skuBase}-1`;
let adminId = "";
let companyId = "";

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

const file561 = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account},I/OIN022047/,${skuListing},Steel Seal Amazon LISTIN,1,31.24
${account},I/SS303694/1,${skuListing},Steel Seal Amazon LISTIN,1,37.49
${account},I/OIN022048/,${skuBase},Steel Seal Amazon LISTIN,2,62.48
${account},I/SS303695/1,${skuBase},Steel Seal Amazon LISTIN,1,40.00
${account},I/OIN022049/,${skuBase},Steel Seal Amazon LISTIN,1,20.00
`;

const fileSlrb = `A/C,Name,Sacct,Type,Ref,Date,Goods,VAT,Value,Run Bal
${account},RETAIL AMAZON,,INV,OIN022047,01 Oct 26,31.24,6.25,37.49,0
${account},RETAIL AMAZON,,INV,SS303694,01 Oct 26,37.49,7.50,44.99,0
${account},RETAIL AMAZON,,INV,OIN022048,01 Oct 26,62.48,12.50,74.98,0
${account},RETAIL AMAZON,,INV,SS303695,01 Oct 26,40.00,8.00,48.00,0
${account},RETAIL AMAZON,,INV,OIN022049,01 Oct 26,20.00,4.00,24.00,0
`;

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`ssamz.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  const company = await prisma.company.create({
    data: {
      name: `RETAILA SSAMZ ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId, code: account });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RETAILA SSAMZ / SSAMZ-1 historic import + SI", () => {
  it("imports OIN Inv & Ln rows and keeps base SKU distinct from hyphenated listing SKU", async () => {
    const result = await confirmAutopartHistoryImport(adminId, {
      companyId,
      file561l: file561,
      fileSlrb,
      filename561l: "561L-RETAILA.CSV",
      filenameSlrb: "SLRB-RETAILA.CSV",
    });
    expect(result.lineCount).toBe(5);
    expect(result.documentCount).toBe(5);
    expect(result.imported).toBeGreaterThanOrEqual(5);

    const bySku = await prisma.$queryRawUnsafe<
      Array<{ sku: string; n: number; units: string; sales: string }>
    >(
      `SELECT sku, COUNT(*)::int as n, SUM(units)::text as units, SUM("salesNet")::text as sales
       FROM "AutopartSalesLine"
       WHERE "companyId" = $1 AND sku IN ($2, $3)
       GROUP BY sku
       ORDER BY sku`,
      companyId,
      skuBase,
      skuListing,
    );
    expect(bySku).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: skuBase, n: 3 }),
        expect.objectContaining({ sku: skuListing, n: 2 }),
      ]),
    );

    const ssamz = bySku.find((r) => r.sku === skuBase)!;
    const ssamz1 = bySku.find((r) => r.sku === skuListing)!;
    expect(Number(ssamz.units)).toBeCloseTo(4, 3); // 2 + 1 + 1
    expect(Number(ssamz.sales)).toBeCloseTo(122.48, 2);
    expect(Number(ssamz1.units)).toBeCloseTo(2, 3);
    expect(Number(ssamz1.sales)).toBeCloseTo(68.73, 2);

    // OIN rows got assigned line numbers (not skipped)
    const oin = await prisma.autopartSalesLine.findMany({
      where: { companyId, documentReference: { in: ["OIN022047", "OIN022048", "OIN022049"] } },
      select: { documentReference: true, lineNumber: true, sku: true, matchStatus: true },
      orderBy: { documentReference: "asc" },
    });
    expect(oin).toHaveLength(3);
    expect(oin.every((r) => r.lineNumber >= 1)).toBe(true);
    expect(oin.every((r) => r.matchStatus === "NOT_IN_AB_CATALOGUE")).toBe(true);

    // Exact SKU identity — never strip hyphen / merge listing into base
    expect(await prisma.autopartSalesLine.count({ where: { companyId, sku: skuBase } })).toBe(3);
    expect(await prisma.autopartSalesLine.count({ where: { companyId, sku: skuListing } })).toBe(2);
  });

  it("Sales Intelligence retrieves base and hyphenated listing SKUs independently (historic-only)", async () => {
    const search = await searchSalesIntelligenceProducts(adminId, { q: skuBase });
    expect(search.items.some((i) => i.sku === skuBase && !i.inCatalogue)).toBe(true);
    expect(search.items.some((i) => i.sku === skuListing && !i.inCatalogue)).toBe(true);

    const a = await getProductSalesEnquiry(adminId, {
      sku: skuBase,
      period: "CUSTOM",
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(Number(a.summary.netSales)).toBeCloseTo(122.48, 2);
    expect(a.summary.units).toBeCloseTo(4, 3);

    const b = await getProductSalesEnquiry(adminId, {
      sku: skuListing,
      period: "CUSTOM",
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(Number(b.summary.netSales)).toBeCloseTo(68.73, 2);
    expect(b.summary.units).toBeCloseTo(2, 3);

    // Cross-check: product enquiry must not bleed the other SKU's sales
    expect(Number(a.summary.netSales)).not.toBeCloseTo(Number(b.summary.netSales), 2);
  });
});

describe("RETAILA repeated Inv & Ln line numbers (SSAMZ collision)", () => {
  const stamp2 = stamp + 1;
  const account2 = `RB${String(stamp2).slice(-8)}`;
  const skuSsamz = `SSAMZ${String(stamp2).slice(-5)}`;
  const skuOther = `TFR${String(stamp2).slice(-5)}`;
  let company2 = "";

  const file561Collision = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
${account2},I/SS263805/1,${skuSsamz},Steel Seal Amazon LISTIN,70,2419.67
${account2},I/SS263805/1,${skuOther},Traffic Film Remover 5L,45,674.63
${account2},I/OIN022100/,${skuSsamz},Steel Seal Amazon LISTIN,2,62.48
${account2},I/OIN022100/,${skuOther},Traffic Film Remover 5L,1,14.99
${account2},I/SS263805/2,${skuSsamz},Steel Seal Amazon LISTIN,1,40.00
${account2},C/OC000099/1,${skuSsamz},Steel Seal Amazon LISTIN,-1,-31.24
${account2},C/OC000099/1,${skuOther},Traffic Film Remover 5L,-1,-14.99
`;

  const fileSlrbCollision = `A/C,Name,Sacct,Type,Ref,Date,Goods,VAT,Value,Run Bal
${account2},RETAIL AMAZON,,INV,SS263805,01 Oct 26,3134.30,626.86,3761.16,0
${account2},RETAIL AMAZON,,INV,OIN022100,01 Oct 26,77.47,15.49,92.96,0
${account2},RETAIL AMAZON,,CRN,OC000099,01 Oct 26,-46.23,-9.25,-55.48,0
`;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: `RETAILA collision ${stamp2}`,
        status: "ACTIVE",
        paymentTerms: "30 Days",
      },
    });
    company2 = company.id;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company2,
      code: account2,
    });
  });

  it("keeps both SKUs when Autopart repeats /1 on the same document", async () => {
    const first = await confirmAutopartHistoryImport(adminId, {
      companyId: company2,
      file561l: file561Collision,
      fileSlrb: fileSlrbCollision,
      filename561l: "561L-RETAILA.CSV",
      filenameSlrb: "SLRB-RETAILA.CSV",
    });
    expect(first.lineCount).toBe(7);

    const ssDoc = await prisma.autopartSalesLine.findMany({
      where: { companyId: company2, documentReference: "SS263805" },
      select: { sku: true, lineNumber: true, units: true, salesNet: true },
      orderBy: [{ lineNumber: "asc" }, { sku: "asc" }],
    });
    expect(ssDoc).toHaveLength(3);
    expect(ssDoc.map((r) => r.sku).sort()).toEqual([skuOther, skuSsamz, skuSsamz].sort());
    expect(new Set(ssDoc.map((r) => r.lineNumber)).size).toBe(3);

    const oinDoc = await prisma.autopartSalesLine.findMany({
      where: { companyId: company2, documentReference: "OIN022100" },
      select: { sku: true, lineNumber: true },
      orderBy: { lineNumber: "asc" },
    });
    expect(oinDoc).toHaveLength(2);
    expect(new Set(oinDoc.map((r) => r.lineNumber)).size).toBe(2);

    const creditDoc = await prisma.autopartSalesLine.findMany({
      where: { companyId: company2, documentReference: "OC000099", documentType: "CREDIT" },
      select: { sku: true, lineNumber: true, units: true, salesNet: true },
    });
    expect(creditDoc).toHaveLength(2);
    expect(creditDoc.every((r) => Number(r.units) < 0 && Number(r.salesNet) < 0)).toBe(true);

    const ssamzAgg = await prisma.$queryRawUnsafe<Array<{ units: string; sales: string; n: number }>>(
      `SELECT COUNT(*)::int as n, SUM(units)::text as units, SUM("salesNet")::text as sales
       FROM "AutopartSalesLine" WHERE "companyId" = $1 AND sku = $2`,
      company2,
      skuSsamz,
    );
    expect(ssamzAgg[0]!.n).toBe(4); // 70 + 2 + 1 + (-1)
    expect(Number(ssamzAgg[0]!.units)).toBeCloseTo(72, 3);
    expect(Number(ssamzAgg[0]!.sales)).toBeCloseTo(2490.91, 2);

    // Idempotent second identical import — totals unchanged, no double count
    await confirmAutopartHistoryImport(adminId, {
      companyId: company2,
      file561l: file561Collision,
      fileSlrb: fileSlrbCollision,
      filename561l: "561L-RETAILA.CSV",
      filenameSlrb: "SLRB-RETAILA.CSV",
    });
    const again = await prisma.$queryRawUnsafe<Array<{ units: string; sales: string; n: number }>>(
      `SELECT COUNT(*)::int as n, SUM(units)::text as units, SUM("salesNet")::text as sales
       FROM "AutopartSalesLine" WHERE "companyId" = $1 AND sku = $2`,
      company2,
      skuSsamz,
    );
    expect(again[0]!.n).toBe(4);
    expect(Number(again[0]!.units)).toBeCloseTo(72, 3);
    expect(Number(again[0]!.sales)).toBeCloseTo(2490.91, 2);
    expect(await prisma.autopartSalesLine.count({ where: { companyId: company2 } })).toBe(7);
  });
});
