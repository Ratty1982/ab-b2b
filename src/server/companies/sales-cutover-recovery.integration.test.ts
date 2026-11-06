import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { completeCustomerSalesCutoverWithoutHistory } from "@/server/companies/customer-sales-history-import";
import { confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import {
  confirmSkippedOngoingSalesRecovery,
  diagnoseSalesCutoverIncident,
  previewSkippedOngoingSalesRecovery,
} from "@/server/companies/sales-cutover-recovery";
import { AuthError } from "@/server/rbac/guards";
import { canContinuePastSalesHistory } from "@/domain/customer-creation-wizard";

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
  adminId = await ensureUser(`cutover.recovery.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sales history cutover recovery", () => {
  it("blocks wizard continue until an active verified customer finishes baseline", () => {
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
      }).ok,
    ).toBe(false);
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
      }),
    ).toEqual({ ok: true });
  });

  it("diagnoses SENCO-style skipped first invoice and recovers after zero-history cutover without dispatch email", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { name: `SENCO Style ${local}`, status: "ACTIVE" },
    });
    const code = `SC${local.slice(-10).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code });

    const orderNumber = await (async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const n = String((100000 + ((Date.now() + attempt * 7919) % 900000)) % 1000000).padStart(6, "0");
        const candidate = `AB-${n}`;
        const existing = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
        if (!existing) return candidate;
      }
      throw new Error("Could not allocate order number");
    })();
    const documentReference = `SS${local.slice(-8).toUpperCase()}`;
    const brand = await prisma.brand.create({
      data: { name: `Cutover Brand ${local}`, slug: `cutover-brand-${local}`, isActive: true },
    });
    const category = await prisma.category.create({
      data: { name: `Cutover Cat ${local}`, slug: `cutover-cat-${local}`, isActive: true },
    });
    const product = await prisma.product.create({
      data: {
        name: `Cutover Widget ${local}`,
        slug: `cutover-widget-${local}`,
        brandId: brand.id,
        categoryId: category.id,
        status: "ACTIVE",
        isActive: true,
        variants: {
          create: { sku: `CW${local.slice(-8).toUpperCase()}`, isDefault: true, isActive: true },
        },
      },
      include: { variants: true },
    });
    const sku = product.variants[0]!.sku;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        companyId: company.id,
        status: "CONFIRMED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        deliveryAddress: { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA", country: "GB" },
        contactSnapshot: {
          name: "SENCO Buyer",
          email: `senco-${local}@example.invalid`,
          phone: "01130000000",
        },
        items: {
          create: {
            sku,
            name: "Widget",
            qty: 1,
            unitPrice: 10,
            customerUnitPrice: 10,
            lineTotal: 10,
            vatRate: 20,
            lineVat: "2.00",
            lineGross: 12,
            despatchedQty: 0,
            variantId: product.variants[0]!.id,
            productId: product.id,
          },
        },
      },
    });

    // First ongoing import is skipped — cutover incomplete.
    const trm = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
