/**
 * RETAILA OIN replenishment read from Autopart sales.
 * 561L and ongoing TRM21QC lines for the same invoice are counted once,
 * using the Sales Enquiry rule: keep the ongoing copy when the lines agree,
 * and count neither copy when they disagree or the 504 goods value does not match.
 * A manual FBA ledger row is used only when that document is not already here.
 * These quantities are replenishment history, not Amazon consumer sales.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";

export const RETAILA_AUTOPART_ACCOUNT = "RETAILA";

export type RetailaOinIssueCode = "SOURCE_CONFLICT" | "GOODS_MISMATCH";

export type RetailaOinHealth = {
  account: string;
  documents: number;
  lines: number;
  latestDocumentDate: string | null;
  historicDocuments: number;
  ongoingDocuments: number;
  ledgerOnlyDocuments: number;
  issueCount: number;
  undatedLines: number;
  warning: string | null;
};

export type RetailaOinHistoryLine = {
  sku: string;
  description: string | null;
  units: number;
  source: string;
};

export type RetailaOinHistoryDocument = {
  documentReference: string;
  documentType: string;
  documentDate: string | null;
  source: string;
  status: "COUNTED" | RetailaOinIssueCode | "LEDGER_ONLY";
  units: number;
  lines: RetailaOinHistoryLine[];
};

function retailaAccountSql(account: Prisma.Sql, companyId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${account} = ${RETAILA_AUTOPART_ACCOUNT}
    OR UPPER(btrim(${account})) = ${RETAILA_AUTOPART_ACCOUNT}
    OR EXISTS (
      SELECT 1
      FROM "AutopartCustomerAccountAlias" a
      INNER JOIN "Company" c ON c.id = a."companyId"
      WHERE ${companyId} = c.id
        AND c."autopartCustomerCodeVerifiedAt" IS NOT NULL
        AND UPPER(btrim(c."autopartCustomerCode")) = ${RETAILA_AUTOPART_ACCOUNT}
        AND a.alias = UPPER(btrim(${account}))
    )
  )`;
}

/** WITH clause ending in counted_oin_lines, issue_oin_documents and scoped_oin_lines. */
function retailaOinWith(): Prisma.Sql {
  const lineAccount = retailaAccountSql(
    Prisma.sql`l."autopartCustomerCode"`,
    Prisma.sql`l."companyId"`,
  );
  const documentAccount = retailaAccountSql(
    Prisma.sql`d."autopartCustomerCode"`,
    Prisma.sql`d."companyId"`,
  );
  return Prisma.sql`
    WITH scoped_oin_lines AS (
      SELECT
        l.id,
        COALESCE(l."companyId", 'account:' || UPPER(btrim(l."autopartCustomerCode"))) AS company_key,
        UPPER(btrim(l."autopartCustomerCode")) AS account_code,
        l.sku,
        UPPER(btrim(l.sku)) AS sku_key,
        l."descriptionSnapshot" AS description,
        l."documentType"::text AS doc_type,
        UPPER(btrim(l."documentReference")) AS doc_ref,
        l.source,
        d."documentDate" AS doc_date,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l.units) ELSE l.units END)::numeric(18, 3) AS signed_qty,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesNet") ELSE l."salesNet" END)::numeric(18, 2) AS signed_net
      FROM "AutopartSalesLine" l
      LEFT JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l.source IN ('561L', 'ONGOING_TRM21QC')
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
        AND UPPER(btrim(l."documentReference")) ~ '^OIN[A-Z0-9]+$'
        AND ${lineAccount}
    ),
    source_doc AS (
      SELECT company_key, doc_ref, source,
        string_agg(
          doc_type || '|' || sku_key || '|' || signed_qty::text || '|' || signed_net::text,
          ';' ORDER BY doc_type, sku_key, signed_qty, signed_net
        ) AS sig
      FROM scoped_oin_lines
      WHERE doc_ref IS NOT NULL
      GROUP BY company_key, doc_ref, source
    ),
    doc_status AS (
      SELECT company_key, doc_ref,
        COUNT(*)::int AS sources,
        COUNT(DISTINCT sig)::int AS signatures,
        CASE WHEN bool_or(source = 'ONGOING_TRM21QC') THEN 'ONGOING_TRM21QC' ELSE '561L' END AS preferred
      FROM source_doc
      GROUP BY company_key, doc_ref
    ),
    preferred_lines AS (
      SELECT p.company_key, p.doc_ref, p.doc_type, SUM(p.signed_net)::numeric(18, 2) AS net
      FROM scoped_oin_lines p
      INNER JOIN doc_status ds ON ds.company_key = p.company_key AND ds.doc_ref = p.doc_ref
      WHERE ds.sources = 1 OR (ds.signatures = 1 AND p.source = ds.preferred)
      GROUP BY p.company_key, p.doc_ref, p.doc_type
    ),
    goods_hold AS (
      SELECT h.company_key, h.doc_ref
      FROM (
        SELECT
          COALESCE(d."companyId", 'account:' || UPPER(btrim(d."autopartCustomerCode"))) AS company_key,
          UPPER(btrim(d."documentReference")) AS doc_ref,
          d."documentType"::text AS doc_type,
          d."goodsNet"::numeric(18, 2) AS goods_net
        FROM "AutopartSalesDocument" d
        WHERE d."has504" = TRUE
          AND UPPER(btrim(d."documentReference")) ~ '^OIN[A-Z0-9]+$'
          AND ${documentAccount}
      ) h
      LEFT JOIN preferred_lines pl
        ON pl.company_key = h.company_key AND pl.doc_ref = h.doc_ref AND pl.doc_type = h.doc_type
      WHERE pl.net IS NULL OR h.goods_net IS NULL OR ABS(h.goods_net - pl.net) > 0.01
      GROUP BY h.company_key, h.doc_ref
    ),
    issue_oin_documents AS (
      SELECT ds.company_key, ds.doc_ref,
        CASE
          WHEN ds.sources > 1 AND ds.signatures > 1 THEN 'SOURCE_CONFLICT'
          ELSE 'GOODS_MISMATCH'
        END AS issue
      FROM doc_status ds
      WHERE (ds.sources > 1 AND ds.signatures > 1)
         OR EXISTS (
           SELECT 1 FROM goods_hold g
           WHERE g.company_key = ds.company_key AND g.doc_ref = ds.doc_ref
         )
    ),
    counted_oin_lines AS (
      SELECT p.*
      FROM scoped_oin_lines p
      INNER JOIN doc_status ds ON ds.company_key = p.company_key AND ds.doc_ref = p.doc_ref
      WHERE (ds.sources = 1 OR (ds.signatures = 1 AND p.source = ds.preferred))
        AND NOT EXISTS (
          SELECT 1 FROM goods_hold g
          WHERE g.company_key = p.company_key AND g.doc_ref = p.doc_ref
        )
    )
  `;
}

