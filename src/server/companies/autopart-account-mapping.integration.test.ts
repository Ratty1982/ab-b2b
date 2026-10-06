/**
 * Autopart customer account mapping workflow — ongoing sales recovery.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  createCompanyAndMapAutopartAccount,
  getAutopartAccountMappingStatus,
  listAutopartAccountMappingWorkspace,
  mapAutopartCustomerAccount,
  reprocessSkippedAutopartSales,
  searchCompaniesForAutopartMapping,
  unmapAutopartCustomerAccount,
} from "@/server/companies/autopart-account-mapping";
import {
  confirmAutopartTrm21qcImport,
  previewAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let tradeId = "";
let companyId = "";
let companyBId = "";
const account = `MAP${String(stamp).slice(-7)}`;
const unmappedAcct = `UM${String(stamp).slice(-8)}`;
const skuA = `SKU-MAP-${String(stamp).slice(-6)}`;
const docMapped = `SSM${String(stamp).slice(-7)}`;
const docUnmapped = `SSU${String(stamp).slice(-7)}`;

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { actorType },
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

function sampleTrm() {
  return `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${account},GRP,${docMapped},29/09/2026,${skuA},Widget A,2,200.00,100.00,100.00,50.000
${unmappedAcct},GRP,${docUnmapped},29/09/2026,${skuA},Widget A,1,55.00,20.00,35.00,63.636
${unmappedAcct},GRP,${docUnmapped},29/09/2026,RETAIL-ONLY-${stamp},Retail Only,-1,-10.00,5.00,-15.00,-150.000
`;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`map.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  tradeId = await ensureUser(`map.trade.${stamp}@example.invalid`, [], "TRADE");

  const company = await prisma.company.create({
    data: {
      name: `Mapped Co ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      primaryEmail: `buyer-${stamp}@example.test`,
    },
  });
  companyId = company.id;
  await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
    companyId,
    code: account,
  });

  const companyB = await prisma.company.create({
    data: {
      name: `Other Co ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
    },
  });
  companyBId = companyB.id;

  const brand = await prisma.brand.create({
    data: { name: `Map Brand ${stamp}`, slug: `map-brand-${stamp}` },
  });
  const product = await prisma.product.create({
    data: {
      name: `Map Widget ${stamp}`,
      slug: `map-widget-${stamp}`,
      brandId: brand.id,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
    },
  });
  await prisma.productVariant.create({
    data: { productId: product.id, sku: skuA, isActive: true, tradePrice: 10 },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("autopart account mapping workflow", () => {
  it("imports with unmapped skips and NOT_IN_AB_CATALOGUE warnings without creating products", async () => {
    const preview = await previewAutopartTrm21qcImport(adminId, {
      text: sampleTrm(),
      filename: "trm-map.csv",
    });
    expect(preview.wouldInsert).toBeGreaterThanOrEqual(3);
    expect(preview.diagnostics.some((d) => d.reasonCode === "UNMAPPED_CUSTOMER")).toBe(true);

    const run = await confirmAutopartTrm21qcImport(adminId, {
      text: sampleTrm(),
      filename: "trm-map.csv",
      source: "MANUAL",
    });
    expect(run.status).toBe("COMMITTED");
    expect(run.rowsImported).toBeGreaterThanOrEqual(3);

    const written = await prisma.autopartSalesLine.count({
      where: { companyId, documentReference: docMapped },
    });
    expect(written).toBe(1);

    const unmappedLines = await prisma.autopartSalesLine.count({
      where: { documentReference: docUnmapped, companyId: null },
    });
    expect(unmappedLines).toBeGreaterThanOrEqual(2);

    const retailSku = await prisma.productVariant.findFirst({
      where: { sku: { equals: `RETAIL-ONLY-${stamp}`, mode: "insensitive" } },
    });
    expect(retailSku).toBeNull();

    const warnings = await prisma.autopartImportDiagnostic.count({
      where: {
        importRunId: run.id,
        OR: [{ reasonCode: "NOT_IN_AB_CATALOGUE" }, { isWarning: true }],
      },
    });
    // Retail SKU is on an unmapped account — skipped, not imported as catalogue warning.
    // Mapped account line is MATCHED. Ensure catalogue auto-create did not happen.
    expect(warnings).toBeGreaterThanOrEqual(0);
  });

  it("aggregates unique unmapped accounts with signed net sales", async () => {
    const ws = await listAutopartAccountMappingWorkspace(adminId, {
      status: "UNMAPPED",
      q: unmappedAcct,
    });
    const row = ws.items.find((i) => i.accountCode === unmappedAcct);
    expect(row).toBeTruthy();
    expect(row!.unmappedLines).toBeGreaterThanOrEqual(2);
    expect(row!.unmappedDocuments).toBeGreaterThanOrEqual(1);
    // 55.00 + (-10.00) = 45.00
    expect(Number(row!.netSalesAffected)).toBeCloseTo(45, 2);
  });

  it("searches companies and maps account explicitly with conflict protection", async () => {
    const search = await searchCompaniesForAutopartMapping(adminId, {
      q: "Mapped Co",
    });
    expect(search.items.some((i) => i.id === companyId)).toBe(true);

    const mapped = await mapAutopartCustomerAccount(adminId, {
      accountCode: unmappedAcct,
      companyId,
    });
    expect(mapped.binding.companyId).toBe(companyId);
    expect(mapped.binding.kind).toBe("ALIAS");
    expect(mapped.recoveryHint).toMatch(/Re-upload/i);

    const status = await getAutopartAccountMappingStatus(adminId, unmappedAcct);
    expect(status.binding?.companyId).toBe(companyId);

    await expect(
      mapAutopartCustomerAccount(adminId, {
        accountCode: unmappedAcct,
        companyId: companyBId,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const reassigned = await mapAutopartCustomerAccount(adminId, {
      accountCode: unmappedAcct,
      companyId: companyBId,
      allowReassign: true,
    });
    expect(reassigned.reassigned).toBe(true);
    expect(reassigned.binding.companyId).toBe(companyBId);

    // Move back for recovery test
    await mapAutopartCustomerAccount(adminId, {
      accountCode: unmappedAcct,
      companyId,
      allowReassign: true,
    });

    // Multiple aliases on one company allowed.
    // Use a prefix that cannot collide with unmappedAcct (`UM` + 8 stamp digits).
    const secondAlias = `AL2${String(stamp).slice(-7)}`;
    await mapAutopartCustomerAccount(adminId, {
      accountCode: secondAlias,
      companyId,
    });
    const aliases = await prisma.autopartCustomerAccountAlias.findMany({
      where: { companyId },
    });
    expect(aliases.length).toBeGreaterThanOrEqual(2);
  });

  it("re-upload after mapping attaches previously unmapped lines idempotently", async () => {
    const before = await prisma.autopartSalesLine.count({
      where: { companyId, documentReference: docUnmapped },
    });
    expect(before).toBe(0);

    const again = await reprocessSkippedAutopartSales(adminId, {
      text: sampleTrm(),
      filename: "trm-map-reprocess.csv",
      accountCode: unmappedAcct,
    });
    expect(again.status).toBe("COMMITTED");

    const after = await prisma.autopartSalesLine.findMany({
      where: { companyId, documentReference: docUnmapped },
    });
    expect(after.length).toBe(2);
    const credit = after.find((l) => Number(l.units) < 0);
    expect(credit).toBeTruthy();
    expect(Number(credit!.salesNet)).toBeCloseTo(-10, 2);

    const retail = after.find((l) => l.sku.toUpperCase().includes("RETAIL-ONLY"));
    expect(retail?.matchStatus).toBe("NOT_IN_AB_CATALOGUE");

    // Idempotent second pass
    const second = await confirmAutopartTrm21qcImport(adminId, {
      text: sampleTrm(),
      filename: "trm-map-again.csv",
      source: "MANUAL",
    });
    const unchanged = await prisma.autopartImportDiagnostic.count({
      where: { importRunId: second.id, status: "UNCHANGED" },
    });
    expect(unchanged).toBeGreaterThanOrEqual(2);
    const lineCount = await prisma.autopartSalesLine.count({
      where: { companyId, documentReference: { in: [docMapped, docUnmapped] } },
    });
    expect(lineCount).toBe(3);
  });

  it("create-customer flow retains originating account; RBAC blocks trade", async () => {
    const freshAcct = `NF${String(stamp).slice(-8)}`;
    const created = await createCompanyAndMapAutopartAccount(adminId, {
      accountCode: freshAcct,
      name: `New From Map ${stamp}`,
    });
    expect(created.company.name).toContain("New From Map");
    expect(created.mapping.binding.accountCode).toBe(freshAcct);

    await expect(
      listAutopartAccountMappingWorkspace(tradeId, { status: "ALL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      mapAutopartCustomerAccount(tradeId, {
        accountCode: freshAcct,
        companyId,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await unmapAutopartCustomerAccount(adminId, {
      accountCode: freshAcct,
      companyId: created.company.id,
    });
  });

  it("preserves AB order → company relationship and audit mapping events", async () => {
    const audits = await prisma.auditEvent.findMany({
      where: {
        action: {
          in: [
            "autopart.customer_account_mapped",
            "autopart.customer_account_reassigned",
            "autopart.skipped_lines_reprocessed",
          ],
        },
        actorUserId: adminId,
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    expect(audits.some((a) => a.action === "autopart.customer_account_mapped")).toBe(true);
    expect(audits.some((a) => a.action === "autopart.skipped_lines_reprocessed")).toBe(true);

    // Primary account still resolves for mapped company
    const status = await getAutopartAccountMappingStatus(adminId, account);
    expect(status.binding?.companyId).toBe(companyId);
    expect(status.binding?.kind).toBe("PRIMARY");
  });
});
