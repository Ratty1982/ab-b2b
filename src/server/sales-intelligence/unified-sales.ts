/**
 * Unified customer sales — one read-only reporting layer over every Autopart sales source.
 *
 * Nothing is copied or rewritten. Each query builds the same reconciled line set in SQL:
 *
 * 1. Identity: an account code belongs to a CRM company only through an explicit link —
 *    a verified primary code, a verified alias, or an AutopartAccount row linked to the company.
 *    Codes linked to more than one company are excluded and listed for reconciliation.
 *    Names are never used.
 * 2. Lines: global 561L AutopartInvoiceLine rows (undated) for linked codes, plus dated
 *    AutopartSalesLine rows (per-company 561L/SLRB import and the TRM21QC feed) for the company,
 *    including feed lines still waiting for a company whose exact code is now linked.
 * 3. Overlap: lines are grouped per company + document reference and source. When a reference
 *    appears in more than one source (global 561L, company 561L/SLRB import, TRM21QC feed), one copy
 *    is counted — TRM21QC, then company import, then global 561L — and the others are suppressed,
 *    only when every source agrees on every line (type, SKU, signed qty, signed net). Otherwise all
 *    copies are UNRECONCILED and stay out of certified totals.
 * 4. Repeated identical 561L rows (same account, Inv & Ln, part, qty and sales) beyond the first
 *    are UNRECONCILED, so a repeated export row can never add sales. A different Inv & Ln, part,
 *    quantity or amount is a separate line and stays counted.
 * 5. 504 goods headers are not product lines. They are never added to the line total. A header that
 *    differs from the counted lines by more than 1p, or a header with no lines, is UNRECONCILED.
 *
 * SLRB ledger rows (payments, receipts, balances) and native B2B orders are never read here.
 * Dated Sales Intelligence modules keep using dated rows only; undated 561L never reaches them.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { buildCsv } from "@/domain/sales-intelligence";
import {
  DATE_UNAVAILABLE,
  UNIFIED_TX_DATING,
  UNIFIED_TX_STATUS,
  UNIFIED_TX_TYPES,
  SOURCE_IDENTITY_CHUNK,
  certifyUnifiedTotals,
  dayAfter,
  effectiveDating,
  parseIsoDay,
  purchaseFrequencyDays,
  purchaseFrequencyLabel,
  unifiedReasonLabel,
  unifiedSourceLabel,
  unifiedStatusLabel,
  type UnifiedCertification,
} from "@/domain/unified-sales";
import {
  dashboardScanBounds,
  monthLabel,
  periodMovement,
  resolveSalesEnquiryDashboardPeriod,
  salesEnquiryDashboardKey,
  SALES_ENQUIRY_DASHBOARD_PERIODS,
  type ResolvedSalesEnquiryDashboard,
} from "@/domain/sales-enquiry-dashboard";
import {
  assertCompanyInScope,
  csvSafe,
  customer360Href,
  decimalString,
  enrichProducts,
  likeContains,
  loadScope,
  productWorkspaceHref,
  requireSalesIntelligence,
} from "@/server/sales-intelligence/global-history";
import { hasReportDb, reportDb, withReportSql } from "@/server/sales-intelligence/report-guard";

const AUTOPART_SOURCE = "AUTOPART";
const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 20_000;

type CompanyUniverse = string[] | "all";

function companyIn(universe: CompanyUniverse, column: Prisma.Sql): Prisma.Sql {
  if (universe === "all") return Prisma.sql`TRUE`;
  if (universe.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} IN (${Prisma.join(universe)})`;
}

function normalisedSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Account-code identity for the reconciled line set.
 * A single company only contributes its own codes, then those codes are dropped when any other
 * company also owns them. An all-company report still builds the map once.
 * `idmap` is materialised so later joins do not rebuild it.
 */
function identityMapSql(universe: CompanyUniverse): Prisma.Sql {
  if (universe !== "all" && universe.length === 0) {
    return Prisma.sql`
    idmap AS (
      SELECT NULL::text AS code, NULL::text AS company_id WHERE FALSE
    )`;
  }
  if (universe === "all") {
    return Prisma.sql`
    idmap_raw AS (
      SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
      FROM "Company" c
      WHERE c."autopartCustomerCode" IS NOT NULL
        AND c."autopartCustomerCodeVerifiedAt" IS NOT NULL
      UNION ALL
      SELECT UPPER(btrim(al."alias")), al."companyId"
      FROM "AutopartCustomerAccountAlias" al
      UNION ALL
      SELECT UPPER(btrim(a."accountCode")), a."companyId"
      FROM "AutopartAccount" a
      WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
        AND a."companyId" IS NOT NULL
    ),
    idmap AS MATERIALIZED (
      SELECT code, MIN(company_id) AS company_id
      FROM idmap_raw
      WHERE code <> ''
      GROUP BY code
      HAVING COUNT(DISTINCT company_id) = 1
    )`;
  }
  const ids = Prisma.join(universe);
  return Prisma.sql`
    idmap_candidates AS MATERIALIZED (
      SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
      FROM "Company" c
      WHERE c.id IN (${ids})
        AND c."autopartCustomerCode" IS NOT NULL
        AND c."autopartCustomerCodeVerifiedAt" IS NOT NULL
      UNION ALL
      SELECT UPPER(btrim(al."alias")), al."companyId"
      FROM "AutopartCustomerAccountAlias" al
      WHERE al."companyId" IN (${ids})
      UNION ALL
      SELECT UPPER(btrim(a."accountCode")), a."companyId"
      FROM "AutopartAccount" a
      WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
        AND a."companyId" IN (${ids})
    ),
    idmap_owner_counts AS (
      SELECT owners.code, COUNT(DISTINCT owners.company_id)::int AS companies
      FROM (
        SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
        FROM "Company" c
        WHERE c."autopartCustomerCodeVerifiedAt" IS NOT NULL
          AND UPPER(btrim(c."autopartCustomerCode")) IN (
            SELECT code FROM idmap_candidates WHERE code <> ''
          )
        UNION ALL
        SELECT UPPER(btrim(al."alias")), al."companyId"
        FROM "AutopartCustomerAccountAlias" al
        WHERE UPPER(btrim(al."alias")) IN (
          SELECT code FROM idmap_candidates WHERE code <> ''
        )
        UNION ALL
        SELECT UPPER(btrim(a."accountCode")), a."companyId"
        FROM "AutopartAccount" a
        WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
          AND a."companyId" IS NOT NULL
          AND UPPER(btrim(a."accountCode")) IN (
            SELECT code FROM idmap_candidates WHERE code <> ''
          )
      ) owners
      WHERE owners.code <> ''
      GROUP BY owners.code
    ),
    idmap AS MATERIALIZED (
      SELECT c.code, MIN(c.company_id) AS company_id
      FROM idmap_candidates c
      INNER JOIN idmap_owner_counts o ON o.code = c.code AND o.companies = 1
      WHERE c.code <> ''
      GROUP BY c.code
    )`;
}

/**
 * Builds the reconciled line set `u` as a WITH clause.
 * `sku` restricts the work to documents that contain that SKU on either side, so whole documents
 * are still compared and product enquiries do not scan every invoice.
 * Heavy steps are MATERIALIZED so PostgreSQL computes them once per statement.
 */
type DatedWindow = { from: Date; toExclusive: Date };

/**
 * Optional dated window. When set, dated lines and 504 headers are limited to that
 * document-date range at source. Undated 561L history is included only when its
 * document reference also appears on a dated line for the same company in the window,
 * so overlap rules still hold and undated nets are not given a month.
 */