function num(value: { toString(): string } | number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export async function loadRetailaOinUnits(range: {
  from: Date;
  toExclusive: Date;
}): Promise<Array<{ matchKey: string; sku: string; units: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ matchKey: string; sku: string; units: Prisma.Decimal }>
  >`
    ${retailaOinWith()}
    , counted_window AS (
      SELECT sku_key AS "matchKey", MAX(sku) AS sku, SUM(signed_qty) AS units
      FROM counted_oin_lines
      WHERE doc_date >= ${range.from} AND doc_date < ${range.toExclusive}
      GROUP BY sku_key
    ),
    ledger_window AS (
      SELECT l."matchKey" AS "matchKey", MAX(l.sku) AS sku, SUM(l.qty) AS units
      FROM "FbaReplenishmentLine" l
      INNER JOIN "FbaReplenishmentDocument" d ON d.id = l."documentId"
      WHERE l."supersededAt" IS NULL
        AND d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        AND NOT EXISTS (
          SELECT 1 FROM scoped_oin_lines s
          WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
            AND s.doc_type = d."documentType"
        )
      GROUP BY l."matchKey"
    )
    SELECT "matchKey", MAX(sku) AS sku, SUM(units) AS units
    FROM (
      SELECT * FROM counted_window
      UNION ALL
      SELECT * FROM ledger_window
    ) combined
    GROUP BY "matchKey"
  `;
  return rows.map((row) => ({ matchKey: row.matchKey, sku: row.sku, units: num(row.units) }));
}

