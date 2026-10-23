/**
 * Paginated customer orders, quotes, invoices, and document references.
 * Company id is the ownership key. Another company's id returns nothing.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireCompanyPermission } from "@/server/rbac/guards";
import { requireTradePortalCompany } from "@/server/portal/dashboard";

const pageSchema = z.object({
  companyId: z.string().cuid(),
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
});

type PageInput = z.infer<typeof pageSchema>;

function window(input: PageInput) {
  const page = input.page;
  const pageSize = input.pageSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function like(q: string | undefined) {
  const trimmed = q?.trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[%_]/g, "")}%`;
}

export async function listCompanyOrders(actorUserId: string, raw: unknown) {
  const input = pageSchema.parse(raw);
  await requireCompanyPermission(actorUserId, input.companyId, "orders.view");
  const { page, pageSize, skip, take } = window(input);
  const q = like(input.q);
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  const status = input.status && input.status !== "ALL" ? input.status : null;

  const where = Prisma.sql`
    o."companyId" = ${input.companyId}
    AND o."archivedAt" IS NULL
    AND o."status" <> 'DRAFT'
    AND (${status}::text IS NULL OR o."status"::text = ${status})
    AND (${from}::timestamp IS NULL OR COALESCE(o."placedAt", o."createdAt") >= ${from})
    AND (${to}::timestamp IS NULL OR COALESCE(o."placedAt", o."createdAt") <= ${to})
    AND (
      ${q}::text IS NULL
      OR o."orderNumber" ILIKE ${q}
      OR COALESCE(o."poNumber", '') ILIKE ${q}
      OR COALESCE(o."externalRef", '') ILIKE ${q}
      OR COALESCE(o."autopartCustomerCodeSnapshot", '') ILIKE ${q}
    )
  `;

  const [countRows, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM "Order" o WHERE ${where}
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        orderNumber: string;
        placedAt: Date | null;
        status: string;
        entrySource: string | null;
        grandTotal: string;
        lineCount: number;
        exportStatus: string;
        externalRef: string | null;
        outstandingQty: number;
        despatchedQty: number;
        orderedQty: number;
        invoiceCount: number;
        manualResolutionKind: string;
        invoiceEvidence: string;
      }>
    >`
      SELECT
        o."id",
        o."orderNumber",
        o."placedAt",
        o."status"::text AS status,
        o."entrySource"::text AS "entrySource",
        o."grandTotal"::text AS "grandTotal",
        o."autopartExportStatus"::text AS "exportStatus",
        o."externalRef",
        o."manualResolutionKind"::text AS "manualResolutionKind",
        o."invoiceEvidence"::text AS "invoiceEvidence",
        COALESCE(lines."lineCount", 0)::int AS "lineCount",
        COALESCE(lines."orderedQty", 0)::int AS "orderedQty",
        COALESCE(lines."despatchedQty", 0)::int AS "despatchedQty",
        COALESCE(lines."outstandingQty", 0)::int AS "outstandingQty",
        COALESCE(inv."invoiceCount", 0)::int AS "invoiceCount"
      FROM "Order" o
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS "lineCount",
          COALESCE(SUM(i."qty"), 0) AS "orderedQty",
          COALESCE(SUM(i."despatchedQty"), 0) AS "despatchedQty",
          COALESCE(SUM(GREATEST(i."qty" - i."despatchedQty", 0)), 0) AS "outstandingQty"
        FROM "OrderItem" i
        WHERE i."orderId" = o."id"
      ) lines ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS "invoiceCount" FROM "Invoice" inv WHERE inv."orderId" = o."id"
      ) inv ON true
      WHERE ${where}
      ORDER BY COALESCE(o."placedAt", o."createdAt") DESC, o."id" DESC
      LIMIT ${take} OFFSET ${skip}
    `,
  ]);

  return {
    page,
    pageSize,
    total: countRows[0]?.total ?? 0,
    items: rows.map((row) => ({
      ...row,
      placedAt: row.placedAt?.toISOString() ?? null,
      source: row.entrySource ? `Staff · ${row.entrySource}` : "Portal or quote",
    })),
  };
}

export async function listCompanyQuotes(actorUserId: string, raw: unknown) {
  const input = pageSchema.parse(raw);
  await requireCompanyPermission(actorUserId, input.companyId, "quotes.view");
  const { page, pageSize, skip, take } = window(input);
  const q = input.q?.trim();
  const quoteStatuses = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "REJECTED", "EXPIRED", "CANCELLED", "CONVERTED"] as const;
  const status = input.status && (quoteStatuses as readonly string[]).includes(input.status) ? input.status : null;
  const where: Prisma.QuoteWhereInput = {
    companyId: input.companyId,
    ...(status ? { status: status as (typeof quoteStatuses)[number] } : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { quoteNumber: { contains: q, mode: "insensitive" } },
            { poNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        quoteNumber: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        grandTotal: true,
        createdById: true,
        convertedOrderId: true,
        poNumber: true,
      },
    }),
  ]);
  const userIds = [...new Set(rows.map((row) => row.createdById).filter((id): id is string => Boolean(id)))];
  const orderIds = [...new Set(rows.map((row) => row.convertedOrderId).filter((id): id is string => Boolean(id)))];
  const [users, orders] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.order.findMany({
          where: { id: { in: orderIds }, companyId: input.companyId },
          select: { id: true, orderNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name ?? user.email]));
  const orderNumber = new Map(orders.map((order) => [order.id, order.orderNumber]));
  return {
    page,
    pageSize,
    total,
    items: rows.map((row) => ({
      id: row.id,
      quoteNumber: row.quoteNumber,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      grandTotal: String(row.grandTotal),
      createdBy: row.createdById ? (userName.get(row.createdById) ?? "Staff") : "—",
      orderId: row.convertedOrderId,
      orderNumber: row.convertedOrderId ? (orderNumber.get(row.convertedOrderId) ?? null) : null,
      poNumber: row.poNumber,
    })),
  };
}

export async function listCompanyInvoices(actorUserId: string, raw: unknown) {
  const input = pageSchema.parse(raw);
  await requireCompanyPermission(actorUserId, input.companyId, "invoices.view");
  return queryInvoices(input);
}

export async function listPortalInvoices(actorUserId: string, raw: unknown) {
  const { company } = await requireTradePortalCompany(actorUserId);
  await requireCompanyPermission(actorUserId, company.id, "invoices.view");
  const input = pageSchema.parse({ ...(typeof raw === "object" && raw ? raw : {}), companyId: company.id });
  return queryInvoices(input);
}

async function queryInvoices(input: PageInput) {
  const { page, pageSize, skip, take } = window(input);
  const q = like(input.q);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      origin: string;
      number: string;
      documentType: string;
      issuedAt: Date | null;
      value: string | null;
      orderId: string | null;
      orderNumber: string | null;
      source: string;
      status: string | null;
      total: number;
    }>
  >`
    WITH combined AS (
      SELECT
        i."id",
        'B2B'::text AS origin,
        i."invoiceNumber" AS number,
        COALESCE(i."autopartDocumentKind"::text, 'INVOICE') AS "documentType",
        COALESCE(i."issuedAt", i."createdAt") AS "issuedAt",
        i."grandTotal"::text AS value,
        i."orderId",
        o."orderNumber",
        CASE WHEN i."externalRef" IS NULL THEN 'B2B invoice' ELSE 'B2B invoice' END AS source,
        i."status"::text AS status
      FROM "Invoice" i
      LEFT JOIN "Order" o ON o."id" = i."orderId" AND o."companyId" = i."companyId"
      WHERE i."companyId" = ${input.companyId}
      UNION ALL
      SELECT
        d."id",
        'AUTOPART'::text AS origin,
        d."documentReference" AS number,
        d."documentType"::text AS "documentType",
        COALESCE(d."documentDate", d."createdAt") AS "issuedAt",
        COALESCE(d."grossTotal", d."goodsNet")::text AS value,
        d."abOrderId" AS "orderId",
        ord."orderNumber",
        CASE
          WHEN d."documentType"::text = 'CREDIT' THEN 'Autopart credit'
          ELSE 'Autopart invoice'
        END AS source,
        d."reconciliationStatus"::text AS status
      FROM "AutopartSalesDocument" d
      LEFT JOIN "Order" ord ON ord."id" = d."abOrderId" AND ord."companyId" = d."companyId"
      WHERE d."companyId" = ${input.companyId}
        AND d."documentType"::text IN ('INVOICE', 'CREDIT')
        AND NOT EXISTS (
          SELECT 1 FROM "Invoice" i
          WHERE i."companyId" = d."companyId"
            AND i."externalRef" IS NOT NULL
            AND upper(i."externalRef") = upper(d."documentReference")
        )
    ),
    filtered AS (
      SELECT * FROM combined
      WHERE (
        ${q}::text IS NULL
        OR number ILIKE ${q}
        OR COALESCE("orderNumber", '') ILIKE ${q}
      )
    )
    SELECT *, (SELECT COUNT(*)::int FROM filtered) AS total
    FROM filtered
    ORDER BY "issuedAt" DESC NULLS LAST, id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
  const total = rows[0]?.total ?? 0;
  return {
    page,
    pageSize,
    total: rows.length === 0 ? await invoiceTotal(input.companyId, q) : total,
    items: rows.map((row) => ({
      id: row.id,
      origin: row.origin === "B2B" ? "B2B invoice" : row.documentType === "CREDIT" ? "Autopart credit" : "Autopart invoice",
      number: row.number,
      documentType: row.documentType,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      value: row.value,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      source: row.source,
      status: row.status,
      downloadable: false,
    })),
  };
}

async function invoiceTotal(companyId: string, q: string | null) {
  const rows = await prisma.$queryRaw<Array<{ total: number }>>`
    WITH combined AS (
      SELECT i."invoiceNumber" AS number, o."orderNumber"
      FROM "Invoice" i
      LEFT JOIN "Order" o ON o."id" = i."orderId" AND o."companyId" = i."companyId"
      WHERE i."companyId" = ${companyId}
      UNION ALL
      SELECT d."documentReference", ord."orderNumber"
      FROM "AutopartSalesDocument" d
      LEFT JOIN "Order" ord ON ord."id" = d."abOrderId" AND ord."companyId" = d."companyId"
      WHERE d."companyId" = ${companyId}
        AND d."documentType"::text IN ('INVOICE', 'CREDIT')
        AND NOT EXISTS (
          SELECT 1 FROM "Invoice" i
          WHERE i."companyId" = d."companyId"
            AND i."externalRef" IS NOT NULL
            AND upper(i."externalRef") = upper(d."documentReference")
        )
    )
    SELECT COUNT(*)::int AS total FROM combined
    WHERE (${q}::text IS NULL OR number ILIKE ${q} OR COALESCE("orderNumber", '') ILIKE ${q})
  `;
  return rows[0]?.total ?? 0;
}

export async function listCompanyDocuments(actorUserId: string, raw: unknown) {
  const input = pageSchema.parse(raw);
  await requireCompanyPermission(actorUserId, input.companyId, "companies.view");
  const { page, pageSize, skip, take } = window(input);
  const q = like(input.q);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      kind: string;
      title: string;
      at: Date | null;
      source: string;
      recordKind: string;
      total: number;
    }>
  >`
    WITH docs AS (
      SELECT d."id", 'FILE'::text AS kind, d."fileName" AS title, d."createdAt" AS at,
             'Customer file'::text AS source, 'FILE'::text AS "recordKind"
      FROM "Document" d
      WHERE d."companyId" = ${input.companyId}
      UNION ALL
      SELECT q."id", 'QUOTE', q."quoteNumber", q."createdAt", 'Quote', 'QUOTE'
      FROM "Quote" q
      WHERE q."companyId" = ${input.companyId}
      UNION ALL
      SELECT o."id", 'ORDER', o."orderNumber", COALESCE(o."placedAt", o."createdAt"), 'Order', 'ORDER'
      FROM "Order" o
      WHERE o."companyId" = ${input.companyId} AND o."archivedAt" IS NULL AND o."status"::text <> 'DRAFT'
      UNION ALL
      SELECT i."id", 'INVOICE', i."invoiceNumber", COALESCE(i."issuedAt", i."createdAt"), 'B2B invoice', 'INVOICE'
      FROM "Invoice" i
      WHERE i."companyId" = ${input.companyId}
      UNION ALL
      SELECT a."id", 'AUTOPART', a."documentReference", COALESCE(a."documentDate", a."createdAt"),
             CASE WHEN a."documentType"::text = 'CREDIT' THEN 'Autopart credit' ELSE 'Autopart invoice' END,
             'AUTOPART'
      FROM "AutopartSalesDocument" a
      WHERE a."companyId" = ${input.companyId}
        AND a."documentType"::text IN ('INVOICE', 'CREDIT')
        AND NOT EXISTS (
          SELECT 1 FROM "Invoice" i
          WHERE i."companyId" = a."companyId"
            AND i."externalRef" IS NOT NULL
            AND upper(i."externalRef") = upper(a."documentReference")
        )
    ),
    filtered AS (
      SELECT * FROM docs
      WHERE (${q}::text IS NULL OR title ILIKE ${q} OR source ILIKE ${q})
    )
    SELECT *, (SELECT COUNT(*)::int FROM filtered) AS total
    FROM filtered
    ORDER BY at DESC NULLS LAST, id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
  return {
    page,
    pageSize,
    total: rows[0]?.total ?? 0,
    uploadAvailable: false,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      at: row.at?.toISOString() ?? null,
      source: row.source,
      recordKind: row.recordKind,
      downloadable: false,
    })),
  };
}

export function assertSameCompany(recordCompanyId: string | null, requestedCompanyId: string) {
  if (recordCompanyId !== requestedCompanyId) {
    throw new AuthError("Record not found", "NOT_FOUND", 404);
  }
}
