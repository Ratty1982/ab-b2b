/**
 * Read-only cutover diagnostics and controlled recovery of ongoing 504/TRM21QC
 * invoices that were skipped while CustomerSalesCutover was incomplete.
 *
 * Recovery never invents invoice or despatch data. It reprocesses authoritative
 * source files through the existing ongoing importers after cutover is COMPLETE.
 *
 * Safety invariants for targeted incident recovery:
 * - documentReference is required
 * - persistence is scoped to that invoice + company (documentReferences filter)
 * - fulfilment never runs unfiltered; orderIds must be non-empty and company-owned
 * - import + fulfilment run under the exclusive fulfilment lock so a concurrent
 *   scheduled run cannot queue dispatch email mid-recovery
 * - suppressCustomerDispatchEmail defaults to true and is audited
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
  run504TrmFulfilmentInnerForRecovery,
  with504TrmFulfilmentExclusive,
} from "@/server/orders/autopart-504-trm-fulfilment";
import { assessOngoingSalesWrite } from "@/server/companies/ongoing-sales-eligibility";
import { parseExactAbOrderReference } from "@/domain/autopart-504-trm-fulfilment";
import {
  isAutopart504ImportableRow,
  parseAutopart504Report,
} from "@/domain/autopart-504";
import { parseAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";

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
  /** Required for targeted incident recovery (e.g. SS307451). */
  documentReference: z.string().trim().min(1).max(80),
  /**
   * Optional when 504 source carries the AB order reference.
   * Required when recovering from TRM-only evidence that has no AB order column.
   */
  orderNumber: z.string().trim().min(1).max(40).optional(),
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

function normaliseDocumentRef(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Resolve AB orders that the scoped source evidence points at for this company.
 * Fail closed when none match — recovery must never fall back to unfiltered fulfilment.
 */
async function resolveRecoveryOrders(input: {
  companyId: string;
  documentReference: string;
  orderNumber?: string | undefined;
  filter504Rows: Array<{ document: string; abMatch?: string | null }>;
  filterTrmRows: Array<{ document: string }>;
}) {
  const focus = normaliseDocumentRef(input.documentReference);
  const inScope504 = input.filter504Rows.filter(
    (row) => String(row.document).toUpperCase() === focus,
  );
  const inScopeTrm = input.filterTrmRows.filter(
    (row) => String(row.document).toUpperCase() === focus,
  );
  if (!inScope504.length && !inScopeTrm.length) {
    throw new AuthError(
      `Invoice ${focus} was not found in the provided 504/TRM21QC source. Recovery was not started.`,
      "VALIDATION",
      400,
    );
  }

  const orderNumbers: string[] = [];
  if (input.orderNumber?.trim()) {
    orderNumbers.push(input.orderNumber.trim().toUpperCase());
  }
  for (const row of inScope504) {
    const parsed = parseExactAbOrderReference(String(row.abMatch ?? ""));
    if (parsed) orderNumbers.push(parsed);
  }

  // Also accept an AB order already linked on a stored document for this invoice.
  const linked = await prisma.autopartSalesDocument.findMany({
    where: {
      companyId: input.companyId,
      documentReference: { equals: focus, mode: "insensitive" },
      abOrderId: { not: null },
    },
    select: { abOrderId: true, abOrderNumber: true },
  });
  for (const doc of linked) {
    if (doc.abOrderNumber) orderNumbers.push(doc.abOrderNumber);
  }

  const uniqueNumbers = [...new Set(orderNumbers)];
  if (!uniqueNumbers.length) {
    throw new AuthError(
      `No AB order reference found for invoice ${focus}. Provide orderNumber when recovering from TRM-only source evidence.`,
      "VALIDATION",
      400,
    );
  }

  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: uniqueNumbers }, companyId: input.companyId },
    select: { id: true, orderNumber: true, status: true, companyId: true },
  });

  if (!orders.length) {
    throw new AuthError(
      `No verified AB order for invoice ${focus} belongs to this customer. Recovery fulfilment was not run.`,
      "VALIDATION",
      400,
    );
  }

  const foreign = uniqueNumbers.filter(
    (number) => !orders.some((order) => order.orderNumber === number),
  );
  if (foreign.length) {
    throw new AuthError(
      `Source evidence references AB order(s) ${foreign.join(", ")} that do not belong to this customer.`,
      "VALIDATION",
      400,
    );
  }

  return {
    focusDocumentReference: focus,
    inScope504,
    inScopeTrm,
    orders,
  };
}

