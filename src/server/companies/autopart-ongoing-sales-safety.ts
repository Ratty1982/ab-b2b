/**
 * Read-only diagnostics for ongoing 504/TRM21QC document identity and undispatched orders.
 * Nothing here writes documents, orders, stock, or email.
 */
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  describeUndispatchedOrder,
  evaluateOrder504TrmFulfilment,
  parseExactAbOrderReference,
  type FulfilmentDocumentInput,
} from "@/domain/autopart-504-trm-fulfilment";
import { isAuthoritativeOngoingDocument } from "@/domain/autopart-ongoing-document-match";
import { importRunNeedsAttention } from "@/domain/autopart-ongoing-import-attention";
import {
  describeSafetyReportCoverage,
  ONGOING_SAFETY_SAMPLE_LIMITS,
} from "@/domain/autopart-ongoing-safety-report";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { grants } from "@/server/rbac/access";
import { read504TrmFulfilmentSettings } from "@/server/orders/autopart-504-trm-fulfilment";

const RECOVERY_STEPS = [
  "Re-import the failed TRM21QC file, including TRM21QC_20261014.csv, after this matching fix. The importer updates the ongoing document for that document type and reference.",
  "Historical documents that share a reference across companies stay unchanged. They are not duplicates and their totals are not overwritten.",
  "A document already owned by another customer is reported and skipped. Its financial rows are not moved.",
  "A committed import that skipped document conflicts is marked Needs attention. It is not a complete success. Re-upload that file after the customer identity is resolved. Rows already saved are not inserted again.",
  "Mailbox polling does not create another run for a file that already committed or already failed. It does not send customer email or mark orders despatched.",
  "After the replay is verified, preview 504/TRM fulfilment. Apply it only when the preview is accepted. An invoice reference alone does not despatch an order.",
  "A repeated fulfilment with the same fingerprint does not create another fulfilment event, invoice, stock movement, or customer email.",
] as const;

async function requireOngoingSalesAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!grants(profile, "admin.access", "orders.edit")) {
    throw new AuthError("Not permitted to manage Autopart sales feeds", "FORBIDDEN", 403);
  }
  return profile;
}

type CollisionRow = {
  documentReference: string;
  documentType: string;
  ongoing: number;
  historical: number;
};

function asNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export async function readOngoingSalesSafetyReport(actorUserId: string) {
  await requireOngoingSalesAdmin(actorUserId);
  const [collisionTotalRows, collisionRows, sharedHistorical, attentionTotalRows, attentionRuns, settings] =
    await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT 1
        FROM "AutopartSalesDocument"
        GROUP BY "documentReference", "documentType"
        HAVING COUNT(*) > 1
           AND COUNT(*) FILTER (
             WHERE "has504" OR "hasTrm21qc"
                OR "source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
           ) > 0
      ) groups
    `,
    prisma.$queryRaw<CollisionRow[]>`
      SELECT "documentReference",
             "documentType"::text AS "documentType",
             COUNT(*) FILTER (
               WHERE "has504" OR "hasTrm21qc"
                  OR "source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
             )::int AS ongoing,
             COUNT(*) FILTER (
               WHERE NOT (
                 "has504" OR "hasTrm21qc"
                 OR "source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
               )
             )::int AS historical
      FROM "AutopartSalesDocument"
      GROUP BY "documentReference", "documentType"
      HAVING COUNT(*) > 1
         AND COUNT(*) FILTER (
           WHERE "has504" OR "hasTrm21qc"
              OR "source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
         ) > 0
      ORDER BY "documentReference"
      LIMIT ${ONGOING_SAFETY_SAMPLE_LIMITS.collisions}
    `,
    prisma.$queryRaw<Array<{ sharedReferences: number }>>`
      SELECT COUNT(*)::int AS "sharedReferences"
      FROM (
        SELECT "documentReference"
        FROM "AutopartSalesDocument"
        WHERE NOT (
          "has504" OR "hasTrm21qc"
          OR "source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
        )
        GROUP BY "documentReference"
        HAVING COUNT(DISTINCT "companyId") > 1
      ) shared
    `,
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM "AutopartCustomerImportRun"
      WHERE "type"::text IN ('ONGOING_504', 'ONGOING_TRM21QC')
        AND (
          "status"::text = 'FAILED'
          OR (
            "status"::text = 'COMMITTED'
            AND (
              COALESCE("diagnostics"->>'attentionRequired', '') = 'true'
              OR (
                jsonb_typeof("issues"->'conflicts') = 'array'
                AND jsonb_array_length("issues"->'conflicts') > 0
              )
            )
          )
        )
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        filename: string | null;
        status: string;
        createdAt: Date;
        issues: unknown;
        diagnostics: unknown;
      }>
    >`
      SELECT "id", "type"::text AS "type", "filename", "status"::text AS "status",
             "createdAt", "issues", "diagnostics"
      FROM "AutopartCustomerImportRun"
      WHERE "type"::text IN ('ONGOING_504', 'ONGOING_TRM21QC')
        AND (
          "status"::text = 'FAILED'
          OR (
            "status"::text = 'COMMITTED'
            AND (
              COALESCE("diagnostics"->>'attentionRequired', '') = 'true'
              OR (
                jsonb_typeof("issues"->'conflicts') = 'array'
                AND jsonb_array_length("issues"->'conflicts') > 0
              )
            )
          )
        )
      ORDER BY "createdAt" DESC
      LIMIT ${ONGOING_SAFETY_SAMPLE_LIMITS.attentionImports}
    `,
    read504TrmFulfilmentSettings(),
  ]);

  const references = [...new Set(collisionRows.map((row) => row.documentReference))];
  const documents = references.length
    ? await prisma.autopartSalesDocument.findMany({
        where: { documentReference: { in: references } },
        select: {
          id: true,
          companyId: true,
          autopartCustomerCode: true,
          documentType: true,
          documentReference: true,
          source: true,
          has504: true,
          hasTrm21qc: true,
          goodsNet: true,
          company: { select: { name: true } },
        },
      })
    : [];

  const collisions = collisionRows.map((group) => {
    const rows = documents.filter(
      (document) =>
        document.documentReference === group.documentReference && document.documentType === group.documentType,
    );
    const ongoingCount = asNumber(group.ongoing);
    return {
      documentReference: group.documentReference,
      documentType: group.documentType,
      ongoingCount,
      historicalCount: asNumber(group.historical),
      classification: ongoingCount > 1 ? "DUPLICATE_ONGOING" : "ONGOING_AND_HISTORICAL",
      rows: rows.map((document) => ({
        id: document.id,
        companyId: document.companyId,
        companyName: document.company?.name ?? null,
        autopartCustomerCode: document.autopartCustomerCode,
        source: document.source,
        has504: document.has504,
        hasTrm21qc: document.hasTrm21qc,
        goodsNet: document.goodsNet?.toString() ?? null,
        authoritativeOngoing: isAuthoritativeOngoingDocument(document),
      })),
    };
  });

  const attentionImports = attentionRuns.map((run) => {
    const issues = (run.issues ?? {}) as {
      error?: string;
      documentReference?: string | null;
      detail?: string;
      conflicts?: Array<{ documentReference?: string; detail?: string }>;
    };
    const needsAttention = run.status === "COMMITTED" || importRunNeedsAttention(run.diagnostics, run.issues);
    const firstConflict = issues.conflicts?.[0];
    return {
      id: run.id,
      feed: run.type === "ONGOING_504" ? "504" : "TRM21QC",
      filename: run.filename,
      status: run.status,
      classification: needsAttention && run.status === "COMMITTED" ? ("NEEDS_ATTENTION" as const) : ("FAILED" as const),
      createdAt: run.createdAt.toISOString(),
      documentReference: issues.documentReference ?? firstConflict?.documentReference ?? null,
      error: issues.error ?? firstConflict?.detail ?? "Import needs attention",
      detail: issues.detail ?? firstConflict?.detail ?? null,
    };
  });
  const attentionTotal = asNumber(attentionTotalRows[0]?.total ?? 0);

  const ongoingDocumentWhere = {
    AND: [
      { OR: [{ has504: true }, { hasTrm21qc: true }] },
      {
        OR: [
          { abOrderId: { not: null } },
          { abOrderNumber: { startsWith: "AB-" } },
          { customerOrderNumber: { startsWith: "AB-" } },
        ],
      },
    ],
  };
  const undispatchedStatuses: OrderStatus[] = ["CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED"];
  const invoiceWhere = {
    externalRef: { not: null },
    order: { archivedAt: null, status: { in: undispatchedStatuses } },
  };
  const [ongoingDocumentTotal, invoiceTotal, candidateOrderRows, ongoingDocs, invoicedOrders] = await Promise.all([
    prisma.autopartSalesDocument.count({ where: ongoingDocumentWhere }),
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM "Order" o
      WHERE o."archivedAt" IS NULL
        AND o."status"::text IN ('CONFIRMED', 'PICKING', 'PARTIALLY_DESPATCHED')
        AND (
          EXISTS (
            SELECT 1 FROM "Invoice" i
            WHERE i."orderId" = o.id AND i."externalRef" IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM "AutopartSalesDocument" d
            WHERE (d."has504" OR d."hasTrm21qc")
              AND (
                d."abOrderId" = o.id
                OR d."abOrderNumber" = o."orderNumber"
                OR d."customerOrderNumber" = o."orderNumber"
              )
          )
        )
    `,
    prisma.autopartSalesDocument.findMany({
      where: ongoingDocumentWhere,
      include: {
        lines: { select: { sku: true, units: true, salesNet: true, documentType: true } },
      },
      take: ONGOING_SAFETY_SAMPLE_LIMITS.documents,
    }),
    prisma.invoice.findMany({
      where: invoiceWhere,
      select: { orderId: true, externalRef: true, order: { select: { orderNumber: true } } },
      take: ONGOING_SAFETY_SAMPLE_LIMITS.invoices,
    }),
  ]);
  const orderIds = new Set<string>();
  const orderNumbers = new Set<string>();
  for (const document of ongoingDocs) {
    if (document.abOrderId) orderIds.add(document.abOrderId);
    const ref = parseExactAbOrderReference(document.customerOrderNumber ?? document.abOrderNumber);
    if (ref) orderNumbers.add(ref);
  }
  for (const invoice of invoicedOrders) {
    if (invoice.orderId) orderIds.add(invoice.orderId);
  }

  const orders = await prisma.order.findMany({
    where: {
      archivedAt: null,
      status: { in: ["CONFIRMED", "PICKING", "PARTIALLY_DESPATCHED"] },
      OR: [
        { id: { in: [...orderIds] } },
        ...(orderNumbers.size ? [{ orderNumber: { in: [...orderNumbers] } }] : []),
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      items: { select: { id: true, sku: true, name: true, qty: true } },
    },
    take: ONGOING_SAFETY_SAMPLE_LIMITS.ordersInspected,
  });

  const undispatchedOrders = orders.map((order) => {
    const related = ongoingDocs.filter((document) => {
      const ref = parseExactAbOrderReference(document.customerOrderNumber ?? document.abOrderNumber);
      return document.abOrderId === order.id || ref === order.orderNumber;
    });
    const invoiceReferences = [
      ...new Set(
        invoicedOrders
          .filter((invoice) => invoice.orderId === order.id)
          .map((invoice) => invoice.externalRef)
          .filter((ref): ref is string => Boolean(ref)),
      ),
    ];
    const documents: FulfilmentDocumentInput[] = related.map((document) => ({
      id: document.id,
      documentReference: document.documentReference,
      documentType: document.documentType,
      documentDate: document.documentDate,
      createdAt: document.createdAt,
      has504: document.has504,
      hasTrm21qc: document.hasTrm21qc,
      goodsNet: document.goodsNet?.toString() ?? null,
      customerOrderNumber: document.customerOrderNumber,
      abOrderNumber: document.abOrderNumber,
      abOrderId: document.abOrderId,
      lines: document.lines.map((line) => ({
        sku: line.sku,
        units: line.units.toString(),
        salesNet: line.salesNet.toString(),
        documentType: line.documentType,
      })),
    }));
    const evaluation = evaluateOrder504TrmFulfilment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      items: order.items,
      documents,
      fulfilmentFrom: settings.fulfilmentFrom,
    });
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      invoiceReferences,
      documentReferences: related.map((document) => document.documentReference),
      blockingReasons: describeUndispatchedOrder({ invoiceReferences, evaluation }),
    };
  });

  const blockingOrders = undispatchedOrders.filter((order) => order.blockingReasons.length > 0);
  const collisionTotal = asNumber(collisionTotalRows[0]?.total ?? collisions.length);
  const candidateOrders = asNumber(candidateOrderRows[0]?.total ?? orders.length);
  const documentsTruncated = ongoingDocumentTotal > ongoingDocs.length;
  const invoicesTruncated = invoiceTotal > invoicedOrders.length;
  const coverage = describeSafetyReportCoverage({
    collisionTotal,
    collisionShown: collisions.length,
    attentionTotal,
    attentionShown: attentionImports.length,
    candidateOrders,
    inspectedOrders: orders.length,
    blockingInSample: blockingOrders.length,
    blockingShown: Math.min(blockingOrders.length, ONGOING_SAFETY_SAMPLE_LIMITS.ordersShown),
    documentsTruncated,
    invoicesTruncated,
  });

  return {
    readOnly: true as const,
    appliesChanges: false as const,
    sendsEmail: false as const,
    updatesOrders: false as const,
    fulfilmentFrom: settings.fulfilmentFrom?.toISOString() ?? null,
    fulfilmentMode: settings.fulfilmentMode,
    sampleLimits: ONGOING_SAFETY_SAMPLE_LIMITS,
    coverageNote: coverage.note,
    inspectedEveryCandidate: coverage.inspectedEveryCandidate,
    sharedHistoricalReferences: asNumber(sharedHistorical[0]?.sharedReferences ?? 0),
    sharedHistoricalNote:
      "Historical documents may share a reference across companies. Those rows are not duplicates and are not merged.",
    collisions: {
      total: collisionTotal,
      shown: collisions,
      limit: ONGOING_SAFETY_SAMPLE_LIMITS.collisions,
      truncated: collisionTotal > collisions.length,
    },
    attentionImports: {
      total: attentionTotal,
      shown: attentionImports,
      limit: ONGOING_SAFETY_SAMPLE_LIMITS.attentionImports,
      truncated: attentionTotal > attentionImports.length,
    },
    undispatchedOrders: {
      candidateTotal: candidateOrders,
      inspected: orders.length,
      blockingInSample: blockingOrders.length,
      shown: blockingOrders.slice(0, ONGOING_SAFETY_SAMPLE_LIMITS.ordersShown),
      limit: ONGOING_SAFETY_SAMPLE_LIMITS.ordersShown,
      documentsTruncated,
      invoicesTruncated,
      truncated: candidateOrders > orders.length || documentsTruncated || invoicesTruncated,
    },
    recovery: {
      dryRun: true,
      targetFile: "TRM21QC_20261014.csv",
      steps: RECOVERY_STEPS,
    },
  };
}