function unifiedLinesCte(
  universe: CompanyUniverse,
  sku: string | null,
  window?: DatedWindow,
): Prisma.Sql {
  const skuKey = sku ? normalisedSku(sku) : null;
  const skuRefs = skuKey
    ? Prisma.sql`
      sku_refs AS (
        SELECT l."documentReference" AS ref
        FROM "AutopartInvoiceLine" l
        WHERE UPPER(btrim(l."partNumber")) = ${skuKey}
          AND l."documentReference" IS NOT NULL
        UNION
        SELECT l."documentReference" AS ref
        FROM "AutopartSalesLine" l
        WHERE UPPER(btrim(l."sku")) = ${skuKey}
      ),`
    : Prisma.empty;
  const hFrom = skuKey
    ? Prisma.sql`
      FROM (
        SELECT l.id
        FROM "AutopartInvoiceLine" l
        WHERE l."salesMeasure" = 'NET_EX_VAT'
          AND UPPER(btrim(l."partNumber")) = ${skuKey}
        UNION
        SELECT l.id
        FROM "AutopartInvoiceLine" l
        WHERE l."salesMeasure" = 'NET_EX_VAT'
          AND l."documentReference" IN (SELECT ref FROM sku_refs)
      ) picked
      INNER JOIN "AutopartInvoiceLine" l ON l.id = picked.id
      INNER JOIN idmap im ON im.code = UPPER(btrim(l."accountCode"))`
    : Prisma.sql`
      FROM idmap im
      INNER JOIN "AutopartInvoiceLine" l
        ON UPPER(btrim(l."accountCode")) = im.code
       AND l."salesMeasure" = 'NET_EX_VAT'`;
  const dRestrict = skuKey
    ? Prisma.sql`l."documentReference" IN (SELECT ref FROM sku_refs)`
    : Prisma.sql`TRUE`;
  const lineDocDates = window
    ? Prisma.sql`AND doc."documentDate" >= ${window.from} AND doc."documentDate" < ${window.toExclusive}`
    : Prisma.empty;
  const headerDocDates = window
    ? Prisma.sql`AND d."documentDate" >= ${window.from} AND d."documentDate" < ${window.toExclusive}`
    : Prisma.empty;
  const historicalOverlap = window
    ? Prisma.sql`AND EXISTS (
        SELECT 1
        FROM "AutopartSalesLine" sl
        INNER JOIN "AutopartSalesDocument" sdoc ON sdoc.id = sl."documentId"
        WHERE NULLIF(UPPER(btrim(sl."documentReference")), '') = NULLIF(UPPER(btrim(COALESCE(l."documentReference", ''))), '')
          AND sdoc."documentDate" >= ${window.from}
          AND sdoc."documentDate" < ${window.toExclusive}
          AND (
            sl."companyId" = im.company_id
            OR (
              sl."companyId" IS NULL
              AND UPPER(btrim(sl."autopartCustomerCode")) = im.code
            )
          )
      )`
    : Prisma.empty;
  const dColumns = Prisma.sql`
      l.id AS line_id,
      CASE WHEN l."source" = 'ONGOING_TRM21QC' THEN 'TRM21QC_FEED' ELSE 'COMPANY_561L_SLRB' END AS source,
      UPPER(btrim(l."autopartCustomerCode")) AS account_code,
      l."documentType"::text AS doc_type,
      NULLIF(UPPER(btrim(l."documentReference")), '') AS doc_ref,
      UPPER(btrim(l."sku")) AS sku,
      l."descriptionSnapshot" AS description,
      (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."units") ELSE l."units" END)::numeric(18, 3) AS qty,
      (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesNet") ELSE l."salesNet" END)::numeric(18, 2) AS net,
      doc."documentDate" AS doc_date`;
  return Prisma.sql`
    WITH
    ${identityMapSql(universe)},
    ${skuRefs}
    h_raw AS (
      SELECT
        im.company_id,
        l.id AS line_id,
        'HISTORICAL_561L'::text AS source,
        UPPER(btrim(l."accountCode")) AS account_code,
        CASE WHEN l."documentType" IN ('INVOICE', 'CREDIT') THEN l."documentType" ELSE 'UNKNOWN' END AS doc_type,
        NULLIF(UPPER(btrim(COALESCE(l."documentReference", ''))), '') AS doc_ref,
        UPPER(btrim(l."partNumber")) AS sku,
        l."description" AS description,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."quantity") ELSE l."quantity" END)::numeric(18, 3) AS qty,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesAmount") ELSE l."salesAmount" END)::numeric(18, 2) AS net,
        NULL::timestamp(3) AS doc_date,
        ROW_NUMBER() OVER (
          PARTITION BY UPPER(btrim(l."accountCode")), l."rawInvAndLn", UPPER(btrim(l."partNumber")), l."quantity", l."salesAmount"
          ORDER BY l.id
        ) AS repeat_no
      ${hFrom}
      ${historicalOverlap}
    ),
    d_raw AS (
      SELECT l."companyId" AS company_id, ${dColumns}
      FROM "AutopartSalesLine" l
      LEFT JOIN "AutopartSalesDocument" doc ON doc.id = l."documentId"
      WHERE l."companyId" IS NOT NULL
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
        AND ${companyIn(universe, Prisma.sql`l."companyId"`)}
        AND ${dRestrict}
        ${lineDocDates}
      UNION ALL
      SELECT im.company_id AS company_id, ${dColumns}
      FROM "AutopartSalesLine" l
      INNER JOIN idmap im ON im.code = UPPER(btrim(l."autopartCustomerCode"))
      LEFT JOIN "AutopartSalesDocument" doc ON doc.id = l."documentId"
      WHERE l."companyId" IS NULL
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
        AND ${companyIn(universe, Prisma.sql`im.company_id`)}
        AND ${dRestrict}
        ${lineDocDates}
    ),
    all_raw AS MATERIALIZED (
      SELECT company_id, line_id, source, account_code, doc_type, doc_ref, sku, description,
        qty, net, doc_date, repeat_no
      FROM h_raw
      UNION ALL
      SELECT company_id, line_id, source, account_code, doc_type, doc_ref, sku, description,
        qty, net, doc_date, 1::bigint AS repeat_no
      FROM d_raw
    ),
    source_doc AS (
      SELECT company_id, doc_ref, source,
        string_agg(doc_type || '|' || sku || '|' || qty::text || '|' || net::text, ';' ORDER BY doc_type, sku, qty, net) AS sig
      FROM all_raw
      WHERE doc_ref IS NOT NULL AND repeat_no = 1
      GROUP BY company_id, doc_ref, source
    ),
    doc_status AS (
      SELECT company_id, doc_ref,
        COUNT(*)::int AS sources,
        COUNT(DISTINCT sig)::int AS signatures,
        CASE
          WHEN bool_or(source = 'TRM21QC_FEED') THEN 'TRM21QC_FEED'
          WHEN bool_or(source = 'COMPANY_561L_SLRB') THEN 'COMPANY_561L_SLRB'
          ELSE 'HISTORICAL_561L'
        END AS preferred
      FROM source_doc
      GROUP BY company_id, doc_ref
    ),
    pref_lines AS (
      SELECT r.company_id, r.doc_ref, r.doc_type, SUM(r.net)::numeric(18, 2) AS net
      FROM all_raw r
      INNER JOIN doc_status ds ON ds.company_id = r.company_id AND ds.doc_ref = r.doc_ref
      WHERE r.repeat_no = 1 AND r.source = ds.preferred AND r.doc_ref IS NOT NULL
      GROUP BY r.company_id, r.doc_ref, r.doc_type
    ),
    headers AS (
      SELECT
        COALESCE(d."companyId", im.company_id) AS company_id,
        d.id AS doc_id,
        NULLIF(UPPER(btrim(d."documentReference")), '') AS doc_ref,
        d."documentType"::text AS doc_type,
        UPPER(btrim(d."autopartCustomerCode")) AS account_code,
        d."goodsNet"::numeric(18, 2) AS goods_net,
        d."documentDate" AS doc_date
      FROM "AutopartSalesDocument" d
      LEFT JOIN idmap im ON im.code = UPPER(btrim(d."autopartCustomerCode"))
      WHERE d."has504" = TRUE
        AND COALESCE(d."companyId", im.company_id) IS NOT NULL
        AND ${companyIn(universe, Prisma.sql`COALESCE(d."companyId", im.company_id)`)}
        ${headerDocDates}
    ),
    goods_flag AS (
      SELECT h.company_id, h.doc_ref,
        bool_or(
          pl.net IS NULL
          OR h.goods_net IS NULL
          OR ABS(h.goods_net - pl.net) > 0.01
        ) AS hold
      FROM headers h
      LEFT JOIN pref_lines pl
        ON pl.company_id = h.company_id AND pl.doc_ref = h.doc_ref AND pl.doc_type = h.doc_type
      WHERE h.doc_ref IS NOT NULL
      GROUP BY h.company_id, h.doc_ref
    ),
    u AS MATERIALIZED (
      SELECT
        r.company_id, r.line_id, r.source, r.account_code, r.doc_type, r.doc_ref, r.sku, r.description,
        r.qty, r.net, r.doc_date,
        CASE
          WHEN r.repeat_no > 1 THEN 'UNRECONCILED'
          WHEN r.source = 'HISTORICAL_561L' AND (r.doc_ref IS NULL OR r.doc_type = 'UNKNOWN') THEN 'UNRECONCILED'
          WHEN gf.hold AND (r.doc_ref IS NULL OR ds.sources = 1 OR ds.signatures = 1) THEN 'UNRECONCILED'
          WHEN r.doc_ref IS NULL OR ds.sources = 1 THEN
            CASE WHEN r.source = 'HISTORICAL_561L' THEN 'HISTORICAL' ELSE 'DATED' END
          WHEN ds.signatures = 1 THEN
            CASE WHEN r.source = ds.preferred THEN 'MATCHED' ELSE 'DUPLICATE' END
          ELSE 'UNRECONCILED'
        END AS status,
        CASE
          WHEN r.repeat_no > 1 THEN 'REPEATED_SOURCE_ROW'
          WHEN r.source = 'HISTORICAL_561L' AND r.doc_ref IS NULL THEN 'NO_DOCUMENT_REFERENCE'
          WHEN r.source = 'HISTORICAL_561L' AND r.doc_type = 'UNKNOWN' THEN 'UNKNOWN_DOCUMENT_TYPE'
          WHEN gf.hold AND (r.doc_ref IS NULL OR ds.sources IS NULL OR ds.sources = 1 OR ds.signatures = 1)
            THEN 'DOCUMENT_GOODS_MISMATCH'
          WHEN r.doc_ref IS NULL OR ds.sources = 1 OR ds.signatures = 1 THEN NULL
          ELSE 'CONFLICTING_OVERLAP'
        END AS reason
      FROM all_raw r
      LEFT JOIN doc_status ds ON ds.company_id = r.company_id AND ds.doc_ref = r.doc_ref
      LEFT JOIN goods_flag gf ON gf.company_id = r.company_id AND gf.doc_ref = r.doc_ref
      UNION ALL
      SELECT
        h.company_id, h.doc_id, 'ONGOING_504'::text, h.account_code, h.doc_type, h.doc_ref,
        ''::text, '504 goods header with no product lines'::text,
        0::numeric(18, 3), COALESCE(h.goods_net, 0)::numeric(18, 2), h.doc_date,
        'UNRECONCILED'::text, 'DOCUMENT_GOODS_MISMATCH'::text
      FROM headers h
      WHERE h.doc_ref IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM all_raw r
          WHERE r.company_id = h.company_id AND r.doc_ref = h.doc_ref AND r.doc_type = h.doc_type
        )
    )
  `;
}

const COUNTED = Prisma.sql`u.status IN ('HISTORICAL', 'DATED', 'MATCHED')`;
const ADJUSTMENT = Prisma.sql`(u.doc_type = 'CREDIT' OR u.net < 0)`;

export type UnifiedSalesSummary = {
  historicalSales: string;
  datedInvoicedSales: string;
  creditsAndAdjustments: string;
  historicalNet: string;
  datedNet: string;
  certifiedNet: string;
  combinedNet: string | null;
  certification: UnifiedCertification;
  invoiceCount: number;
  creditNoteCount: number;
  lineCount: number;
  productCount: number;
  units: string;
  undatedLineCount: number;
  lastDatedInvoice: string | null;
  unreconciledLines: number;
  unreconciledDocuments: number;
  unreconciledHistoricalNet: string;
  unreconciledDatedNet: string;
  suppressedDuplicateLines: number;
  suppressedDuplicateNet: string;
};

type SummaryRow = {
  historicalSales: Prisma.Decimal | null;
  datedInvoicedSales: Prisma.Decimal | null;
  creditsAndAdjustments: Prisma.Decimal | null;
  historicalNet: Prisma.Decimal | null;
  datedNet: Prisma.Decimal | null;
  certifiedNet: Prisma.Decimal | null;
  invoiceCount: number;
  creditNoteCount: number;
  lineCount: number;
  productCount: number;
  units: Prisma.Decimal | null;
  undatedLineCount: number;
  lastDatedInvoice: Date | null;
  unreconciledLines: number;
  unreconciledDocuments: number;
  unreconciledHistoricalNet: Prisma.Decimal | null;
  unreconciledDatedNet: Prisma.Decimal | null;
  suppressedDuplicateLines: number;
  suppressedDuplicateNet: Prisma.Decimal | null;
};

