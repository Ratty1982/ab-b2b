/**
 * Read-only cutover diagnostics and controlled recovery of ongoing 504/TRM21QC
 * invoices that were skipped while CustomerSalesCutover was incomplete.
 *
 * Recovery never invents invoice or despatch data. It reprocesses authoritative
 * source files through the existing ongoing importers after cutover is COMPLETE.
 * Customer dispatch emails default to suppressed for recovery of already-delivered
 * first orders (SENCO-style).
 */

import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  confirmAutopart504Import,
  confirmAutopartTrm21qcImport,
  previewAutopart504Import,
  previewAutopartTrm21qcImport,
} from "@/server/companies/autopart-ongoing-sales";
import {
  evaluate504TrmFulfilmentReadonly,
  run504TrmFulfilmentAfterImport,
} from "@/server/orders/autopart-504-trm-fulfilment";
import { assessOngoingSalesWrite } from "@/server/companies/ongoing-sales-eligibility";

async function requireRecoveryActor(actorUserId: string) {
  return requireAnySystemPermission(actorUserId, [
    "products.import",
    "orders.edit",
    "admin.access",
  ]);
}

const diagnoseSchema = z.object({
  companyId: z.string().cuid(),
  orderNumber: z.string().trim().min(1).max(40).optional(),
  documentReference: z.string().trim().min(1).max(80).optional(),
});