export async function loadRetailaOinHealth(): Promise<RetailaOinHealth> {
  const rows = await prisma.$queryRaw<
    Array<{
      documents: number;
      lines: number;
      latest: Date | null;
      historicDocuments: number;
      ongoingDocuments: number;
      issues: number;
      undatedLines: number;
      ledgerOnlyDocuments: number;
    }>
  >`
    ${retailaOinWith()}
    SELECT
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines) AS documents,
      (SELECT COUNT(*)::int FROM counted_oin_lines) AS lines,
      (SELECT MAX(doc_date) FROM counted_oin_lines) AS latest,
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines WHERE source = '561L') AS "historicDocuments",
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines WHERE source = 'ONGOING_TRM21QC') AS "ongoingDocuments",
      (SELECT COUNT(*)::int FROM issue_oin_documents) AS issues,
      (SELECT COUNT(*)::int FROM counted_oin_lines WHERE doc_date IS NULL) AS "undatedLines",
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.id
          FROM "FbaReplenishmentDocument" d
          WHERE NOT EXISTS (
            SELECT 1 FROM scoped_oin_lines s
            WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
              AND s.doc_type = d."documentType"
          )
        ) ledger_only
      ) AS "ledgerOnlyDocuments"
  `;
  const row = rows[0];
  const documents = row?.documents ?? 0;
  const issueCount = row?.issues ?? 0;
  let warning: string | null = null;
  if (documents === 0 && issueCount === 0) {
    warning =
      "No RETAILA OIN invoices are in the Autopart sales history. Replenishment history stays empty until those invoices are stored there. This page does not ask for the same 504 and TRM files again.";
  } else if (issueCount > 0) {
    warning = `${issueCount.toLocaleString("en-GB")} RETAILA OIN document${issueCount === 1 ? "" : "s"} need review. Those quantities are left out so a correction is not counted twice.`;
  } else if ((row?.undatedLines ?? 0) > 0) {
    warning =
      "Some RETAILA OIN lines have no document date, so they are shown in history and left out of the 90-day cadence.";
  }
  return {
    account: RETAILA_AUTOPART_ACCOUNT,
    documents,
    lines: row?.lines ?? 0,
    latestDocumentDate: dateOnly(row?.latest),
    historicDocuments: row?.historicDocuments ?? 0,
    ongoingDocuments: row?.ongoingDocuments ?? 0,
    ledgerOnlyDocuments: row?.ledgerOnlyDocuments ?? 0,
    issueCount,
    undatedLines: row?.undatedLines ?? 0,
    warning,
  };
}

export async function listRetailaOinHistory(input: {
  page: number;
  pageSize: number;
}): Promise<{ total: number; documents: RetailaOinHistoryDocument[] }> {
  const offset = (input.page - 1) * input.pageSize;
  const [countRows, documents] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>`
      ${retailaOinWith()}
      SELECT (
        (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines)
        + (SELECT COUNT(DISTINCT doc_ref)::int FROM issue_oin_documents)
        + (
          SELECT COUNT(*)::int FROM "FbaReplenishmentDocument" d
          WHERE NOT EXISTS (
            SELECT 1 FROM scoped_oin_lines s
            WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
              AND s.doc_type = d."documentType"
          )
        )
      ) AS total
    `,
    prisma.$queryRaw<
      Array<{
        documentReference: string;
        documentType: string;
        documentDate: Date | null;
        source: string;
        status: string;
        units: Prisma.Decimal;
      }>
    >`
      ${retailaOinWith()}
      , docs AS (
        SELECT doc_ref AS "documentReference",
          MIN(doc_type) AS "documentType",
          MIN(doc_date) AS "documentDate",
          CASE WHEN bool_or(source = 'ONGOING_TRM21QC') THEN 'ONGOING_TRM21QC' ELSE '561L' END AS source,
          'COUNTED' AS status,
          SUM(signed_qty) AS units
        FROM counted_oin_lines
        GROUP BY doc_ref
        UNION ALL
        SELECT i.doc_ref, MIN(s.doc_type), MIN(s.doc_date), 'BOTH', i.issue, 0::numeric
        FROM issue_oin_documents i
        INNER JOIN scoped_oin_lines s ON s.company_key = i.company_key AND s.doc_ref = i.doc_ref
        GROUP BY i.doc_ref, i.issue
        UNION ALL
        SELECT UPPER(btrim(d."documentReference")), d."documentType", d."documentDate", 'LEDGER', 'LEDGER_ONLY',
          COALESCE(SUM(l.qty), 0)
        FROM "FbaReplenishmentDocument" d
        LEFT JOIN "FbaReplenishmentLine" l ON l."documentId" = d.id AND l."supersededAt" IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM scoped_oin_lines s
          WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
            AND s.doc_type = d."documentType"
        )
        GROUP BY d.id, d."documentReference", d."documentType", d."documentDate"
      )
      SELECT * FROM docs
      ORDER BY "documentDate" DESC NULLS LAST, "documentReference"
      LIMIT ${input.pageSize} OFFSET ${offset}
    `,
  ]);
  const refs = documents.map((row) => row.documentReference);
  const lines = refs.length
    ? await prisma.$queryRaw<
        Array<{
          documentReference: string;
          sku: string;
          description: string | null;
          units: Prisma.Decimal;
          source: string;
        }>
      >`
        ${retailaOinWith()}
        SELECT doc_ref AS "documentReference", sku, description, signed_qty AS units, source
        FROM counted_oin_lines
        WHERE doc_ref IN (${Prisma.join(refs)})
        UNION ALL
        SELECT s.doc_ref, s.sku, s.description, s.signed_qty, s.source
        FROM scoped_oin_lines s
        INNER JOIN issue_oin_documents i ON i.company_key = s.company_key AND i.doc_ref = s.doc_ref
        WHERE s.doc_ref IN (${Prisma.join(refs)})
        UNION ALL
        SELECT UPPER(btrim(d."documentReference")), l.sku, l.description, l.qty, 'LEDGER'
        FROM "FbaReplenishmentLine" l
        INNER JOIN "FbaReplenishmentDocument" d ON d.id = l."documentId"
        WHERE l."supersededAt" IS NULL
          AND UPPER(btrim(d."documentReference")) IN (${Prisma.join(refs)})
          AND NOT EXISTS (
            SELECT 1 FROM scoped_oin_lines s
            WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
              AND s.doc_type = d."documentType"
          )
      `
    : [];
  const byRef = new Map<string, RetailaOinHistoryLine[]>();
  for (const line of lines) {
    const list = byRef.get(line.documentReference) ?? [];
    list.push({
      sku: line.sku,
      description: line.description,
      units: num(line.units),
      source: line.source,
    });
    byRef.set(line.documentReference, list);
  }
  return {
    total: countRows[0]?.total ?? 0,
    documents: documents.map((row) => ({
      documentReference: row.documentReference,
      documentType: row.documentType,
      documentDate: dateOnly(row.documentDate),
      source: row.source,
      status: row.status as RetailaOinHistoryDocument["status"],
      units: num(row.units),
      lines: byRef.get(row.documentReference) ?? [],
    })),
  };
}