function isoDay(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toSummary(row: SummaryRow | undefined): UnifiedSalesSummary {
  const certifiedNet = decimalString(row?.certifiedNet, 2);
  const unreconciledLines = Number(row?.unreconciledLines ?? 0);
  const certification = certifyUnifiedTotals({ certifiedNet, unreconciledLines });
  return {
    historicalSales: decimalString(row?.historicalSales, 2),
    datedInvoicedSales: decimalString(row?.datedInvoicedSales, 2),
    creditsAndAdjustments: decimalString(row?.creditsAndAdjustments, 2),
    historicalNet: decimalString(row?.historicalNet, 2),
    datedNet: decimalString(row?.datedNet, 2),
    certifiedNet,
    combinedNet: certification.combinedNet,
    certification: certification.status,
    invoiceCount: Number(row?.invoiceCount ?? 0),
    creditNoteCount: Number(row?.creditNoteCount ?? 0),
    lineCount: Number(row?.lineCount ?? 0),
    productCount: Number(row?.productCount ?? 0),
    units: decimalString(row?.units, 3),
    undatedLineCount: Number(row?.undatedLineCount ?? 0),
    lastDatedInvoice: isoDay(row?.lastDatedInvoice),
    unreconciledLines,
    unreconciledDocuments: Number(row?.unreconciledDocuments ?? 0),
    unreconciledHistoricalNet: decimalString(row?.unreconciledHistoricalNet, 2),
    unreconciledDatedNet: decimalString(row?.unreconciledDatedNet, 2),
    suppressedDuplicateLines: Number(row?.suppressedDuplicateLines ?? 0),
    suppressedDuplicateNet: decimalString(row?.suppressedDuplicateNet, 2),
  };
}

const SUMMARY_SELECT = Prisma.sql`
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'HISTORICAL' AND NOT ${ADJUSTMENT}), 0) AS "historicalSales",
  COALESCE(SUM(u.net) FILTER (WHERE u.status IN ('DATED', 'MATCHED') AND NOT ${ADJUSTMENT}), 0) AS "datedInvoicedSales",
  COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT}), 0) AS "creditsAndAdjustments",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'HISTORICAL'), 0) AS "historicalNet",
  COALESCE(SUM(u.net) FILTER (WHERE u.status IN ('DATED', 'MATCHED')), 0) AS "datedNet",
  COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "certifiedNet",
  COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE')::int AS "invoiceCount",
  COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'CREDIT')::int AS "creditNoteCount",
  COUNT(*) FILTER (WHERE ${COUNTED})::int AS "lineCount",
  COUNT(DISTINCT u.sku) FILTER (WHERE ${COUNTED})::int AS "productCount",
  COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED}), 0) AS units,
  COUNT(*) FILTER (WHERE ${COUNTED} AND u.doc_date IS NULL)::int AS "undatedLineCount",
  MAX(u.doc_date) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE') AS "lastDatedInvoice",
  COUNT(*) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledLines",
  COUNT(DISTINCT COALESCE(u.doc_ref, u.line_id)) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledDocuments",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'UNRECONCILED' AND u.source = 'HISTORICAL_561L'), 0) AS "unreconciledHistoricalNet",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'UNRECONCILED' AND u.source <> 'HISTORICAL_561L'), 0) AS "unreconciledDatedNet",
  COUNT(*) FILTER (WHERE u.status = 'DUPLICATE')::int AS "suppressedDuplicateLines",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'DUPLICATE'), 0) AS "suppressedDuplicateNet"
`;

async function querySummary(companyId: string): Promise<UnifiedSalesSummary> {
  if (!hasReportDb()) {
    return withReportSql(`summary:${companyId}`, () => querySummary(companyId));
  }
  const rows = await reportDb().$queryRaw<SummaryRow[]>`
    ${unifiedLinesCte([companyId], null)}
    SELECT ${SUMMARY_SELECT}
    FROM u
    WHERE u.company_id = ${companyId}
  `;
  return toSummary(rows[0]);
}

/** One scan of a customer's reconciled lines, reused inside the same report transaction. */
async function materializeCompanyLines(companyId: string, window?: DatedWindow): Promise<void> {
  await reportDb().$executeRaw`
    CREATE TEMP TABLE unified_report_lines ON COMMIT DROP AS
    ${unifiedLinesCte([companyId], null, window)}
    SELECT
      company_id, line_id, source, account_code, doc_type, doc_ref, sku, description,
      qty, net, doc_date, status, reason
    FROM u
    WHERE company_id = ${companyId}
  `;
}

async function querySummaryFromReportLines(companyId: string): Promise<UnifiedSalesSummary> {
  const rows = await reportDb().$queryRaw<SummaryRow[]>`
    SELECT ${SUMMARY_SELECT}
    FROM unified_report_lines u
    WHERE u.company_id = ${companyId}
  `;
  return toSummary(rows[0]);
}

export type UnifiedFinancialCertification = {
  linesExamined: number;
  distinctCountedDocuments: number;
  certifiedNet: string;
  rawAttachedNet: string;
  duplicateDocuments: number;
  duplicateNet: string;
  unreconciledDocuments: number;
  unreconciledNet: string;
  repeatedRowsExcluded: number;
  repeatedNetExcluded: string;
  unknownTypeLines: number;
  unknownTypeNet: string;
  missingReferenceLines: number;
  missingReferenceNet: string;
  headerOnlyDocuments: number;
  headerOnlyNet: string;
  unexplainedDiscrepancy: string;
  discrepancyNote: string | null;
  occurrenceLimitation: string;
};

type CertificationRow = {
  linesExamined: number;
  distinctCountedDocuments: number;
  certifiedNet: Prisma.Decimal | null;
  rawAttachedNet: Prisma.Decimal | null;
  duplicateDocuments: number;
  duplicateNet: Prisma.Decimal | null;
  unreconciledDocuments: number;
  unreconciledNet: Prisma.Decimal | null;
  repeatedRowsExcluded: number;
  repeatedNetExcluded: Prisma.Decimal | null;
  unknownTypeLines: number;
  unknownTypeNet: Prisma.Decimal | null;
  missingReferenceLines: number;
  missingReferenceNet: Prisma.Decimal | null;
  headerOnlyDocuments: number;
  headerOnlyNet: Prisma.Decimal | null;
};

/**
 * Read-only certification for one company. Raw attached lines, suppressed duplicates and
 * unreconciled lines are reported separately. Nothing is rewritten to force a match.
 * Repeated, unknown-type and missing-reference amounts are subsets of the unreconciled net.
 */
async function queryCertification(
  universe: CompanyUniverse,
  companyId: string | null,
): Promise<UnifiedFinancialCertification> {
  const companyFilter = companyId
    ? Prisma.sql`WHERE u.company_id = ${companyId}`
    : Prisma.empty;
  const rows = await reportDb().$queryRaw<CertificationRow[]>`
    ${unifiedLinesCte(universe, null)}
    SELECT
      COUNT(*) FILTER (WHERE u.source <> 'ONGOING_504')::int AS "linesExamined",
      COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_ref IS NOT NULL)::int AS "distinctCountedDocuments",
      COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "certifiedNet",
      COALESCE(SUM(u.net) FILTER (WHERE u.source <> 'ONGOING_504'), 0) AS "rawAttachedNet",
      COUNT(DISTINCT u.doc_ref) FILTER (WHERE u.status = 'DUPLICATE' AND u.doc_ref IS NOT NULL)::int AS "duplicateDocuments",
      COALESCE(SUM(u.net) FILTER (WHERE u.status = 'DUPLICATE'), 0) AS "duplicateNet",
      COUNT(DISTINCT COALESCE(u.doc_ref, u.line_id)) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledDocuments",
      COALESCE(SUM(u.net) FILTER (WHERE u.status = 'UNRECONCILED'), 0) AS "unreconciledNet",
      COUNT(*) FILTER (WHERE u.reason = 'REPEATED_SOURCE_ROW')::int AS "repeatedRowsExcluded",
      COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'REPEATED_SOURCE_ROW'), 0) AS "repeatedNetExcluded",
      COUNT(*) FILTER (WHERE u.reason = 'UNKNOWN_DOCUMENT_TYPE')::int AS "unknownTypeLines",
      COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'UNKNOWN_DOCUMENT_TYPE'), 0) AS "unknownTypeNet",
      COUNT(*) FILTER (WHERE u.reason = 'NO_DOCUMENT_REFERENCE')::int AS "missingReferenceLines",
      COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'NO_DOCUMENT_REFERENCE'), 0) AS "missingReferenceNet",
      COUNT(*) FILTER (WHERE u.source = 'ONGOING_504')::int AS "headerOnlyDocuments",
      COALESCE(SUM(u.net) FILTER (WHERE u.source = 'ONGOING_504'), 0) AS "headerOnlyNet"
    FROM u
    ${companyFilter}
  `;
  const row = rows[0];
  const raw = new Prisma.Decimal(row?.rawAttachedNet ?? 0);
  const certified = new Prisma.Decimal(row?.certifiedNet ?? 0);
  const duplicates = new Prisma.Decimal(row?.duplicateNet ?? 0);
  const unreconciled = new Prisma.Decimal(row?.unreconciledNet ?? 0);
  const headerOnly = new Prisma.Decimal(row?.headerOnlyNet ?? 0);
  const unexplained = raw.minus(certified).minus(duplicates).minus(unreconciled.minus(headerOnly));
  const unexplainedDiscrepancy = unexplained.toFixed(2);
  return certificationFromParts(row, unexplainedDiscrepancy);
}

function certificationFromParts(
  row: CertificationRow | undefined,
  unexplainedDiscrepancy: string,
): UnifiedFinancialCertification {
  const raw = new Prisma.Decimal(row?.rawAttachedNet ?? 0);
  const certified = new Prisma.Decimal(row?.certifiedNet ?? 0);
  const duplicates = new Prisma.Decimal(row?.duplicateNet ?? 0);
  const unreconciled = new Prisma.Decimal(row?.unreconciledNet ?? 0);
  const headerOnly = new Prisma.Decimal(row?.headerOnlyNet ?? 0);
  return {
    linesExamined: Number(row?.linesExamined ?? 0),
    distinctCountedDocuments: Number(row?.distinctCountedDocuments ?? 0),
    certifiedNet: certified.toFixed(2),
    rawAttachedNet: raw.toFixed(2),
    duplicateDocuments: Number(row?.duplicateDocuments ?? 0),
    duplicateNet: duplicates.toFixed(2),
    unreconciledDocuments: Number(row?.unreconciledDocuments ?? 0),
    unreconciledNet: unreconciled.toFixed(2),
    repeatedRowsExcluded: Number(row?.repeatedRowsExcluded ?? 0),
    repeatedNetExcluded: new Prisma.Decimal(row?.repeatedNetExcluded ?? 0).toFixed(2),
    unknownTypeLines: Number(row?.unknownTypeLines ?? 0),
    unknownTypeNet: new Prisma.Decimal(row?.unknownTypeNet ?? 0).toFixed(2),
    missingReferenceLines: Number(row?.missingReferenceLines ?? 0),
    missingReferenceNet: new Prisma.Decimal(row?.missingReferenceNet ?? 0).toFixed(2),
    headerOnlyDocuments: Number(row?.headerOnlyDocuments ?? 0),
    headerOnlyNet: headerOnly.toFixed(2),
    unexplainedDiscrepancy,
    discrepancyNote:
      unexplainedDiscrepancy === "0.00"
        ? null
        : "Raw attached lines do not equal certified plus suppressed duplicates plus unreconciled product lines. Historic rows were not rewritten.",
    occurrenceLimitation: `Identical 561L natural keys are numbered inside each ${SOURCE_IDENTITY_CHUNK}-row import chunk. A repeat stored inside that chunk is held as unreconciled and is not certified. The same natural key in a later chunk updates the first stored row instead of creating another, so those extra occurrences are absent and are not invented here.`,
  };
}

/** Read-only certification for one company. Nothing is rewritten to force a match. */
export async function loadUnifiedFinancialCertification(
  companyId: string,
): Promise<UnifiedFinancialCertification> {
  return withReportSql(`cert:${companyId}`, () => queryCertification([companyId], companyId));
}

/** Read-only certification of every uniquely linked account. Does not write. */
export async function loadUnifiedDatabaseCertification(): Promise<UnifiedFinancialCertification> {
  return withReportSql("cert:all", () => queryCertification("all", null));
}

export type UnifiedIdentityCode = {
  code: string;
  via: Array<"PRIMARY_VERIFIED" | "PRIMARY_UNVERIFIED" | "ALIAS" | "ACCOUNT_LINK">;
  attached: boolean;
  note: string | null;
};

/** Verified account codes for one company. Unverified primary codes are listed but never attach 561L history. */
export async function loadUnifiedIdentity(companyId: string): Promise<UnifiedIdentityCode[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: { select: { alias: true } },
      autopartAccounts: { where: { sourceSystem: AUTOPART_SOURCE }, select: { accountCode: true } },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  const byCode = new Map<string, UnifiedIdentityCode>();
  const add = (raw: string | null | undefined, via: UnifiedIdentityCode["via"][number]) => {
    const code = raw?.trim().toUpperCase();
    if (!code) return;
    const entry = byCode.get(code) ?? { code, via: [], attached: false, note: null };
    if (!entry.via.includes(via)) entry.via.push(via);
    byCode.set(code, entry);
  };
  if (company.autopartCustomerCode) {
    add(
      company.autopartCustomerCode,
      company.autopartCustomerCodeVerifiedAt ? "PRIMARY_VERIFIED" : "PRIMARY_UNVERIFIED",
    );
  }
  for (const alias of company.autopartAccountAliases) add(alias.alias, "ALIAS");
  for (const account of company.autopartAccounts) add(account.accountCode, "ACCOUNT_LINK");
  const codes = [...byCode.keys()];
  if (codes.length) {
    const owners = await prisma.$queryRaw<Array<{ code: string; companies: number }>>`
      SELECT code, COUNT(DISTINCT company_id)::int AS companies
      FROM (
        SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
        FROM "Company" c
        WHERE c."autopartCustomerCodeVerifiedAt" IS NOT NULL
          AND UPPER(btrim(c."autopartCustomerCode")) IN (${Prisma.join(codes)})
        UNION ALL
        SELECT UPPER(btrim(al."alias")), al."companyId"
        FROM "AutopartCustomerAccountAlias" al
        WHERE UPPER(btrim(al."alias")) IN (${Prisma.join(codes)})
        UNION ALL
        SELECT UPPER(btrim(a."accountCode")), a."companyId"
        FROM "AutopartAccount" a
        WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
          AND a."companyId" IS NOT NULL
          AND UPPER(btrim(a."accountCode")) IN (${Prisma.join(codes)})
      ) owners
      GROUP BY code
    `;
    const ownerCount = new Map(owners.map((row) => [row.code, Number(row.companies)]));
    for (const entry of byCode.values()) {
      const verified = entry.via.some((via) => via !== "PRIMARY_UNVERIFIED");
      const shared = (ownerCount.get(entry.code) ?? 0) > 1;
      entry.attached = verified && !shared;
      entry.note = shared
        ? "Linked to more than one CRM company. Held for reconciliation and not counted."
        : verified
          ? null
          : "Primary code is not verified. Dated feed rows already assigned still count; 561L history is not attached.";
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export type UnifiedRefreshStatus = {
  ongoing504At: string | null;
  ongoingTrm21qcAt: string | null;
  global561lAt: string | null;
  customerImportAt: string | null;
  latestAt: string | null;
};

export async function loadUnifiedRefreshStatus(
  companyId: string | null,
): Promise<UnifiedRefreshStatus> {
  const [settings, batch, run] = await Promise.all([
    prisma.autopartOngoingSalesFeedSettings.findUnique({
      where: { id: "default" },
      select: { lastSuccess504At: true, lastSuccessTrm21qcAt: true },
    }),
    prisma.autopartImportBatch.findFirst({
      where: { kind: "INVOICE_LINES", status: "COMMITTED", completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.autopartCustomerImportRun.findFirst({
      where: {
        status: "COMMITTED",
        completedAt: { not: null },
        ...(companyId ? { companyId } : {}),
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
  ]);
  const stamps = [
    settings?.lastSuccess504At ?? null,
    settings?.lastSuccessTrm21qcAt ?? null,
    batch?.completedAt ?? null,
    run?.completedAt ?? null,
  ].filter((value): value is Date => value instanceof Date);
  const latest = stamps.length
    ? new Date(Math.max(...stamps.map((value) => value.getTime())))
    : null;
  return {
    ongoing504At: settings?.lastSuccess504At?.toISOString() ?? null,
    ongoingTrm21qcAt: settings?.lastSuccessTrm21qcAt?.toISOString() ?? null,
    global561lAt: batch?.completedAt?.toISOString() ?? null,
    customerImportAt: run?.completedAt?.toISOString() ?? null,
    latestAt: latest?.toISOString() ?? null,
  };
}

export type UnifiedCustomerSummary = {
  identity: UnifiedIdentityCode[];
  summary: UnifiedSalesSummary;
  refresh: UnifiedRefreshStatus;
};

/**
 * The single figure set for a company. Sales Enquiry and both Customer 360 views call this,
 * so their totals always agree. Callers must authorise access to the company first.
 */
export async function loadUnifiedCustomerSummary(
  companyId: string,
): Promise<UnifiedCustomerSummary> {
  const [identity, summary, refresh] = await Promise.all([
    loadUnifiedIdentity(companyId),
    querySummary(companyId),
    loadUnifiedRefreshStatus(companyId),
  ]);
  return { identity, summary, refresh };
}

async function loadCompanyHeader(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      accountNumber: true,
      autopartCustomerCode: true,
      assignments: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: {
          salesRep: {
            select: {
              id: true,
              code: true,
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  const rep = company.assignments[0]?.salesRep;
  return {
    id: company.id,
    name: company.name,
    tradingName: company.tradingName,
    status: company.status,
    accountNumber: company.accountNumber,
    autopartCustomerCode: company.autopartCustomerCode,
    salesperson: rep
      ? { id: rep.id, code: rep.code, name: rep.displayName || rep.user.name || rep.user.email }
      : null,
  };
}

const dashboardSchema = z.object({
  companyId: z.string().min(1),
  period: z.enum(SALES_ENQUIRY_DASHBOARD_PERIODS).optional(),
  from: z.string().max(10).optional().nullable(),
  to: z.string().max(10).optional().nullable(),
});

const CERT_METRICS = Prisma.sql`
  COUNT(*) FILTER (WHERE u.source <> 'ONGOING_504')::int AS "linesExamined",
  COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_ref IS NOT NULL)::int AS "distinctCountedDocuments",
  COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "certifiedNet",
  COALESCE(SUM(u.net) FILTER (WHERE u.source <> 'ONGOING_504'), 0) AS "rawAttachedNet",
  COUNT(DISTINCT u.doc_ref) FILTER (WHERE u.status = 'DUPLICATE' AND u.doc_ref IS NOT NULL)::int AS "duplicateDocuments",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'DUPLICATE'), 0) AS "duplicateNet",
  COUNT(DISTINCT COALESCE(u.doc_ref, u.line_id)) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledDocuments",
  COALESCE(SUM(u.net) FILTER (WHERE u.status = 'UNRECONCILED'), 0) AS "unreconciledNet",
  COUNT(*) FILTER (WHERE u.reason = 'REPEATED_SOURCE_ROW')::int AS "repeatedRowsExcluded",
  COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'REPEATED_SOURCE_ROW'), 0) AS "repeatedNetExcluded",
  COUNT(*) FILTER (WHERE u.reason = 'UNKNOWN_DOCUMENT_TYPE')::int AS "unknownTypeLines",
  COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'UNKNOWN_DOCUMENT_TYPE'), 0) AS "unknownTypeNet",
  COUNT(*) FILTER (WHERE u.reason = 'NO_DOCUMENT_REFERENCE')::int AS "missingReferenceLines",
  COALESCE(SUM(u.net) FILTER (WHERE u.reason = 'NO_DOCUMENT_REFERENCE'), 0) AS "missingReferenceNet",
  COUNT(*) FILTER (WHERE u.source = 'ONGOING_504')::int AS "headerOnlyDocuments",
  COALESCE(SUM(u.net) FILTER (WHERE u.source = 'ONGOING_504'), 0) AS "headerOnlyNet"
`;

async function queryCertificationFromReportLines(): Promise<UnifiedFinancialCertification> {
  const rows = await reportDb().$queryRaw<CertificationRow[]>`
    SELECT ${CERT_METRICS}
    FROM unified_report_lines u
  `;
  const row = rows[0];
  const raw = new Prisma.Decimal(row?.rawAttachedNet ?? 0);
  const certified = new Prisma.Decimal(row?.certifiedNet ?? 0);
  const duplicates = new Prisma.Decimal(row?.duplicateNet ?? 0);
  const unreconciled = new Prisma.Decimal(row?.unreconciledNet ?? 0);
  const headerOnly = new Prisma.Decimal(row?.headerOnlyNet ?? 0);
  const unexplained = raw.minus(certified).minus(duplicates).minus(unreconciled.minus(headerOnly));
  return certificationFromParts(row, unexplained.toFixed(2));
}

function datedPredicate(from: string | null, to: string | null): Prisma.Sql {
  if (!from || !to) return Prisma.sql`TRUE`;
  const bounds = dashboardScanBounds({ from, to });
  return Prisma.sql`u.doc_date >= ${bounds.from} AND u.doc_date < ${bounds.toExclusive}`;
}

type DashboardFigures = {
  netSales: string;
  credits: string;
  units: string;
  invoiceCount: number;
  creditNoteCount: number;
};

function figuresFromRow(row: {
  netSales?: Prisma.Decimal | null;
  credits?: Prisma.Decimal | null;
  units?: Prisma.Decimal | null;
  invoiceCount?: number | null;
  creditNoteCount?: number | null;
}, prefix: "" | "previous" = ""): DashboardFigures {
  if (prefix === "previous") {
    const previous = row as {
      previousNet?: Prisma.Decimal | null;
      previousCredits?: Prisma.Decimal | null;
      previousUnits?: Prisma.Decimal | null;
      previousInvoiceCount?: number | null;
      previousCreditNoteCount?: number | null;
    };
    return {
      netSales: decimalString(previous.previousNet, 2),
      credits: decimalString(previous.previousCredits, 2),
      units: decimalString(previous.previousUnits, 3),
      invoiceCount: Number(previous.previousInvoiceCount ?? 0),
      creditNoteCount: Number(previous.previousCreditNoteCount ?? 0),
    };
  }
  return {
    netSales: decimalString(row.netSales, 2),
    credits: decimalString(row.credits, 2),
    units: decimalString(row.units, 3),
    invoiceCount: Number(row.invoiceCount ?? 0),
    creditNoteCount: Number(row.creditNoteCount ?? 0),
  };
}

async function queryDashboardFromLines(period: ResolvedSalesEnquiryDashboard) {
  const current = datedPredicate(period.from, period.to);
  const previous = period.comparison
    ? datedPredicate(period.comparison.from, period.comparison.to)
    : Prisma.sql`FALSE`;
  const chartBounds = dashboardScanBounds(period.chart);
  const metrics = await reportDb().$queryRaw<
      Array<{
        netSales: Prisma.Decimal | null;
        credits: Prisma.Decimal | null;
        units: Prisma.Decimal | null;
        invoiceCount: number;
        creditNoteCount: number;
        previousNet: Prisma.Decimal | null;
        previousCredits: Prisma.Decimal | null;
        previousUnits: Prisma.Decimal | null;
        previousInvoiceCount: number;
        previousCreditNoteCount: number;
      }>
    >`
      SELECT
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${current}), 0) AS "netSales",
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT} AND ${current}), 0) AS credits,
        COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED} AND ${current}), 0) AS units,
        COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE' AND ${current})::int AS "invoiceCount",
        COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'CREDIT' AND ${current})::int AS "creditNoteCount",
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${previous}), 0) AS "previousNet",
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT} AND ${previous}), 0) AS "previousCredits",
        COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED} AND ${previous}), 0) AS "previousUnits",
        COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE' AND ${previous})::int AS "previousInvoiceCount",
        COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'CREDIT' AND ${previous})::int AS "previousCreditNoteCount"
      FROM unified_report_lines u
    `;
  const trendRows = await reportDb().$queryRaw<Array<{ month: string | null; net: Prisma.Decimal | null }>>`
      SELECT to_char(date_trunc('month', u.doc_date), 'YYYY-MM') AS month,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS net
      FROM unified_report_lines u
      WHERE u.doc_date IS NOT NULL
        AND u.doc_date >= ${chartBounds.from}
        AND u.doc_date < ${chartBounds.toExclusive}
      GROUP BY 1
    `;
  const topRows = await reportDb().$queryRaw<
      Array<{
        sku: string;
        description: string | null;
        netSales: Prisma.Decimal | null;
        units: Prisma.Decimal | null;
        credits: Prisma.Decimal | null;
      }>
    >`
      SELECT u.sku AS sku,
        MAX(u.description) AS description,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "netSales",
        COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED}), 0) AS units,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT}), 0) AS credits
      FROM unified_report_lines u
      WHERE ${current}
        AND u.sku <> ''
      GROUP BY u.sku
      ORDER BY COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) DESC, u.sku ASC
      LIMIT 10
    `;
  const recentRows = await reportDb().$queryRaw<
      Array<{
        lineId: string;
        docDate: Date | null;
        docRef: string | null;
        docType: string;
        sku: string;
        description: string | null;
        qty: Prisma.Decimal;
        net: Prisma.Decimal;
      }>
    >`
      SELECT u.line_id AS "lineId", u.doc_date AS "docDate", u.doc_ref AS "docRef",
        u.doc_type AS "docType", u.sku, u.description, u.qty, u.net
      FROM unified_report_lines u
      WHERE ${COUNTED} AND ${current}
      ORDER BY u.doc_date DESC NULLS LAST, u.doc_ref ASC NULLS LAST, u.sku ASC
      LIMIT 8
    `;
  const metric = metrics[0];
  const kpis = figuresFromRow(metric ?? {});
  const previousFigures = period.comparison ? figuresFromRow(metric ?? {}, "previous") : null;
  const trendByMonth = new Map(
    trendRows.filter((row) => row.month).map((row) => [row.month as string, decimalString(row.net, 2)]),
  );
  return {
    kpis,
    comparison: previousFigures
      ? {
          ...previousFigures,
          label: period.comparison?.label ?? "",
          movement: periodMovement(kpis.netSales, previousFigures.netSales),
        }
      : null,
    trend: period.chart.months.map((month) => ({
      month,
      label: monthLabel(month),
      netSales: trendByMonth.get(month) ?? "0.00",
    })),
    topProducts: topRows.map((row) => ({
      sku: row.sku,
      description: row.description,
      netSales: decimalString(row.netSales, 2),
      units: decimalString(row.units, 3),
      credits: decimalString(row.credits, 2),
    })),
    recentTransactions: recentRows.map((row) => ({
      lineId: row.lineId,
      date: isoDay(row.docDate),
      dateLabel: row.docDate ? isoDay(row.docDate)! : DATE_UNAVAILABLE,
      reference: row.docRef,
      documentType: row.docType,
      sku: row.sku,
      description: row.description,
      qty: decimalString(row.qty, 3),
      net: decimalString(row.net, 2),
    })),
  };
}

export async function getUnifiedCustomerSales(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = dashboardSchema.parse(raw ?? {});
  let period: ResolvedSalesEnquiryDashboard;
  try {
    period = resolveSalesEnquiryDashboardPeriod({
      period: input.period ?? "THIS_MONTH",
      from: input.from,
      to: input.to,
    });
  } catch (error) {
    throw new AuthError(error instanceof Error ? error.message : "Choose a valid reporting period.", "VALIDATION", 400);
  }
  await assertCompanyInScope(profile, input.companyId);
  const [company, identity, refresh, brands] = await Promise.all([
    loadCompanyHeader(input.companyId),
    loadUnifiedIdentity(input.companyId),
    loadUnifiedRefreshStatus(input.companyId),
    prisma.brand.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  const dashboard = await withReportSql(
    salesEnquiryDashboardKey(input.companyId, period.preset, period.from, period.to),
    async () => {
      if (period.scan) await materializeCompanyLines(input.companyId, dashboardScanBounds(period.scan));
      else await materializeCompanyLines(input.companyId);
      return queryDashboardFromLines(period);
    },
  );
  return {
    company: { ...company, customer360Href: customer360Href(profile, company.id) },
    identity,
    refresh,
    brands,
    period: {
      preset: period.preset,
      label: period.label,
      from: period.from,
      to: period.to,
      rangeLabel: period.rangeLabel,
      includesUndatedHistory: period.includesUndatedHistory,
    },
    ...dashboard,
    pricingPermitted: hasPermission(profile, "pricing.view"),
    studleyStockPermitted: hasPermission(profile, "inventory.view"),
  };
}

/** Full certified history. Loaded only when Historical Reporting is opened. */
export async function getUnifiedCustomerHistory(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = z.object({ companyId: z.string().min(1) }).parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const [identity, refresh] = await Promise.all([
    loadUnifiedIdentity(input.companyId),
    loadUnifiedRefreshStatus(input.companyId),
  ]);
  const report = await withReportSql(`customer-history:${input.companyId}`, async () => {
    await materializeCompanyLines(input.companyId);
    const summary = await querySummaryFromReportLines(input.companyId);
    const certification = await queryCertificationFromReportLines();
    return { summary, certification };
  });
  return { identity, refresh, ...report };
}

const txSchema = z.object({
  companyId: z.string().min(1),
  type: z.enum(UNIFIED_TX_TYPES).optional(),
  dating: z.enum(UNIFIED_TX_DATING).optional(),
  status: z.enum(UNIFIED_TX_STATUS).optional(),
  from: z.string().max(10).optional().nullable(),
  to: z.string().max(10).optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  sku: z.string().max(120).optional().nullable(),
  brandId: z.string().min(1).optional().nullable(),
  accountCode: z.string().max(40).optional().nullable(),
  scope: z.enum(["PERIOD", "LIFETIME"]).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(EXPORT_PAGE_SIZE).optional(),
});

type TxInput = z.infer<typeof txSchema>;

function txWhere(input: TxInput): { where: Prisma.Sql; contradiction: boolean } {
  const parts: Prisma.Sql[] = [Prisma.sql`u.company_id = ${input.companyId}`];
  const from = parseIsoDay(input.from);
  const to = parseIsoDay(input.to);
  const dating = effectiveDating({
    dating: input.dating ?? "ALL",
    from: from ? input.from! : null,
    to: to ? input.to! : null,
  });
  switch (input.status ?? "COUNTED") {
    case "COUNTED":
      parts.push(Prisma.sql`u.status <> 'DUPLICATE'`);
      break;
    case "UNRECONCILED":
      parts.push(Prisma.sql`u.status = 'UNRECONCILED'`);
      break;
    case "SUPPRESSED":
      parts.push(Prisma.sql`u.status = 'DUPLICATE'`);
      break;
    default:
      break;
  }
  if (input.type === "INVOICE") parts.push(Prisma.sql`u.doc_type = 'INVOICE'`);
  if (input.type === "CREDIT") parts.push(Prisma.sql`u.doc_type = 'CREDIT'`);
  if (dating.dating === "DATED") parts.push(Prisma.sql`u.doc_date IS NOT NULL`);
  if (dating.dating === "UNDATED") parts.push(Prisma.sql`u.doc_date IS NULL`);
  if (dating.contradiction) parts.push(Prisma.sql`FALSE`);
  if (from) parts.push(Prisma.sql`u.doc_date >= ${from}`);
  if (to) parts.push(Prisma.sql`u.doc_date < ${dayAfter(to)}`);
  if (input.sku?.trim()) parts.push(Prisma.sql`u.sku = ${normalisedSku(input.sku)}`);
  if (input.q?.trim()) {
    const pattern = likeContains(input.q.trim());
    parts.push(Prisma.sql`(
      u.sku ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(u.description, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(u.doc_ref, '') ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  if (input.accountCode?.trim()) {
    parts.push(Prisma.sql`u.account_code = ${input.accountCode.trim().toUpperCase()}`);
  }
  if (input.brandId) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      INNER JOIN "Product" p ON p.id = v."productId"
      WHERE p."brandId" = ${input.brandId} AND UPPER(btrim(v.sku)) = u.sku
    )`);
  }
  return { where: Prisma.join(parts, " AND "), contradiction: dating.contradiction };
}

type TxRow = {
  lineId: string;
  docDate: Date | null;
  docRef: string | null;
  docType: string;
  accountCode: string;
  sku: string;
  description: string | null;
  qty: Prisma.Decimal;
  net: Prisma.Decimal;
  source: string;
  status: string;
  reason: string | null;
};

function transactionReportKey(input: TxInput): string {
  return [
    "tx",
    input.companyId,
    input.page ?? 1,
    input.pageSize ?? 50,
    input.type ?? "",
    input.dating ?? "",
    input.status ?? "",
    input.from ?? "",
    input.to ?? "",
    input.q ?? "",
    input.sku ?? "",
    input.brandId ?? "",
    input.accountCode ?? "",
    input.scope ?? "",
  ].join("|");
}

async function queryTransactions(
  input: TxInput,
  source: "cte" | "temp" = "cte",
): Promise<{
  items: Array<{
    lineId: string;
    date: string | null;
    dateLabel: string;
    reference: string | null;
    documentType: string;
    accountCode: string;
    sku: string;
    description: string | null;
    qty: string;
    net: string;
    source: string;
    sourceLabel: string;
    status: string;
    statusLabel: string;
    reason: string | null;
    reasonLabel: string | null;
    counted: boolean;
  }>;
  page: number;
  pageSize: number;
  total: number;
  filteredCountedNet: string;
  filteredCountedUnits: string;
  dateFilterNote: string | null;
}> {
  if (!hasReportDb()) {
    return withReportSql(transactionReportKey(input), () => queryTransactions(input, "cte"));
  }
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const { where, contradiction } = txWhere(input);
  const filtered =
    source === "temp"
      ? Prisma.sql`
          WITH filtered AS MATERIALIZED (
            SELECT * FROM unified_report_lines u WHERE ${where}
          )`
      : Prisma.sql`
          ${unifiedLinesCte([input.companyId], null)}
          , filtered AS MATERIALIZED (
            SELECT * FROM u WHERE ${where}
          )`;
  const raw = await reportDb().$queryRaw<
    Array<
      TxRow & {
        lineId: string | null;
        total: number;
        countedNet: Prisma.Decimal | null;
        countedQty: Prisma.Decimal | null;
      }
    >
  >`
    ${filtered}
    SELECT
      totals.total,
      totals."countedNet",
      totals."countedQty",
      page."lineId",
      page."docDate",
      page."docRef",
      page."docType",
      page."accountCode",
      page.sku,
      page.description,
      page.qty,
      page.net,
      page.source,
      page.status,
      page.reason
    FROM (
      SELECT COUNT(*)::int AS total,
        COALESCE(SUM(filtered.net) FILTER (WHERE filtered.status IN ('HISTORICAL', 'DATED', 'MATCHED')), 0) AS "countedNet",
        COALESCE(SUM(filtered.qty) FILTER (WHERE filtered.status IN ('HISTORICAL', 'DATED', 'MATCHED')), 0) AS "countedQty"
      FROM filtered
    ) totals
    LEFT JOIN LATERAL (
      SELECT
        filtered.line_id AS "lineId",
        filtered.doc_date AS "docDate",
        filtered.doc_ref AS "docRef",
        filtered.doc_type AS "docType",
        filtered.account_code AS "accountCode",
        filtered.sku,
        filtered.description,
        filtered.qty,
        filtered.net,
        filtered.source,
        filtered.status,
        filtered.reason
      FROM filtered
      ORDER BY filtered.doc_date DESC NULLS LAST, filtered.doc_ref ASC NULLS LAST, filtered.sku ASC, filtered.line_id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ) page ON TRUE
  `;
  const rows = raw.filter((row): row is typeof row & { lineId: string } => row.lineId != null);
  const totals = raw[0];
  return {
    items: rows.map((row) => ({
      lineId: row.lineId,
      date: isoDay(row.docDate),
      dateLabel: row.docDate ? isoDay(row.docDate)! : DATE_UNAVAILABLE,
      reference: row.docRef,
      documentType: row.docType,
      accountCode: row.accountCode,
      sku: row.sku,
      description: row.description,
      qty: decimalString(row.qty, 3),
      net: decimalString(row.net, 2),
      source: row.source,
      sourceLabel: unifiedSourceLabel(row.source),
      status: row.status,
      statusLabel: unifiedStatusLabel(row.status),
      reason: row.reason,
      reasonLabel: unifiedReasonLabel(row.reason),
      counted: row.status === "HISTORICAL" || row.status === "DATED" || row.status === "MATCHED",
    })),
    page,
    pageSize,
    total: Number(totals?.total ?? 0),
    filteredCountedNet: decimalString(totals?.countedNet, 2),
    filteredCountedUnits: decimalString(totals?.countedQty, 3),
    dateFilterNote: contradiction
      ? "A date range only includes dated transactions, so undated rows are not shown."
      : input.from || input.to
        ? "Date range applied. Undated 561L history is excluded."
        : null,
  };
}

function periodWindow(input: {
  scope?: "PERIOD" | "LIFETIME" | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
}): DatedWindow | null {
  if (input.scope !== "PERIOD") return null;
  const from = parseIsoDay(input.from);
  const to = parseIsoDay(input.to);
  if (!from || !to) return null;
  return { from, toExclusive: dayAfter(to) };
}

export async function listUnifiedCustomerTransactions(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = txSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const window = periodWindow(input);
  if (input.scope === "PERIOD") {
    if (!window) {
      throw new AuthError("Choose a reporting period with a start and end date.", "VALIDATION", 400);
    }
    return withReportSql(transactionReportKey(input), async () => {
      await materializeCompanyLines(input.companyId, window);
      return queryTransactions(input, "temp");
    });
  }
  return queryTransactions(input);
}

const productHistorySchema = z.object({
  companyId: z.string().min(1),
  q: z.string().max(200).optional().nullable(),
  brandId: z.string().min(1).optional().nullable(),
  sort: z.enum(["NET_SALES", "QTY", "RECENT", "NAME_AZ"]).optional(),
  from: z.string().max(10).optional().nullable(),
  to: z.string().max(10).optional().nullable(),
  scope: z.enum(["PERIOD", "LIFETIME"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(EXPORT_PAGE_SIZE).optional(),
});

type ProductHistoryRow = {
  sku: string;
  description: string | null;
  lines: number;
  qty: Prisma.Decimal;
  grossSales: Prisma.Decimal;
  credits: Prisma.Decimal;
  netSales: Prisma.Decimal;
  datedInvoices: number;
  firstDated: Date | null;
  lastDated: Date | null;
  unreconciledLines: number;
};

function productHistoryOrder(sort: string | undefined): Prisma.Sql {
  switch (sort) {
    case "QTY":
      return Prisma.sql`qty DESC, sku ASC`;
    case "RECENT":
      return Prisma.sql`"lastDated" DESC NULLS LAST, sku ASC`;
    case "NAME_AZ":
      return Prisma.sql`sku ASC`;
    default:
      return Prisma.sql`"netSales" DESC, sku ASC`;
  }
}

function productReportKey(input: z.infer<typeof productHistorySchema>): string {
  return [
    "products",
    input.companyId,
    input.page ?? 1,
    input.pageSize ?? 25,
    input.sort ?? "",
    input.q ?? "",
    input.brandId ?? "",
    input.scope ?? "",
    input.from ?? "",
    input.to ?? "",
  ].join("|");
}

async function queryProductHistory(
  input: z.infer<typeof productHistorySchema>,
  source: "cte" | "temp" = "cte",
): Promise<{ rows: ProductHistoryRow[]; page: number; pageSize: number; total: number }> {
  if (!hasReportDb()) {
    return withReportSql(productReportKey(input), () => queryProductHistory(input, "cte"));
  }
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const parts: Prisma.Sql[] = [
    Prisma.sql`u.company_id = ${input.companyId}`,
    Prisma.sql`u.status <> 'DUPLICATE'`,
  ];
  const window = periodWindow(input);
  if (window) {
    parts.push(Prisma.sql`u.doc_date >= ${window.from} AND u.doc_date < ${window.toExclusive}`);
  }
  if (input.q?.trim()) {
    const pattern = likeContains(input.q.trim());
    parts.push(
      Prisma.sql`(u.sku ILIKE ${pattern} ESCAPE '\\' OR COALESCE(u.description, '') ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (input.brandId) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      INNER JOIN "Product" p ON p.id = v."productId"
      WHERE p."brandId" = ${input.brandId} AND UPPER(btrim(v.sku)) = u.sku
    )`);
  }
  const where = Prisma.join(parts, " AND ");
  const groupedPrefix =
    source === "temp"
      ? Prisma.sql`WITH grouped AS MATERIALIZED (`
      : Prisma.sql`${unifiedLinesCte([input.companyId], null)}, grouped AS MATERIALIZED (`;
  const raw = await reportDb().$queryRaw<Array<ProductHistoryRow & { sku: string | null; total: number }>>`
    ${groupedPrefix}
      SELECT
        u.sku AS sku,
        MAX(u.description) AS description,
        COUNT(*) FILTER (WHERE ${COUNTED})::int AS lines,
        COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED}), 0) AS qty,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND NOT ${ADJUSTMENT}), 0) AS "grossSales",
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT}), 0) AS credits,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "netSales",
        COUNT(DISTINCT u.doc_ref) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE' AND u.doc_date IS NOT NULL)::int AS "datedInvoices",
        MIN(u.doc_date) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE') AS "firstDated",
        MAX(u.doc_date) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE') AS "lastDated",
        COUNT(*) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledLines"
      FROM ${source === "temp" ? Prisma.sql`unified_report_lines u` : Prisma.sql`u`}
      WHERE ${where}
      GROUP BY u.sku
    )
    SELECT
      totals.total,
      page.sku,
      page.description,
      page.lines,
      page.qty,
      page."grossSales",
      page.credits,
      page."netSales",
      page."datedInvoices",
      page."firstDated",
      page."lastDated",
      page."unreconciledLines"
    FROM (SELECT COUNT(*)::int AS total FROM grouped) totals
    LEFT JOIN LATERAL (
      SELECT * FROM grouped
      ORDER BY ${productHistoryOrder(input.sort)}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ) page ON TRUE
  `;
  const rows: ProductHistoryRow[] = raw.filter((row) => row.sku != null);
  return { rows, page, pageSize, total: Number(raw[0]?.total ?? 0) };
}

export async function listUnifiedCustomerProducts(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = productHistorySchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const window = periodWindow(input);
  const result =
    input.scope === "PERIOD"
      ? await withReportSql(productReportKey(input), async () => {
          if (!window) {
            throw new AuthError("Choose a reporting period with a start and end date.", "VALIDATION", 400);
          }
          await materializeCompanyLines(input.companyId, window);
          return queryProductHistory(input, "temp");
        })
      : await queryProductHistory(input);
  const enriched = await enrichProducts(
    profile,
    result.rows.map((row) => ({
      partNumber: row.sku,
      description: row.description,
      lines: row.lines,
      qty: row.qty,
      grossSales: row.grossSales,
      credits: row.credits,
      netSales: row.netSales,
    })),
    input.companyId,
  );
  return {
    items: result.rows.map((row, index) => {
      const frequency = purchaseFrequencyDays({
        datedInvoiceCount: row.datedInvoices,
        firstDated: row.firstDated,
        lastDated: row.lastDated,
      });
      return {
        ...enriched[index]!,
        datedInvoices: Number(row.datedInvoices),
        latestConfirmedDate: isoDay(row.lastDated),
        purchaseFrequencyDays: frequency,
        purchaseFrequencyLabel: purchaseFrequencyLabel(frequency),
        unreconciledLines: Number(row.unreconciledLines),
      };
    }),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    pricingPermitted: hasPermission(profile, "pricing.view"),
    studleyStockPermitted: hasPermission(profile, "inventory.view"),
  };
}

const productEnquirySchema = z.object({
  sku: z.string().min(1).max(120),
  q: z.string().max(200).optional().nullable(),
  salesRepId: z.string().min(1).optional().nullable(),
  sort: z.enum(["NET_SALES", "QTY", "RECENT", "NAME_AZ"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(EXPORT_PAGE_SIZE).optional(),
});

type ProductCustomerRow = {
  companyId: string;
  companyName: string;
  status: string;
  accountCodes: string | null;
  repCode: string | null;
  salespersonName: string | null;
  lines: number;
  qty: Prisma.Decimal;
  netSales: Prisma.Decimal;
  credits: Prisma.Decimal;
  lastDated: Date | null;
  unreconciledLines: number;
};

function productCustomerOrder(sort: string | undefined): Prisma.Sql {
  switch (sort) {
    case "QTY":
      return Prisma.sql`agg.qty DESC, c.name ASC`;
    case "RECENT":
      return Prisma.sql`agg."lastDated" DESC NULLS LAST, c.name ASC`;
    case "NAME_AZ":
      return Prisma.sql`c.name ASC`;
    default:
      return Prisma.sql`agg."netSales" DESC, c.name ASC`;
  }
}

export async function getUnifiedProductSales(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = productEnquirySchema.parse(raw ?? {});
  const scope = await loadScope(profile);
  const sku = normalisedSku(input.sku);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const companyParts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.q?.trim()) {
    const pattern = likeContains(input.q.trim());
    companyParts.push(
      Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR COALESCE(c."tradingName", '') ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (input.salesRepId) {
    companyParts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "CompanyAssignment" ca WHERE ca."companyId" = c.id AND ca."salesRepId" = ${input.salesRepId}
    )`);
  }
  const companyWhere = Prisma.join(companyParts, " AND ");
  const cte = unifiedLinesCte(scope, sku);
  const aggregate = Prisma.sql`
    agg AS MATERIALIZED (
      SELECT
        u.company_id,
        string_agg(DISTINCT u.account_code, ', ') AS "accountCodes",
        COUNT(*) FILTER (WHERE ${COUNTED})::int AS lines,
        COALESCE(SUM(u.qty) FILTER (WHERE ${COUNTED}), 0) AS qty,
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS "netSales",
        COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED} AND ${ADJUSTMENT}), 0) AS credits,
        MAX(u.doc_date) FILTER (WHERE ${COUNTED} AND u.doc_type = 'INVOICE') AS "lastDated",
        COUNT(*) FILTER (WHERE u.status = 'UNRECONCILED')::int AS "unreconciledLines"
      FROM u
      WHERE u.sku = ${sku} AND u.status <> 'DUPLICATE'
      GROUP BY u.company_id
    )`;
  const scopeKey = scope === "all" ? "all" : [...scope].sort().join(",");
  const [reportRows, variant] = await Promise.all([
    withReportSql(
      ["product", sku, page, pageSize, input.sort ?? "", input.q ?? "", input.salesRepId ?? "", scopeKey].join("|"),
      () => reportDb().$queryRaw<
        Array<
          ProductCustomerRow & {
            companyId: string | null;
            total: number;
            summaryNet: Prisma.Decimal | null;
            summaryQty: Prisma.Decimal | null;
            summaryCredits: Prisma.Decimal | null;
            summaryUnreconciled: number;
          }
        >
      >`
        ${cte}, ${aggregate}
        SELECT
          totals.total,
          totals."summaryNet",
          totals."summaryQty",
          totals."summaryCredits",
          totals."summaryUnreconciled",
          page."companyId",
          page."companyName",
          page.status,
          page."accountCodes",
          page."repCode",
          page."salespersonName",
          page.lines,
          page.qty,
          page."netSales",
          page.credits,
          page."lastDated",
          page."unreconciledLines"
        FROM (
          SELECT COUNT(*)::int AS total,
            COALESCE(SUM(agg."netSales"), 0) AS "summaryNet",
            COALESCE(SUM(agg.qty), 0) AS "summaryQty",
            COALESCE(SUM(agg.credits), 0) AS "summaryCredits",
            COALESCE(SUM(agg."unreconciledLines"), 0)::int AS "summaryUnreconciled"
          FROM agg
          INNER JOIN "Company" c ON c.id = agg.company_id
          WHERE ${companyWhere}
        ) totals
        LEFT JOIN LATERAL (
          SELECT
            c.id AS "companyId", c.name AS "companyName", c.status::text AS status,
            agg."accountCodes", rep.code AS "repCode", rep."salespersonName",
            agg.lines, agg.qty, agg."netSales", agg.credits, agg."lastDated", agg."unreconciledLines"
          FROM agg
          INNER JOIN "Company" c ON c.id = agg.company_id
          LEFT JOIN LATERAL (
            SELECT sr.code AS code, COALESCE(NULLIF(sr."displayName", ''), us.name, us.email) AS "salespersonName"
            FROM "CompanyAssignment" ca
            INNER JOIN "SalesRep" sr ON sr.id = ca."salesRepId"
            INNER JOIN "User" us ON us.id = sr."userId"
            WHERE ca."companyId" = c.id
            ORDER BY ca."isPrimary" DESC, ca."createdAt" ASC
            LIMIT 1
          ) rep ON TRUE
          WHERE ${companyWhere}
          ORDER BY ${productCustomerOrder(input.sort)}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        ) page ON TRUE
      `,
    ),
    prisma.productVariant.findFirst({
      where: { sku: { equals: input.sku.trim(), mode: "insensitive" } },
      select: {
        sku: true,
        productId: true,
        product: {
          select: { name: true, status: true, isActive: true, brand: { select: { name: true } } },
        },
      },
    }),
  ]);
  const inCatalogue = Boolean(
    variant?.product && variant.product.status === "ACTIVE" && variant.product.isActive,
  );
  const head = reportRows[0];
  const rows = reportRows.filter((row) => row.companyId != null);
  const total = {
    total: head?.total ?? 0,
    netSales: head?.summaryNet,
    qty: head?.summaryQty,
    credits: head?.summaryCredits,
    unreconciledLines: head?.summaryUnreconciled ?? 0,
  };
  const unreconciledLines = Number(total.unreconciledLines ?? 0);
  const certifiedNet = decimalString(total.netSales, 2);
  const certification = certifyUnifiedTotals({ certifiedNet, unreconciledLines });
  return {
    product: {
      sku: variant?.sku ?? input.sku.trim(),
      name: variant?.product?.name ?? input.sku.trim(),
      inCatalogue,
      catalogueStatus: inCatalogue ? "In catalogue" : "Not in the current catalogue",
      productId: variant?.productId ?? null,
      productHref: productWorkspaceHref(
        profile,
        variant?.productId ?? null,
        variant?.sku ?? input.sku,
        inCatalogue,
      ),
      brandName: variant?.product?.brand?.name ?? null,
    },
    summary: {
      customers: Number(total?.total ?? 0),
      certifiedNet,
      combinedNet: certification.combinedNet,
      certification: certification.status,
      units: decimalString(total?.qty, 3),
      credits: decimalString(total?.credits, 2),
      unreconciledLines,
    },
    customers: {
      items: rows.map((row) => ({
        companyId: row.companyId,
        name: row.companyName,
        status: row.status,
        accountCodes: row.accountCodes,
        salespersonName: row.salespersonName,
        salespersonCode: row.repCode,
        lines: Number(row.lines),
        units: decimalString(row.qty, 3),
        netSales: decimalString(row.netSales, 2),
        credits: decimalString(row.credits, 2),
        lastDatedPurchase: isoDay(row.lastDated),
        unreconciledLines: Number(row.unreconciledLines),
        customer360Href: customer360Href(profile, row.companyId),
      })),
      page,
      pageSize,
      total: Number(total?.total ?? 0),
    },
    scopeNote:
      scope === "all"
        ? "All CRM companies with a verified Autopart account link."
        : "Only CRM companies in your sales scope. Unlinked Autopart accounts are omitted.",
  };
}

const queueSchema = z.object({
  page: z.number().int().min(1).max(1_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

/**
 * Internal reconciliation queue: account codes with sales rows that no verified link attaches to
 * exactly one CRM company. Management scope only, because these accounts are outside any CRM scope.
 */
export async function getUnifiedReconciliationQueue(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const scope = await loadScope(profile);
  if (scope !== "all") return { permitted: false as const };
  const input = queueSchema.parse(raw ?? {});
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const cte = Prisma.sql`
    WITH
    idmap_raw AS (
      SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
      FROM "Company" c
      WHERE c."autopartCustomerCode" IS NOT NULL AND c."autopartCustomerCodeVerifiedAt" IS NOT NULL
      UNION ALL
      SELECT UPPER(btrim(al."alias")), al."companyId" FROM "AutopartCustomerAccountAlias" al
      UNION ALL
      SELECT UPPER(btrim(a."accountCode")), a."companyId"
      FROM "AutopartAccount" a
      WHERE a."sourceSystem" = ${AUTOPART_SOURCE} AND a."companyId" IS NOT NULL
    ),
    owners AS (
      SELECT code, COUNT(DISTINCT company_id)::int AS companies FROM idmap_raw GROUP BY code
    ),
    pending AS (
      SELECT UPPER(btrim(l."accountCode")) AS code, 'HISTORICAL_561L'::text AS source,
        COUNT(*)::int AS lines, COALESCE(SUM(l."salesAmount"), 0) AS net
      FROM "AutopartInvoiceLine" l
      WHERE l."salesMeasure" = 'NET_EX_VAT'
        AND NOT EXISTS (
          SELECT 1 FROM owners o WHERE o.code = UPPER(btrim(l."accountCode")) AND o.companies = 1
        )
      GROUP BY 1
      UNION ALL
      SELECT UPPER(btrim(l."autopartCustomerCode")), 'DATED_FEED'::text,
        COUNT(*)::int, COALESCE(SUM(l."salesNet"), 0)
      FROM "AutopartSalesLine" l
      WHERE l."companyId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM owners o WHERE o.code = UPPER(btrim(l."autopartCustomerCode")) AND o.companies = 1
        )
      GROUP BY 1
      UNION ALL
      SELECT UPPER(btrim(d."autopartCustomerCode")), 'ONGOING_504'::text,
        COUNT(*)::int, COALESCE(SUM(d."goodsNet"), 0)
      FROM "AutopartSalesDocument" d
      WHERE d."has504" = TRUE
        AND d."companyId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM owners o
          WHERE o.code = UPPER(btrim(d."autopartCustomerCode")) AND o.companies = 1
        )
      GROUP BY 1
    ),
    queue AS MATERIALIZED (
      SELECT p.code,
        string_agg(DISTINCT p.source, ', ') AS sources,
        SUM(p.lines)::int AS lines,
        SUM(p.net) AS net,
        COALESCE(MAX(o.companies), 0)::int AS companies
      FROM pending p
      LEFT JOIN owners o ON o.code = p.code
      GROUP BY p.code
    )
  `;
  const reportRows = await withReportSql(`reconcile:${page}:${pageSize}`, () =>
    reportDb().$queryRaw<
      Array<{
        total: number;
        totalLines: number;
        totalNet: Prisma.Decimal | null;
        code: string | null;
        sources: string | null;
        lines: number | null;
        net: Prisma.Decimal | null;
        companies: number | null;
        accountName: string | null;
        classification: string | null;
      }>
    >`
      ${cte}
      SELECT
        totals.total,
        totals."totalLines",
        totals."totalNet",
        page.code,
        page.sources,
        page.lines,
        page.net,
        page.companies,
        page."accountName",
        page.classification
      FROM (
        SELECT COUNT(*)::int AS total,
          COALESCE(SUM(q.lines), 0)::int AS "totalLines",
          COALESCE(SUM(q.net), 0) AS "totalNet"
        FROM queue q
      ) totals
      LEFT JOIN LATERAL (
        SELECT q.code, q.sources, q.lines, q.net, q.companies,
          a."originalName" AS "accountName", a."classification"::text AS classification
        FROM queue q
        LEFT JOIN "AutopartAccount" a
          ON a."sourceSystem" = ${AUTOPART_SOURCE} AND UPPER(btrim(a."accountCode")) = q.code
        ORDER BY ABS(q.net) DESC, q.code ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      ) page ON TRUE
    `,
  );
  const head = reportRows[0];
  const rows = reportRows.filter((row) => row.code != null);
  return {
    permitted: true as const,
    items: rows.map((row) => ({
      code: row.code,
      sources: row.sources,
      lines: Number(row.lines),
      net: decimalString(row.net, 2),
      linkedCompanies: Number(row.companies),
      accountName: row.accountName,
      classification: row.classification,
      reason:
        Number(row.companies) > 1
          ? "Linked to more than one CRM company"
          : row.accountName
            ? "Autopart account not linked to a CRM company"
            : "Account code not in the Autopart customer master",
    })),
    page,
    pageSize,
    total: Number(head?.total ?? 0),
    totalLines: Number(head?.totalLines ?? 0),
    totalNet: decimalString(head?.totalNet, 2),
    note: "These rows are not in any customer total. Link the exact account code to one CRM company to include them. Names are never used to match.",
  };
}

const exportSchema = z
  .object({ kind: z.enum(["transactions", "products"]), companyId: z.string().min(1) })
  .passthrough();

export async function exportUnifiedCustomerSalesCsv(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = exportSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, input.companyId);
  const company = await loadCompanyHeader(input.companyId);
  const safeName = company.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || company.id;
  if (input.kind === "transactions") {
    const filters = txSchema.parse({ ...input, page: 1, pageSize: EXPORT_PAGE_SIZE });
    const collect = async (source: "cte" | "temp") => {
      const items: Awaited<ReturnType<typeof queryTransactions>>["items"] = [];
      let total = 0;
      for (let page = 1; items.length < EXPORT_MAX_ROWS; page += 1) {
        const next = await queryTransactions({ ...filters, page, pageSize: EXPORT_PAGE_SIZE }, source);
        total = next.total;
        items.push(...next.items);
        if (next.items.length < EXPORT_PAGE_SIZE) break;
      }
      return { items, total };
    };
    const window = periodWindow(filters);
    const collected =
      filters.scope === "PERIOD"
        ? await withReportSql(`export:${transactionReportKey(filters)}`, async () => {
            if (!window) {
              throw new AuthError("Choose a reporting period with a start and end date.", "VALIDATION", 400);
            }
            await materializeCompanyLines(filters.companyId, window);
            return collect("temp");
          })
        : await collect("cte");
    const { items, total } = collected;
    const headers = [
      "Customer",
      "Status",
      "Date",
      "Reference",
      "Document type",
      "Account",
      "SKU",
      "Description",
      "Qty",
      "Net ex VAT",
      "Source",
      "Reconciliation status",
      "Counted in certified total",
      "Reason",
    ];
    const rows = items.map((item) => [
      company.name,
      company.status,
      item.dateLabel,
      item.reference ?? "",
      item.documentType,
      item.accountCode,
      item.sku,
      item.description ?? "",
      item.qty,
      item.net,
      item.sourceLabel,
      item.statusLabel,
      item.counted ? "Yes" : "No",
      item.reasonLabel ?? "",
    ]);
    return {
      filename: `customer-sales-transactions-${safeName}.csv`,
      csv: buildCsv(
        headers,
        rows.map((row) => row.map(csvSafe)),
      ),
      truncated: items.length < total,
      rowCount: items.length,
      total,
    };
  }
  const filters = productHistorySchema.parse({ ...input, page: 1, pageSize: EXPORT_PAGE_SIZE });
  const items: Awaited<ReturnType<typeof listUnifiedCustomerProducts>>["items"] = [];
  let total = 0;
  for (let page = 1; items.length < EXPORT_MAX_ROWS; page += 1) {
    const next = await listUnifiedCustomerProducts(actorUserId, {
      ...filters,
      page,
      pageSize: EXPORT_PAGE_SIZE,
    });
    total = next.total;
    items.push(...next.items);
    if (next.items.length < EXPORT_PAGE_SIZE) break;
  }
  const canPrice = hasPermission(profile, "pricing.view");
  const headers = [
    "Customer",
    "SKU",
    "Description",
    "Lines",
    "Units",
    "Sales",
    "Credits",
    "Net ex VAT",
    "Latest confirmed date",
    "Purchase frequency",
    "Catalogue",
    ...(canPrice ? ["Trade price"] : []),
    "Unreconciled lines",
  ];
  const rows = items.map((item) => [
    company.name,
    item.sku,
    item.description,
    item.lines,
    item.units,
    item.grossSales,
    item.credits,
    item.netSales,
    item.latestConfirmedDate ?? DATE_UNAVAILABLE,
    item.purchaseFrequencyLabel,
    item.catalogueStatus,
    ...(canPrice ? [item.customerPrice ?? item.tradePrice ?? ""] : []),
    item.unreconciledLines,
  ]);
  return {
    filename: `customer-sales-products-${safeName}.csv`,
    csv: buildCsv(
      headers,
      rows.map((row) => row.map(csvSafe)),
    ),
    truncated: items.length < total,
    rowCount: items.length,
    total,
  };
}

async function explainPlan(statement: Prisma.Sql): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    ${statement}
  `;
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

/** Diagnostic plans for the unified reporting queries. Read-only. Not used by page loads. */
export async function explainUnifiedReporting(companyId: string, sku: string): Promise<{
  customerSummary: string;
  customerTransactions: string;
  productEnquiry: string;
  reconciliationQueue: string;
}> {
  const customer = unifiedLinesCte([companyId], null);
  const product = unifiedLinesCte("all", sku);
  return {
    customerSummary: await explainPlan(Prisma.sql`
      ${customer}
      SELECT ${SUMMARY_SELECT}
      FROM u
      WHERE u.company_id = ${companyId}
    `),
    customerTransactions: await explainPlan(Prisma.sql`
      ${customer}
      SELECT u.line_id, u.doc_ref, u.net, u.status
      FROM u
      WHERE u.company_id = ${companyId}
      ORDER BY u.doc_date DESC NULLS LAST, u.doc_ref ASC NULLS LAST, u.sku ASC, u.line_id ASC
      LIMIT 50
    `),
    productEnquiry: await explainPlan(Prisma.sql`
      ${product}
      SELECT u.company_id, COALESCE(SUM(u.net) FILTER (WHERE ${COUNTED}), 0) AS net
      FROM u
      WHERE u.sku = ${normalisedSku(sku)} AND u.status <> 'DUPLICATE'
      GROUP BY u.company_id
    `),
    reconciliationQueue: await explainPlan(Prisma.sql`
      WITH owners AS (
        SELECT UPPER(btrim(a."accountCode")) AS code, COUNT(DISTINCT a."companyId")::int AS companies
        FROM "AutopartAccount" a
        WHERE a."sourceSystem" = ${AUTOPART_SOURCE} AND a."companyId" IS NOT NULL
        GROUP BY 1
      )
      SELECT UPPER(btrim(l."accountCode")) AS code, COUNT(*)::int AS lines
      FROM "AutopartInvoiceLine" l
      WHERE l."salesMeasure" = 'NET_EX_VAT'
        AND NOT EXISTS (
          SELECT 1 FROM owners o WHERE o.code = UPPER(btrim(l."accountCode")) AND o.companies = 1
        )
      GROUP BY 1
      LIMIT 25
    `),
  };
}
