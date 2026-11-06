#!/usr/bin/env bun
/**
 * Read-only sales cutover / skipped-invoice diagnostic.
 *
 * Usage:
 *   bun run scripts/diagnose-sales-cutover.ts \
 *     --company cmw3dyor8000xnx014idu4rys \
 *     --order AB-000014 \
 *     --document SS307451
 *
 * Never writes. Skipped HISTORY_CUTOVER_INCOMPLETE diagnostics deliberately
 * redact amounts — recovery still needs the original 504/TRM21QC source files.
 */

import { PrismaClient } from "@prisma/client";
import { assessOngoingSalesWrite } from "../src/server/companies/ongoing-sales-eligibility";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const companyId = arg("company") ?? "cmw3dyor8000xnx014idu4rys";
  const orderNumber = arg("order") ?? "AB-000014";
  const documentReference = arg("document") ?? "SS307451";
  const prisma = new PrismaClient();

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        autopartCustomerCode: true,
        autopartCustomerCodeVerifiedAt: true,
        salesCutover: true,
      },
    });
    if (!company) {
      console.error(JSON.stringify({ error: "Company not found", companyId }, null, 2));
      process.exitCode = 1;
      return;
    }

    const eligibility = await assessOngoingSalesWrite({
      companyId: company.id,
      autopartCode: company.autopartCustomerCode,
    });

    const skipped = await prisma.autopartImportDiagnostic.findMany({
      where: {
        OR: [
          { companyId: company.id, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
          { documentReference, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
          { abOrderReference: orderNumber, reasonCode: "HISTORY_CUTOVER_INCOMPLETE" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { importRun: { select: { id: true, type: true, filename: true, createdAt: true } } },
    });

    const docs = await prisma.autopartSalesDocument.findMany({
      where: {
        OR: [{ companyId: company.id, documentReference }, { documentReference }],
      },
      include: {
        lines: { select: { sku: true, units: true, salesNet: true, lineNumber: true, source: true } },
      },
    });

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        companyId: true,
        createdAt: true,
        placedAt: true,
        items: { select: { sku: true, name: true, qty: true, despatchedQty: true } },
        invoices: { select: { id: true, externalRef: true, invoiceNumber: true, status: true, createdAt: true } },
        fulfilmentEvents: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { kind: true, summary: true, source: true, createdAt: true },
        },
      },
    });

    const emails = order
      ? await prisma.transactionalEmail.findMany({
          where: {
            entityType: "Order",
            entityId: order.id,
            purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
          },
          select: {
            purpose: true,
            status: true,
            toEmail: true,
            idempotencyKey: true,
            createdAt: true,
            sentAt: true,
          },
        })
      : [];

    const report = {
      readOnly: true,
      generatedAt: new Date().toISOString(),
      company: {
        id: company.id,
        name: company.name,
        status: company.status,
        createdAt: company.createdAt.toISOString(),
        autopartCustomerCode: company.autopartCustomerCode,
        verifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      },
      cutover: company.salesCutover,
      ongoingEligibility: eligibility,
      skippedDiagnostics: skipped.map((row) => ({
        id: row.id,
        documentReference: row.documentReference,
        abOrderReference: row.abOrderReference,
        customerAccount: row.customerAccount,
        reasonCode: row.reasonCode,
        reason: row.reason,
        amountsRedacted: row.sku == null && row.quantity == null && row.salesNet == null,
        sku: row.sku,
        quantity: row.quantity,
        salesNet: row.salesNet,
        createdAt: row.createdAt.toISOString(),
        importRun: row.importRun,
      })),
      note:
        "Skipped HISTORY_CUTOVER_INCOMPLETE rows do not retain invoice amounts. Reprocess authoritative 504/TRM21QC source after cutover COMPLETE.",
      importedDocuments: docs,
      order,
      despatchEmails: emails,
      operatorSteps: [
        "1. Confirm Autopart code is uniquely verified.",
        "2. If cutover is incomplete and there is no historical sales evidence, complete zero-history baseline (NO_HISTORICAL_SALES) with reason + typed account.",
        "3. Preview skipped-invoice recovery with the original 504 and TRM21QC files containing the invoice.",
        "4. Confirm recovery with suppressDispatchEmail=true for already-delivered orders.",
        "5. Verify Sales Enquiry and order fulfilment status. Do not resend dispatch email.",
      ],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