export async function diagnoseSalesCutoverIncident(actorUserId: string, raw: unknown) {
  await requireRecoveryActor(actorUserId);
  const input = diagnoseSchema.parse(raw);

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      salesCutover: {
        select: {
          historyStatus: true,
          completedAt: true,
          completedById: true,
          evidence: true,
          historyFrom: true,
          historyTo: true,
        },
      },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);

  const eligibility = await assessOngoingSalesWrite({
    companyId: company.id,
    autopartCode: company.autopartCustomerCode,
  });

  const focusClauses = [
    input.documentReference ? { documentReference: input.documentReference } : null,
    input.orderNumber ? { abOrderReference: input.orderNumber } : null,
  ].filter((clause): clause is { documentReference: string } | { abOrderReference: string } =>
    Boolean(clause),
  );

  const skippedDiagnostics = await prisma.autopartImportDiagnostic.findMany({
    where: {
      reasonCode: "HISTORY_CUTOVER_INCOMPLETE",
      OR: [
        { companyId: company.id },
        ...(input.documentReference ? [{ documentReference: input.documentReference }] : []),
        ...(input.orderNumber ? [{ abOrderReference: input.orderNumber }] : []),
        ...(company.autopartCustomerCode
          ? [{ customerAccount: company.autopartCustomerCode }]
          : []),
      ],
      ...(focusClauses.length ? { AND: [{ OR: focusClauses }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      reasonCode: true,
      reason: true,
      customerAccount: true,
      documentReference: true,
      documentDate: true,
      abOrderReference: true,
      sku: true,
      quantity: true,
      salesNet: true,
      createdAt: true,
      importRunId: true,
      importRun: { select: { type: true, filename: true, createdAt: true, dryRun: true } },
    },
  });

  const documentRefs = [
    ...new Set(
      [
        input.documentReference,
        ...skippedDiagnostics.map((row) => row.documentReference),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];

  const importedDocuments = documentRefs.length
    ? await prisma.autopartSalesDocument.findMany({
        where: {
          companyId: company.id,
          documentReference: { in: documentRefs },
        },
        include: {
          lines: {
            select: {
              id: true,
              sku: true,
              units: true,
              salesNet: true,
              lineNumber: true,
              source: true,
            },
            orderBy: { lineNumber: "asc" },
          },
        },
      })
    : [];

  const orderNumber =
    input.orderNumber ??
    skippedDiagnostics.find((row) => row.abOrderReference)?.abOrderReference ??
    null;

  const order = orderNumber
    ? await prisma.order.findUnique({
        where: { orderNumber },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          companyId: true,
          createdAt: true,
          placedAt: true,
          items: {
            select: {
              id: true,
              sku: true,
              name: true,
              qty: true,
              despatchedQty: true,
            },
          },
          invoices: {
            select: {
              id: true,
              externalRef: true,
              invoiceNumber: true,
              status: true,
              createdAt: true,
            },
          },
          fulfilmentEvents: {
            select: {
              id: true,
              kind: true,
              summary: true,
              source: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      })
    : null;

  const despatchEmails = order
    ? await prisma.transactionalEmail.findMany({
        where: {
          entityType: "Order",
          entityId: order.id,
          purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
        },
        select: {
          id: true,
          purpose: true,
          status: true,
          toEmail: true,
          idempotencyKey: true,
          createdAt: true,
          sentAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : [];

  const evidence = company.salesCutover?.evidence;
  const evidenceKind =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? typeof (evidence as { kind?: unknown }).kind === "string"
        ? (evidence as { kind: string }).kind
        : null
      : null;

  return {
    readOnly: true as const,
    company: {
      id: company.id,
      name: company.name,
      status: company.status,
      createdAt: company.createdAt.toISOString(),
      autopartCustomerCode: company.autopartCustomerCode,
      autopartCustomerCodeVerifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
    },
    cutover: company.salesCutover
      ? {
          historyStatus: company.salesCutover.historyStatus,
          completedAt: company.salesCutover.completedAt?.toISOString() ?? null,
          completedById: company.salesCutover.completedById,
          evidenceKind,
          historyFrom: company.salesCutover.historyFrom?.toISOString() ?? null,
          historyTo: company.salesCutover.historyTo?.toISOString() ?? null,
          evidence,
        }
      : null,
    ongoingEligibility: eligibility.persist
      ? {
          eligible: true as const,
          authority: eligibility.authority,
          autopartCode: eligibility.autopartCode,
        }
      : {
          eligible: false as const,
          reasonCode: eligibility.reasonCode,
          reason: eligibility.reason,
        },
    skippedDiagnostics: skippedDiagnostics.map((row) => ({
      id: row.id,
      status: row.status,
      reasonCode: row.reasonCode,
      reason: row.reason,
      customerAccount: row.customerAccount,
      documentReference: row.documentReference,
      documentDate: row.documentDate,
      abOrderReference: row.abOrderReference,
      sku: row.sku,
      quantity: row.quantity,
      salesNet: row.salesNet,
      amountsRedacted: row.sku == null && row.quantity == null && row.salesNet == null,
      createdAt: row.createdAt.toISOString(),
      importRun: {
        ...row.importRun,
        createdAt: row.importRun.createdAt.toISOString(),
      },
    })),
    note:
      "HISTORY_CUTOVER_INCOMPLETE diagnostics do not store invoice amounts or product lines. Recovery must reprocess authoritative 504/TRM21QC source files after cutover is COMPLETE.",
    importedDocuments: importedDocuments.map((doc) => ({
      id: doc.id,
      documentReference: doc.documentReference,
      documentType: doc.documentType,
      source: doc.source,
      goodsNet: doc.goodsNet?.toString() ?? null,
      abOrderNumber: doc.abOrderNumber,
      abOrderId: doc.abOrderId,
      fulfilmentStatus: doc.fulfilmentStatus,
      lines: doc.lines.map((line) => ({
        sku: line.sku,
        units: line.units.toString(),
        salesNet: line.salesNet.toString(),
        lineNumber: line.lineNumber,
        source: line.source,
      })),
    })),
    order: order
      ? {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          companyId: order.companyId,
          belongsToCompany: order.companyId === company.id,
          createdAt: order.createdAt.toISOString(),
          placedAt: order.placedAt?.toISOString() ?? null,
          items: order.items,
          invoices: order.invoices.map((invoice) => ({
            ...invoice,
            createdAt: invoice.createdAt.toISOString(),
          })),
          fulfilmentEvents: order.fulfilmentEvents.map((event) => ({
            ...event,
            createdAt: event.createdAt.toISOString(),
          })),
        }
      : null,
    despatchEmails: despatchEmails.map((email) => ({
      ...email,
      createdAt: email.createdAt.toISOString(),
      sentAt: email.sentAt?.toISOString() ?? null,
    })),
  };
}

const recoverySchema = z.object({
  companyId: z.string().cuid(),
  text504: z.string().optional(),
  textTrm21qc: z.string().optional(),
  filename504: z.string().trim().max(240).optional(),
  filenameTrm21qc: z.string().trim().max(240).optional(),
  documentReference: z.string().trim().min(1).max(80).optional(),
  /**
   * Recovery of already-delivered first orders must not re-mail the customer.
   * Default true — operator must explicitly opt in to send dispatch email.
   */
  suppressDispatchEmail: z.boolean().default(true),
});

function assertHasSource(input: z.infer<typeof recoverySchema>) {
  if (!input.text504?.trim() && !input.textTrm21qc?.trim()) {
    throw new AuthError(
      "Provide the authoritative 504 and/or TRM21QC source text that contains the skipped invoice. Diagnostics alone are not enough.",
      "VALIDATION",
      400,
    );
  }
}

async function assertCompanyReadyForRecovery(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      salesCutover: { select: { historyStatus: true, evidence: true } },
    },
  });
  if (!company) throw new AuthError("Customer not found", "NOT_FOUND", 404);
  const eligibility = await assessOngoingSalesWrite({
    companyId: company.id,
    autopartCode: company.autopartCustomerCode,
  });
  if (!eligibility.persist) {
    throw new AuthError(
      eligibility.reasonCode === "HISTORY_CUTOVER_INCOMPLETE"
        ? "Complete the sales history baseline before recovering skipped invoices."
        : eligibility.reason,
      "VALIDATION",
      400,
    );
  }
  return { company, eligibility };
}

export async function previewSkippedOngoingSalesRecovery(actorUserId: string, raw: unknown) {
  await requireRecoveryActor(actorUserId);
  const input = recoverySchema.parse(raw);
  assertHasSource(input);
  const { company, eligibility } = await assertCompanyReadyForRecovery(input.companyId);

  const preview504 = input.text504?.trim()
    ? await previewAutopart504Import(actorUserId, {
        text: input.text504,
        filename: input.filename504 ?? "504-recovery.txt",
      })
    : null;
  const previewTrm = input.textTrm21qc?.trim()
    ? await previewAutopartTrm21qcImport(actorUserId, {
        text: input.textTrm21qc,
        filename: input.filenameTrm21qc ?? "TRM21QC-recovery.csv",
      })
    : null;

  const focusRef = input.documentReference?.trim().toUpperCase() || null;
  const filter504Rows = preview504?.rows
    ? focusRef
      ? preview504.rows.filter((row) => String(row.document).toUpperCase() === focusRef)
      : preview504.rows
    : [];
  const filterTrmRows = previewTrm?.sample
    ? focusRef
      ? previewTrm.sample.filter((row) => String(row.document).toUpperCase() === focusRef)
      : previewTrm.sample
    : [];

  const orderNumbers = [
    ...new Set(
      filter504Rows
        .map((row) => String(row.abMatch ?? ""))
        .filter((value) => /^AB-\d+/i.test(value)),
    ),
  ];

  const orders = orderNumbers.length
    ? await prisma.order.findMany({
        where: { orderNumber: { in: orderNumbers }, companyId: company.id },
        select: { id: true, orderNumber: true, status: true },
      })
    : [];

  const fulfilment =
    orders.length > 0
      ? await evaluate504TrmFulfilmentReadonly(actorUserId, {
          orderIds: orders.map((order) => order.id),
        })
      : null;

  const existingDespatchEmails = orders.length
    ? await prisma.transactionalEmail.findMany({
        where: {
          entityType: "Order",
          entityId: { in: orders.map((order) => order.id) },
          purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
        },
        select: { entityId: true, purpose: true, status: true, idempotencyKey: true },
      })
    : [];

  return {
    companyId: company.id,
    companyName: company.name,
    autopartCode: eligibility.autopartCode,
    cutoverComplete: true,
    suppressDispatchEmail: input.suppressDispatchEmail,
    focusDocumentReference: focusRef,
    wouldImport504: filter504Rows,
    wouldImportTrm21qc: filterTrmRows,
    preview504Summary: preview504
      ? {
          documents: preview504.documents,
          wouldInsert: preview504.wouldInsert,
          wouldUpdate: preview504.wouldUpdate,
          wouldSkip: preview504.wouldSkip,
        }
      : null,
    previewTrmSummary: previewTrm
      ? {
          rows: previewTrm.rows,
          wouldInsert: previewTrm.wouldInsert,
          wouldUpdate: previewTrm.wouldUpdate,
          wouldSkip: previewTrm.wouldSkip,
        }
      : null,
    matchedOrders: orders,
    fulfilmentPreview: fulfilment,
    existingDespatchEmails,
    customerEmailPlan: input.suppressDispatchEmail
      ? {
          willQueueDispatchEmail: false,
          reason:
            "Recovery suppresses customer dispatch email by default. Financial import and order fulfilment still apply.",
        }
      : {
          willQueueDispatchEmail: true,
          reason:
            "Operator opted in to dispatch email. Existing ORDER_DESPATCHED idempotency keys still prevent duplicates.",
        },
    changesIfConfirmed: [
      input.text504?.trim()
        ? "Reprocess 504 rows through the live ongoing importer for this customer only (idempotent; no auto fulfilment yet)."
        : null,
      input.textTrm21qc?.trim()
        ? "Reprocess TRM21QC rows through the live ongoing importer for this customer only (idempotent; no auto fulfilment yet)."
        : null,
      "Run 504+TRM fulfilment matching for linked AB orders.",
      input.suppressDispatchEmail
        ? "Do not queue customer dispatch emails for this recovery."
        : "May queue customer dispatch emails when fulfilment evidence is new.",
      "Do not invent invoice, line, or despatch quantities.",
    ].filter((line): line is string => Boolean(line)),
  };
}

export async function confirmSkippedOngoingSalesRecovery(actorUserId: string, raw: unknown) {
  await requireRecoveryActor(actorUserId);
  const input = recoverySchema.parse(raw);
  assertHasSource(input);
  const { company, eligibility } = await assertCompanyReadyForRecovery(input.companyId);

  const preview = await previewSkippedOngoingSalesRecovery(actorUserId, input);
  const customerScope = {
    companyId: company.id,
    accountCodes: [eligibility.autopartCode],
  };

  // customerScope skips the importer's automatic fulfilment so we can apply with email suppression.
  const run504 = input.text504?.trim()
    ? await confirmAutopart504Import(actorUserId, {
        text: input.text504,
        filename: input.filename504 ?? "504-recovery.txt",
        source: "MANUAL",
        customerScope,
      })
    : null;
  const runTrm = input.textTrm21qc?.trim()
    ? await confirmAutopartTrm21qcImport(actorUserId, {
        text: input.textTrm21qc,
        filename: input.filenameTrm21qc ?? "TRM21QC-recovery.csv",
        source: "MANUAL",
        customerScope,
      })
    : null;

  const orderIds = preview.matchedOrders.map((order) => order.id);
  const fulfilment = await run504TrmFulfilmentAfterImport(actorUserId, {
    ...(orderIds.length ? { orderIds } : {}),
    ...(input.suppressDispatchEmail ? { suppressCustomerDispatchEmail: true } : {}),
  });

  await recordAuditEvent({
    action: "autopart.skipped_ongoing_sales_recovered",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    metadata: {
      companyId: company.id,
      autopartCode: eligibility.autopartCode,
      documentReference: input.documentReference ?? null,
      suppressDispatchEmail: input.suppressDispatchEmail,
      run504Id: run504 && "id" in run504 ? run504.id : null,
      runTrmId: runTrm && "id" in runTrm ? runTrm.id : null,
      fulfilmentEmailsQueued: fulfilment.emailsQueued,
      fulfilmentOrdersMutated: fulfilment.ordersMutated,
    },
  });

  return {
    companyId: company.id,
    preview,
    run504,
    runTrm,
    fulfilment: {
      mode: fulfilment.mode,
      applied: fulfilment.applied,
      emailsQueued: fulfilment.emailsQueued,
      ordersMutated: fulfilment.ordersMutated,
      preview: fulfilment.preview,
    },
  };
}
