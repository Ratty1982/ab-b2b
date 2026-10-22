/**
 * Counted product lines for Sales Enquiry and the reports that must match it.
 *
 * Includes per-customer 561L lines and ongoing TRM21QC lines. The retired global
 * AutopartInvoiceLine table is not read. SLRB payments are documents, not lines.
 * When both sources describe one invoice with the same lines, the TRM21QC copy
 * is kept. When they disagree, neither copy is counted.
 */
import { Prisma } from "@prisma/client";
import {
  ALL_DATED_HISTORY_QUERY_RANGE,
  documentDatePrismaBounds,
  type DateOnlyRange,
} from "@/domain/sales-history-period";

export function rangeIncludesUndatedHistory(range: DateOnlyRange): boolean {
  return (
    range.from <= ALL_DATED_HISTORY_QUERY_RANGE.from &&
    range.to >= ALL_DATED_HISTORY_QUERY_RANGE.to
  );
}

function companyPredicate(
  column: Prisma.Sql,
  companyId: string | { in: string[] } | undefined,
): Prisma.Sql {
  if (typeof companyId === "string") return Prisma.sql`${column} = ${companyId}`;
  if (companyId && "in" in companyId) {
    if (companyId.in.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`${column} IN (${Prisma.join(companyId.in)})`;
  }
  return Prisma.sql`TRUE`;
}

/**
 * WITH clause ending in `counted_sales_lines`. A bounded range omits null dates.
 * The sentinel all-history range keeps undated lines and does not invent a date.
 */
export function countedSalesLinesCte(args: {
  companyId?: string | { in: string[] } | undefined;
  skuEquals?: string | undefined;
  range: DateOnlyRange;
}): Prisma.Sql {
  const bounds = documentDatePrismaBounds(args.range);
  const dateSql = rangeIncludesUndatedHistory(args.range)
    ? Prisma.sql`TRUE`
    : Prisma.sql`d."documentDate" >= ${bounds.gte} AND d."documentDate" <= ${bounds.lte}`;
  const skuSql = args.skuEquals
    ? Prisma.sql`AND UPPER(btrim(p.sku)) = UPPER(${args.skuEquals})`
    : Prisma.empty;
  return Prisma.sql`
    WITH prepared AS (
      SELECT
        l.id,
        l."companyId" AS company_id,
        l."autopartCustomerCode" AS account_code,
        l.sku,
        l.units,
        l."salesNet" AS sales_net,
        l."descriptionSnapshot" AS description,
        l."documentType"::text AS doc_type,
        l."documentReference" AS document_reference,
        NULLIF(UPPER(btrim(l."documentReference")), '') AS doc_ref,
        l.source,
        d."documentDate" AS doc_date,
        UPPER(btrim(l.sku)) AS sku_key,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l.units) ELSE l.units END)::numeric(18, 3) AS signed_qty,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesNet") ELSE l."salesNet" END)::numeric(18, 2) AS signed_net
      FROM "AutopartSalesLine" l
      LEFT JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IS NOT NULL
        AND l.source IN ('561L', 'ONGOING_TRM21QC')
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
        AND ${companyPredicate(Prisma.sql`l."companyId"`, args.companyId)}
        AND ${dateSql}
    ),
    source_doc AS (
      SELECT company_id, doc_ref, source,
        string_agg(
          doc_type || '|' || sku_key || '|' || signed_qty::text || '|' || signed_net::text,
          ';' ORDER BY doc_type, sku_key, signed_qty, signed_net
        ) AS sig
      FROM prepared
      WHERE doc_ref IS NOT NULL
      GROUP BY company_id, doc_ref, source
    ),
    doc_status AS (
      SELECT company_id, doc_ref,
        COUNT(*)::int AS sources,
        COUNT(DISTINCT sig)::int AS signatures,
        CASE WHEN bool_or(source = 'ONGOING_TRM21QC') THEN 'ONGOING_TRM21QC' ELSE '561L' END AS preferred
      FROM source_doc
      GROUP BY company_id, doc_ref
    ),
    preferred_lines AS (
      SELECT p.company_id, p.doc_ref, p.doc_type, SUM(p.signed_net)::numeric(18, 2) AS net
      FROM prepared p
      INNER JOIN doc_status ds ON ds.company_id = p.company_id AND ds.doc_ref = p.doc_ref
      WHERE p.doc_ref IS NOT NULL
        AND (
          ds.sources = 1
          OR (ds.signatures = 1 AND p.source = ds.preferred)
        )
      GROUP BY p.company_id, p.doc_ref, p.doc_type
    ),
    goods_hold AS (
      SELECT h.company_id, h.doc_ref
      FROM (
        SELECT
          d."companyId" AS company_id,
          NULLIF(UPPER(btrim(d."documentReference")), '') AS doc_ref,
          d."documentType"::text AS doc_type,
          d."goodsNet"::numeric(18, 2) AS goods_net
        FROM "AutopartSalesDocument" d
        WHERE d."has504" = TRUE
          AND d."companyId" IS NOT NULL
          AND ${companyPredicate(Prisma.sql`d."companyId"`, args.companyId)}
      ) h
      LEFT JOIN preferred_lines pl
        ON pl.company_id = h.company_id AND pl.doc_ref = h.doc_ref AND pl.doc_type = h.doc_type
      WHERE h.doc_ref IS NOT NULL
        AND (pl.net IS NULL OR h.goods_net IS NULL OR ABS(h.goods_net - pl.net) > 0.01)
      GROUP BY h.company_id, h.doc_ref
    ),
    counted_sales_lines AS (
      SELECT p.*
      FROM prepared p
      LEFT JOIN doc_status ds ON ds.company_id = p.company_id AND ds.doc_ref = p.doc_ref
      WHERE (
          p.doc_ref IS NULL
          OR ds.sources = 1
          OR (ds.signatures = 1 AND p.source = ds.preferred)
        )
        AND NOT EXISTS (
          SELECT 1 FROM goods_hold g
          WHERE g.company_id = p.company_id AND g.doc_ref = p.doc_ref
        )
        ${skuSql}
    )
  `;
}