export async function listRetailaOinLinesForSku(
  matchKey: string,
): Promise<RetailaOinHistoryDocument[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      documentReference: string;
      documentType: string;
      documentDate: Date | null;
      source: string;
      status: string;
      sku: string;
      description: string | null;
      units: Prisma.Decimal;
    }>
  >`
    ${retailaOinWith()}
    SELECT doc_ref AS "documentReference", doc_type AS "documentType", doc_date AS "documentDate",
      source, 'COUNTED' AS status, sku, description, signed_qty AS units
    FROM counted_oin_lines
    WHERE sku_key = ${matchKey}
    UNION ALL
    SELECT s.doc_ref, s.doc_type, s.doc_date, s.source, i.issue, s.sku, s.description, s.signed_qty
    FROM scoped_oin_lines s
    INNER JOIN issue_oin_documents i ON i.company_key = s.company_key AND i.doc_ref = s.doc_ref
    WHERE s.sku_key = ${matchKey}
    UNION ALL
    SELECT UPPER(btrim(d."documentReference")), d."documentType", d."documentDate", 'LEDGER', 'LEDGER_ONLY',
      l.sku, l.description, l.qty
    FROM "FbaReplenishmentLine" l
    INNER JOIN "FbaReplenishmentDocument" d ON d.id = l."documentId"
    WHERE l."supersededAt" IS NULL
      AND l."matchKey" = ${matchKey}
      AND NOT EXISTS (
        SELECT 1 FROM scoped_oin_lines s
        WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
          AND s.doc_type = d."documentType"
      )
    ORDER BY "documentDate" DESC NULLS LAST, "documentReference"
  `;
  const grouped = new Map<string, RetailaOinHistoryDocument>();
  for (const row of rows) {
    const key = `${row.status}|${row.documentReference}`;
    let document = grouped.get(key);
    if (!document) {
      document = {
        documentReference: row.documentReference,
        documentType: row.documentType,
        documentDate: dateOnly(row.documentDate),
        source: row.source,
        status: row.status as RetailaOinHistoryDocument["status"],
        units: 0,
        lines: [],
      };
      grouped.set(key, document);
    }
    const units = num(row.units);
    document.units += row.status === "COUNTED" || row.status === "LEDGER_ONLY" ? units : 0;
    document.lines.push({
      sku: row.sku,
      description: row.description,
      units,
      source: row.source,
    });
  }
  return [...grouped.values()];
}