${code},GRP,${documentReference},05/11/2026,${sku},Widget,1,10.00,4.00,6.00,60.000
`;
    const blocked = await confirmAutopartTrm21qcImport(adminId, {
      text: trm,
      filename: "TRM21QC.csv",
      source: "MANUAL",
    });
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: company.id, documentReference },
      }),
    ).toBe(0);
    expect(blocked.id).toBeTruthy();
    expect(
      await prisma.autopartImportDiagnostic.count({
        where: { importRunId: blocked.id!, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
      }),
    ).toBeGreaterThan(0);

    const before = await diagnoseSalesCutoverIncident(adminId, {
      companyId: company.id,
      orderNumber,
      documentReference,
    });
    expect(before.cutover).toBeNull();
    expect(before.ongoingEligibility.eligible).toBe(false);
    if (!before.ongoingEligibility.eligible) {
      expect(before.ongoingEligibility.reasonCode).toBe("HISTORY_CUTOVER_INCOMPLETE");
    }
    expect(before.skippedDiagnostics.length).toBeGreaterThan(0);
    expect(before.skippedDiagnostics.every((row) => row.amountsRedacted)).toBe(true);
    expect(before.importedDocuments).toHaveLength(0);
    expect(before.order?.status).toBe("CONFIRMED");

    await expect(
      previewSkippedOngoingSalesRecovery(adminId, {
        companyId: company.id,
        textTrm21qc: trm,
        documentReference,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    // Option A — brand-new / zero history baseline.
    const cutover = await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId: company.id,
      confirmAccount: code,
      reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
    });
    expect(cutover.historyStatus).toBe("COMPLETE");
    expect(cutover.alreadyComplete).toBe(false);

    // Idempotent cutover.
    const again = await completeCustomerSalesCutoverWithoutHistory(adminId, {
      companyId: company.id,
      confirmAccount: code,
      reason: "Brand-new Autopart customer. No historical sales exist for this verified account.",
    });
    expect(again.alreadyComplete).toBe(true);

    const preview = await previewSkippedOngoingSalesRecovery(adminId, {
      companyId: company.id,
      textTrm21qc: trm,
      filenameTrm21qc: "TRM21QC-recovery.csv",
      documentReference,
      suppressDispatchEmail: true,
    });
    expect(preview.cutoverComplete).toBe(true);
    expect(preview.customerEmailPlan.willQueueDispatchEmail).toBe(false);
    expect(preview.wouldImportTrm21qc.length).toBeGreaterThan(0);
    expect(preview.changesIfConfirmed.some((line) => /Do not queue customer dispatch/i.test(line))).toBe(
      true,
    );

    const recovered = await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: company.id,
      textTrm21qc: trm,
      filenameTrm21qc: "TRM21QC-recovery.csv",
      documentReference,
      suppressDispatchEmail: true,
    });
    expect(recovered.fulfilment.emailsQueued).toBe(0);
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: company.id, documentReference, sku },
      }),
    ).toBe(1);

    // Repeated recovery does not duplicate lines.
    await confirmSkippedOngoingSalesRecovery(adminId, {
      companyId: company.id,
      textTrm21qc: trm,
      filenameTrm21qc: "TRM21QC-recovery.csv",
      documentReference,
      suppressDispatchEmail: true,
    });
    expect(
      await prisma.autopartSalesLine.count({
        where: { companyId: company.id, documentReference, sku },
      }),
    ).toBe(1);

    const after = await diagnoseSalesCutoverIncident(adminId, {
      companyId: company.id,
      orderNumber,
      documentReference,
    });
    expect(after.cutover?.historyStatus).toBe("COMPLETE");
    expect(after.cutover?.evidenceKind).toBe("NO_HISTORICAL_SALES");
    expect(after.ongoingEligibility.eligible).toBe(true);
    expect(after.importedDocuments.length).toBe(1);

    const emails = await prisma.transactionalEmail.count({
      where: { entityType: "Order", entityId: order.id, purpose: "ORDER_DESPATCHED" },
    });
    expect(emails).toBe(0);

    await prisma.autopartSalesLine.deleteMany({ where: { companyId: company.id } });
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: company.id } });
    await prisma.autopartImportDiagnostic.deleteMany({
      where: { importRun: { companyId: company.id } },
    });
    await prisma.autopartCustomerImportRun.deleteMany({ where: { companyId: company.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customerSalesCutover.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.brand.delete({ where: { id: brand.id } });
  });

  it("refuses zero-history when historical sales evidence already exists", async () => {
    const local = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const company = await prisma.company.create({
      data: { name: `Existing History ${local}`, status: "ACTIVE" },
    });
    const code = `EH${local.slice(-10).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, { companyId: company.id, code });
    await prisma.autopartSalesDocument.create({
      data: {
        companyId: company.id,
        autopartCustomerCode: code,
        documentType: "INVOICE",
        documentReference: `SSEH${local.slice(-6).toUpperCase()}`,
        source: "561L",
      },
    });
    await expect(
      completeCustomerSalesCutoverWithoutHistory(adminId, {
        companyId: company.id,
        confirmAccount: code,
        reason: "Should not overwrite existing historical evidence with zero history.",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await prisma.autopartSalesDocument.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