export async function previewSkippedOngoingSalesRecovery(actorUserId: string, raw: unknown) {
  await requireRecoveryActor(actorUserId);
  const input = recoverySchema.parse(raw);
  assertHasSource(input);
  const { company, eligibility } = await assertCompanyReadyForRecovery(input.companyId);
  const focus = normaliseDocumentRef(input.documentReference);

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

  const all504 = preview504?.rows ?? [];
  const allTrm = previewTrm?.sample ?? [];
  const filter504Rows = all504.filter((row) => String(row.document).toUpperCase() === focus);
  const filterTrmRows = allTrm.filter((row) => String(row.document).toUpperCase() === focus);

  // Derive out-of-scope refs from the raw source parse (not only preview display rows),
  // so multi-invoice files are listed even when preview truncates or filters status rows.
  const source504Docs = input.text504?.trim()
    ? [
        ...new Set(
          parseAutopart504Report(input.text504)
            .rows.filter(isAutopart504ImportableRow)
            .map((row) => row.documentNumber.trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : [];
  const sourceTrmDocs = input.textTrm21qc?.trim()
    ? [
        ...new Set(
          parseAutopartTrm21qcReport(input.textTrm21qc)
            .rows.filter((row) => row.classification === "OK" && row.documentNumber)
            .map((row) => String(row.documentNumber).trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : [];
  const outOfScope504 = source504Docs.filter((doc) => doc !== focus);
  const outOfScopeTrm = sourceTrmDocs.filter((doc) => doc !== focus);

  const resolved = await resolveRecoveryOrders({
    companyId: company.id,
    documentReference: focus,
    orderNumber: input.orderNumber,
    filter504Rows,
    filterTrmRows,
  });

  const existingDocs = await prisma.autopartSalesDocument.findMany({
    where: {
      companyId: company.id,
      documentReference: { equals: focus, mode: "insensitive" },
    },
    select: { id: true, source: true, has504: true, hasTrm21qc: true, abOrderId: true },
  });

  const evidenceAlreadyStored = existingDocs.length > 0;
  let fulfilmentPreview: Awaited<ReturnType<typeof evaluate504TrmFulfilmentReadonly>> | null = null;
  let fulfilmentPreviewStatus: "PENDING_AFTER_IMPORT" | "BASED_ON_STORED_EVIDENCE" =
    "PENDING_AFTER_IMPORT";

  if (evidenceAlreadyStored) {
    fulfilmentPreview = await evaluate504TrmFulfilmentReadonly(actorUserId, {
      orderIds: resolved.orders.map((order) => order.id),
    });
    fulfilmentPreviewStatus = "BASED_ON_STORED_EVIDENCE";
  }

  const existingDespatchEmails = await prisma.transactionalEmail.findMany({
    where: {
      entityType: "Order",
      entityId: { in: resolved.orders.map((order) => order.id) },
      purpose: { in: ["ORDER_DESPATCHED", "ORDER_PART_DESPATCHED"] },
    },
    select: { entityId: true, purpose: true, status: true, idempotencyKey: true },
  });

  return {
    companyId: company.id,
    companyName: company.name,
    autopartCode: eligibility.autopartCode,
    cutoverComplete: true,
    suppressDispatchEmail: input.suppressDispatchEmail,
    focusDocumentReference: focus,
    wouldImport504: filter504Rows,
    wouldImportTrm21qc: filterTrmRows,
    wouldSkipOutsideScope: {
      documents504: outOfScope504,
      linesTrm21qc: outOfScopeTrm,
      note: "These rows appear in the source file but will not be persisted (DOCUMENT_OUT_OF_SCOPE).",
    },
    preview504Summary: preview504
      ? {
          documents: preview504.documents,
          wouldInsert: filter504Rows.filter((row) => row.status === "INSERTED").length,
          scopedRows: filter504Rows.length,
          outOfScopeRows: outOfScope504.length,
        }
      : null,
    previewTrmSummary: previewTrm
      ? {
          scopedRows: filterTrmRows.length,
          outOfScopeRows: outOfScopeTrm.length,
        }
      : null,
    matchedOrders: resolved.orders,
    evidenceAlreadyStored,
    fulfilmentPreviewStatus,
    fulfilmentPreview:
      fulfilmentPreviewStatus === "PENDING_AFTER_IMPORT"
        ? {
            pending: true as const,
            message:
              "Matching sales documents for this invoice are not stored yet. Fulfilment will be re-evaluated only after scoped import persists authoritative 504/TRM evidence. No dispatch transition is confirmed at preview time.",
            candidateOrderIds: resolved.orders.map((order) => order.id),
            candidateOrderNumbers: resolved.orders.map((order) => order.orderNumber),
          }
        : fulfilmentPreview,
    existingDespatchEmails,
    customerEmailPlan: input.suppressDispatchEmail
      ? {
          willQueueDispatchEmail: false,
          reason:
            "Recovery suppresses customer dispatch email by default for the whole exclusive import+fulfilment transaction.",
        }
      : {
          willQueueDispatchEmail: true,
          reason:
            "Operator opted in to dispatch email. Existing ORDER_DESPATCHED idempotency keys still prevent duplicates.",
        },
    changesIfConfirmed: [
      input.text504?.trim()
        ? `Persist only invoice ${focus} from the 504 source for this customer (other documents skipped).`
        : null,
      input.textTrm21qc?.trim()
        ? `Persist only invoice ${focus} from the TRM21QC source for this customer (other documents skipped).`
        : null,
      `Run fulfilment only for verified company-owned order(s): ${resolved.orders.map((o) => o.orderNumber).join(", ")}.`,
      input.suppressDispatchEmail
        ? "Do not queue customer dispatch emails for this recovery (exclusive lock held through import+fulfilment)."
        : "May queue customer dispatch emails when fulfilment evidence is new.",
      "Do not invent invoice, line, or despatch quantities.",
      "Do not import or fulfil unrelated invoices, customers, or orders.",
    ].filter((line): line is string => Boolean(line)),
  };
}

export async function confirmSkippedOngoingSalesRecovery(actorUserId: string, raw: unknown) {
  await requireRecoveryActor(actorUserId);
  const input = recoverySchema.parse(raw);
  assertHasSource(input);
  const { company, eligibility } = await assertCompanyReadyForRecovery(input.companyId);
  const focus = normaliseDocumentRef(input.documentReference);

  // Preview validates scope / matching orders before any write.
  const preview = await previewSkippedOngoingSalesRecovery(actorUserId, input);
  const orderIds = preview.matchedOrders.map((order) => order.id);
  if (!orderIds.length) {
    throw new AuthError(
      "No verified matching AB order exists for this recovery. Unfiltered fulfilment was refused.",
      "VALIDATION",
      400,
    );
  }

  const customerScope = {
    companyId: company.id,
    accountCodes: [eligibility.autopartCode],
    documentReferences: [focus],
  };

  // Hold the fulfilment exclusive lock across import + fulfilment so a concurrent
  // scheduled run cannot evaluate the newly stored evidence and queue dispatch email
  // before recovery's suppressCustomerDispatchEmail=true apply completes.
  const result = await with504TrmFulfilmentExclusive(async () => {
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

    // Re-verify ownership inside the lock before applying.
    const owned = await prisma.order.findMany({
      where: { id: { in: orderIds }, companyId: company.id },
      select: { id: true, orderNumber: true },
    });
    if (owned.length !== orderIds.length) {
      throw new AuthError(
        "Recovery orders no longer exclusively belong to this customer. Fulfilment was not applied.",
        "VALIDATION",
        400,
      );
    }

    // Import already skipped auto-fulfilment via customerScope. Apply only scoped orders
    // without re-entering the exclusive lock (caller already holds it).
    const fulfilment = await run504TrmFulfilmentInnerForRecovery(actorUserId, {
      companyId: company.id,
      orderIds: owned.map((order) => order.id),
      suppressCustomerDispatchEmail: input.suppressDispatchEmail,
    });

    return { run504, runTrm, fulfilment, owned };
  });

  await recordAuditEvent({
    action: "autopart.skipped_ongoing_sales_recovered",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    metadata: {
      companyId: company.id,
      autopartCode: eligibility.autopartCode,
      documentReference: focus,
      orderIds: result.owned.map((order) => order.id),
      orderNumbers: result.owned.map((order) => order.orderNumber),
      suppressDispatchEmail: input.suppressDispatchEmail,
      run504Id: result.run504 && "id" in result.run504 ? result.run504.id : null,
      runTrmId: result.runTrm && "id" in result.runTrm ? result.runTrm.id : null,
      fulfilmentEmailsQueued: result.fulfilment.emailsQueued,
      fulfilmentOrdersMutated: result.fulfilment.ordersMutated,
    },
  });

  if (input.suppressDispatchEmail) {
    await recordAuditEvent({
      action: "order.despatch_email_suppressed",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      metadata: {
        source: "AUTOPART_504_TRM_RECOVERY",
        documentReference: focus,
        orderIds: result.owned.map((order) => order.id),
        orderNumbers: result.owned.map((order) => order.orderNumber),
        reason: "Targeted skipped-invoice recovery — customer dispatch email suppressed for exclusive transaction",
        emailsQueued: result.fulfilment.emailsQueued,
      },
    });
  }

  return {
    companyId: company.id,
    preview,
    run504: result.run504,
    runTrm: result.runTrm,
    fulfilment: {
      mode: result.fulfilment.mode,
      applied: result.fulfilment.applied,
      emailsQueued: result.fulfilment.emailsQueued,
      ordersMutated: result.fulfilment.ordersMutated,
      preview: result.fulfilment.preview,
    },
  };
}

