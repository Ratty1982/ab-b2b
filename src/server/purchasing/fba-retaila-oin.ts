/**
 * RETAILA OIN customer sales for the Amazon FBA forecast.
 * The date window and RETAILA account are applied before reconciliation, so a
 * dashboard request does not read every customer's historic sales lines.
 * 561L and ongoing TRM21QC copies of one invoice in that window are counted once.
 * A manual ledger row is used only for a proven RETAILA account in the same window.
 * The units are customer sales. They are not FBA inbound and they are not proven
 * Amazon UK sell-through: the rows have no marketplace or fulfilment channel.
 */
import { Prisma } from "@prisma/client";
import { addDaysIso, lastNDaysRange } from "@/domain/sales-history-period";
import { prisma } from "@/infra/database/client";

export const RETAILA_AUTOPART_ACCOUNT = "RETAILA";
export const RETAILA_OIN_WINDOW_DAYS = [30, 90, 180, 365] as const;
export type RetailaOinWindowDays = (typeof RETAILA_OIN_WINDOW_DAYS)[number];
export const DEFAULT_RETAILA_OIN_WINDOW_DAYS: RetailaOinWindowDays = 90;
/** Production budget. The statement is cancelled locally so the pooled connection stays usable. */
export const RETAILA_OIN_STATEMENT_TIMEOUT = "8s";
export const RETAILA_OIN_QUERY_BUDGET_MS = 8_000;

export type RetailaOinIssueCode = "SOURCE_CONFLICT" | "GOODS_MISMATCH" | "AMBIGUOUS_OWNER";
export type RetailaOinHistorySort = "date" | "reference" | "units";

export type RetailaOinRange = {
  from: Date;
  toExclusive: Date;
  days: RetailaOinWindowDays;
};

export type RetailaOinHealth = {
  account: string;
  days: RetailaOinWindowDays;
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

export type RetailaSalesWindows = {
  d7: number | null;
  d30: number | null;
  d60: number | null;
  d90: number | null;
  d365: number | null;
};

export type RetailaSkuSales = {
  matchKey: string;
  sku: string;
  /** Dated units inside the requested range. Null when every counted line is undated. */
  units: number | null;
  windows: RetailaSalesWindows;
};

/** Start of an inner window, or null when that window is wider than the rows already scanned. */
export function salesWindowCutoff(range: RetailaOinRange, days: number): Date | null {
  const endDay = addDaysIso(range.toExclusive.toISOString().slice(0, 10), -1);
  const start = new Date(`${addDaysIso(endDay, -(days - 1))}T00:00:00.000Z`);
  if (start.getTime() < range.from.getTime()) return null;
  return start;
}

function salesWindowCutoffs(range: RetailaOinRange): {
  d7: Date | null;
  d30: Date | null;
  d60: Date | null;
  d90: Date | null;
  d365: Date | null;
} {
  return {
    d7: salesWindowCutoff(range, 7),
    d30: salesWindowCutoff(range, 30),
    d60: salesWindowCutoff(range, 60),
    d90: salesWindowCutoff(range, 90),
    d365: salesWindowCutoff(range, 365),
  };
}

/** Sum dated quantities in one window. A window wider than the scan stays null. */
function datedWindowSum(cutoff: Date | null, range: RetailaOinRange, dateSql: Prisma.Sql, qtySql: Prisma.Sql): Prisma.Sql {
  if (!cutoff) return Prisma.sql`NULL::numeric`;
  return Prisma.sql`COALESCE(SUM(${qtySql}) FILTER (WHERE ${dateSql} >= ${cutoff} AND ${dateSql} < ${range.toExclusive}), 0)`;
}

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
  status: "COUNTED" | RetailaOinIssueCode | "LEDGER_ONLY" | "LEDGER_REVIEW";
  units: number;
  lines: RetailaOinHistoryLine[];
};

export class ForecastQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastQueryError";
  }
}

export function retailaWindowDays(value: unknown): RetailaOinWindowDays {
  const days = typeof value === "number" ? value : Number(value);
  return RETAILA_OIN_WINDOW_DAYS.some((item) => item === days) ? (days as RetailaOinWindowDays) : DEFAULT_RETAILA_OIN_WINDOW_DAYS;
}

export function retailaOinRange(todayIso: string, days: unknown): RetailaOinRange {
  const window = retailaWindowDays(days);
  const span = lastNDaysRange(todayIso, window);
  return {
    days: window,
    from: new Date(`${span.from}T00:00:00.000Z`),
    toExclusive: new Date(`${addDaysIso(span.to, 1)}T00:00:00.000Z`),
  };
}

type ForecastDb = Prisma.TransactionClient | typeof prisma;

export async function withForecastQuery<T>(run: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${RETAILA_OIN_STATEMENT_TIMEOUT}, true)`;
        return run(tx);
      },
      { maxWait: 2_000, timeout: 12_000 },
    );
  } catch (error) {
    if (error instanceof ForecastQueryError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (
      /statement timeout|canceling statement|Unable to start a transaction|Timed out fetching a new connection|Transaction already closed|expired transaction/i.test(
        message,
      )
    ) {
      throw new ForecastQueryError(
        "RETAILA customer sales took too long and were stopped. Amazon FBA and Studley stock are unchanged. Retry in a moment.",
      );
    }
    throw error;
  }
}

/** Account is RETAILA, or the code/alias of the company already proven as a RETAILA owner. */
function provenRetailaAccountSql(account: Prisma.Sql, companyId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    (
      UPPER(btrim(${account})) = ${RETAILA_AUTOPART_ACCOUNT}
      OR EXISTS (
        SELECT 1
        FROM retaila_owners owner_company
        WHERE owner_company.id = ${companyId}
          AND (
            UPPER(btrim(${account})) = owner_company.code
            OR EXISTS (
              SELECT 1
              FROM "AutopartCustomerAccountAlias" alias_row
              WHERE alias_row."companyId" = owner_company.id
                AND alias_row.alias = UPPER(btrim(${account}))
            )
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "Company" foreign_company
      WHERE foreign_company.id = ${companyId}
        AND foreign_company."autopartCustomerCodeVerifiedAt" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM retaila_owners owner_company WHERE owner_company.id = foreign_company.id
        )
    )
  )`;
}

function ledgerRetailaAccountSql(account: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    UPPER(btrim(${account})) = ${RETAILA_AUTOPART_ACCOUNT}
    OR EXISTS (
      SELECT 1
      FROM retaila_owners owner_company
      WHERE UPPER(btrim(${account})) = owner_company.code
        OR EXISTS (
          SELECT 1
          FROM "AutopartCustomerAccountAlias" alias_row
          WHERE alias_row."companyId" = owner_company.id
            AND alias_row.alias = UPPER(btrim(${account}))
        )
    )
  )`;
}

/**
 * Reconciliation for one date window.
 * window_refs is the only entry point: dated RETAILA OIN documents, then the
 * lines of those references (both sources, including a copy with no company link).
 */
function retailaOinWith(range: RetailaOinRange, matchKey?: string): Prisma.Sql {
  const lineAccount = provenRetailaAccountSql(
    Prisma.sql`l."autopartCustomerCode"`,
    Prisma.sql`l."companyId"`,
  );
  const headerAccount = provenRetailaAccountSql(
    Prisma.sql`h."autopartCustomerCode"`,
    Prisma.sql`h."companyId"`,
  );
  const goodsAccount = provenRetailaAccountSql(
    Prisma.sql`d."autopartCustomerCode"`,
    Prisma.sql`d."companyId"`,
  );
  const ledgerAccount = ledgerRetailaAccountSql(Prisma.sql`d."customerAccount"`);
  const foreignDocument = Prisma.sql`EXISTS (
    SELECT 1
    FROM "AutopartSalesDocument" foreign_document
    WHERE foreign_document."documentReference" = d."documentReference"
      AND foreign_document."documentType"::text = d."documentType"
      AND NOT ${provenRetailaAccountSql(
        Prisma.sql`foreign_document."autopartCustomerCode"`,
        Prisma.sql`foreign_document."companyId"`,
      )}
  )`;
  const documentSku = matchKey
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "AutopartSalesLine" sku_hit
        WHERE sku_hit."documentId" = d.id
          AND UPPER(btrim(sku_hit.sku)) = ${matchKey}
          AND sku_hit.source IN ('561L', 'ONGOING_TRM21QC')
      )`
    : Prisma.empty;
  const lineSku = matchKey ? Prisma.sql`AND UPPER(btrim(l.sku)) = ${matchKey}` : Prisma.empty;
  const ledgerSku = matchKey
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "FbaReplenishmentLine" ledger_hit
        WHERE ledger_hit."documentId" = d.id
          AND ledger_hit."supersededAt" IS NULL
          AND ledger_hit."matchKey" = ${matchKey}
      )`
    : Prisma.empty;
  return Prisma.sql`
    WITH retaila_owners AS (
      SELECT c.id, UPPER(btrim(c."autopartCustomerCode")) AS code
      FROM "Company" c
      WHERE c."autopartCustomerCodeVerifiedAt" IS NOT NULL
        AND (
          UPPER(btrim(c."autopartCustomerCode")) = ${RETAILA_AUTOPART_ACCOUNT}
          OR EXISTS (
            SELECT 1
            FROM "AutopartCustomerAccountAlias" alias_row
            WHERE alias_row."companyId" = c.id
              AND alias_row.alias = ${RETAILA_AUTOPART_ACCOUNT}
          )
        )
    ),
    window_refs AS MATERIALIZED (
      SELECT DISTINCT btrim(d."documentReference") AS stored_ref
      FROM "AutopartSalesDocument" d
      WHERE d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        AND d."documentReference" LIKE 'OIN%'
        AND d."documentReference" ~ '^OIN[A-Z0-9]+$'
        AND d."autopartCustomerCode" = ${RETAILA_AUTOPART_ACCOUNT}
        ${documentSku}
      UNION
      SELECT DISTINCT btrim(d."documentReference") AS stored_ref
      FROM "AutopartSalesDocument" d
      WHERE d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        AND d."documentReference" LIKE 'OIN%'
        AND d."documentReference" ~ '^OIN[A-Z0-9]+$'
        AND d."companyId" IN (SELECT id FROM retaila_owners)
        ${documentSku}
      UNION
      SELECT DISTINCT btrim(l."documentReference") AS stored_ref
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."autopartCustomerCode" = ${RETAILA_AUTOPART_ACCOUNT}
        AND l."documentReference" LIKE 'OIN%'
        AND l.source IN ('561L', 'ONGOING_TRM21QC')
        AND l."documentReference" ~ '^OIN[A-Z0-9]+$'
        AND d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        ${lineSku}
      UNION
      SELECT DISTINCT btrim(l."documentReference") AS stored_ref
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (SELECT id FROM retaila_owners)
        AND l."documentReference" LIKE 'OIN%'
        AND l.source IN ('561L', 'ONGOING_TRM21QC')
        AND l."documentReference" ~ '^OIN[A-Z0-9]+$'
        AND d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        ${lineSku}
    ),
    candidate_lines AS (
      SELECT
        l.id,
        l."companyId" AS company_id,
        UPPER(btrim(l."autopartCustomerCode")) AS account_code,
        l.sku,
        UPPER(btrim(l.sku)) AS sku_key,
        l."descriptionSnapshot" AS description,
        l."documentType"::text AS doc_type,
        UPPER(btrim(l."documentReference")) AS doc_ref,
        l.source,
        d."documentDate" AS doc_date,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l.units) ELSE l.units END)::numeric(18, 3) AS signed_qty,
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesNet") ELSE l."salesNet" END)::numeric(18, 2) AS signed_net,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM "Company" foreign_company
            WHERE foreign_company.id = l."companyId"
              AND foreign_company."autopartCustomerCodeVerifiedAt" IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM retaila_owners owner_company WHERE owner_company.id = foreign_company.id
              )
          )
          AND UPPER(btrim(l."autopartCustomerCode")) = ${RETAILA_AUTOPART_ACCOUNT}
            THEN 'foreign'
          WHEN ${lineAccount} THEN 'proven'
          ELSE 'other'
        END AS link_state
      FROM window_refs w
      INNER JOIN "AutopartSalesLine" l ON l."documentReference" = w.stored_ref
      LEFT JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l.source IN ('561L', 'ONGOING_TRM21QC')
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
    ),
    doc_owners AS (
      SELECT owners.doc_ref, owners.owner_id
      FROM (
        SELECT c.doc_ref, c.company_id AS owner_id
        FROM candidate_lines c
        INNER JOIN retaila_owners owner_company ON owner_company.id = c.company_id
        WHERE c.link_state = 'proven'
        UNION
        SELECT UPPER(btrim(h."documentReference")) AS doc_ref, h."companyId" AS owner_id
        FROM "AutopartSalesDocument" h
        INNER JOIN retaila_owners owner_company ON owner_company.id = h."companyId"
        WHERE h."has504" = TRUE
          AND h."documentReference" IN (SELECT stored_ref FROM window_refs)
          AND ${headerAccount}
      ) owners
      WHERE owners.doc_ref IS NOT NULL
        AND owners.owner_id IS NOT NULL
    ),
    doc_identity AS (
      SELECT doc_ref, COUNT(DISTINCT owner_id)::int AS owner_n, MIN(owner_id) AS owner_id
      FROM doc_owners
      GROUP BY doc_ref
    ),
    scoped_oin_lines AS MATERIALIZED (
      SELECT
        c.id,
        CASE
          WHEN COALESCE(ident.owner_n, 0) > 1 THEN 'ambiguous:' || c.doc_ref
          WHEN COALESCE(ident.owner_n, 0) = 1 THEN ident.owner_id
          ELSE 'account:' || ${RETAILA_AUTOPART_ACCOUNT}
        END AS company_key,
        c.account_code,
        c.sku,
        c.sku_key,
        c.description,
        c.doc_type,
        c.doc_ref,
        c.source,
        c.doc_date,
        c.signed_qty,
        c.signed_net
      FROM candidate_lines c
      LEFT JOIN doc_identity ident ON ident.doc_ref = c.doc_ref
      WHERE c.link_state = 'proven'
      UNION ALL
      SELECT
        c.id,
        'ambiguous:' || c.doc_ref AS company_key,
        c.account_code,
        c.sku,
        c.sku_key,
        c.description,
        c.doc_type,
        c.doc_ref,
        c.source,
        c.doc_date,
        c.signed_qty,
        c.signed_net
      FROM candidate_lines c
      WHERE c.link_state = 'foreign'
        AND NOT EXISTS (
          SELECT 1
          FROM candidate_lines proven_line
          WHERE proven_line.doc_ref = c.doc_ref
            AND proven_line.link_state = 'proven'
        )
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
          CASE
            WHEN COALESCE(ident.owner_n, 0) > 1 THEN 'ambiguous:' || UPPER(btrim(d."documentReference"))
            WHEN COALESCE(ident.owner_n, 0) = 1 THEN ident.owner_id
            ELSE 'account:' || ${RETAILA_AUTOPART_ACCOUNT}
          END AS company_key,
          UPPER(btrim(d."documentReference")) AS doc_ref,
          d."documentType"::text AS doc_type,
          d."goodsNet"::numeric(18, 2) AS goods_net
        FROM "AutopartSalesDocument" d
        LEFT JOIN doc_identity ident ON ident.doc_ref = UPPER(btrim(d."documentReference"))
        WHERE d."has504" = TRUE
          AND d."documentReference" IN (SELECT stored_ref FROM window_refs)
          AND ${goodsAccount}
      ) h
      LEFT JOIN preferred_lines pl
        ON pl.company_key = h.company_key AND pl.doc_ref = h.doc_ref AND pl.doc_type = h.doc_type
      WHERE pl.net IS NULL OR h.goods_net IS NULL OR ABS(h.goods_net - pl.net) > 0.01
      GROUP BY h.company_key, h.doc_ref
    ),
    issue_oin_documents AS (
      SELECT ds.company_key, ds.doc_ref,
        CASE
          WHEN ds.company_key LIKE 'ambiguous:%' THEN 'AMBIGUOUS_OWNER'
          WHEN ds.sources > 1 AND ds.signatures > 1 THEN 'SOURCE_CONFLICT'
          ELSE 'GOODS_MISMATCH'
        END AS issue
      FROM doc_status ds
      WHERE ds.company_key LIKE 'ambiguous:%'
         OR (ds.sources > 1 AND ds.signatures > 1)
         OR EXISTS (
           SELECT 1 FROM goods_hold g
           WHERE g.company_key = ds.company_key AND g.doc_ref = ds.doc_ref
         )
    ),
    counted_oin_lines AS MATERIALIZED (
      SELECT p.*
      FROM scoped_oin_lines p
      INNER JOIN doc_status ds ON ds.company_key = p.company_key AND ds.doc_ref = p.doc_ref
      WHERE ds.company_key NOT LIKE 'ambiguous:%'
        AND (ds.sources = 1 OR (ds.signatures = 1 AND p.source = ds.preferred))
        AND NOT EXISTS (
          SELECT 1 FROM goods_hold g
          WHERE g.company_key = p.company_key AND g.doc_ref = p.doc_ref
        )
    ),
    proven_ledger AS (
      SELECT d.id, d."documentReference", d."documentType", d."documentDate"
      FROM "FbaReplenishmentDocument" d
      WHERE d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        AND ${ledgerAccount}
        ${ledgerSku}
        AND NOT EXISTS (
          SELECT 1 FROM scoped_oin_lines s
          WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
            AND s.doc_type = d."documentType"
        )
        AND NOT ${foreignDocument}
    ),
    review_ledger AS (
      SELECT d.id, d."documentReference", d."documentType", d."documentDate"
      FROM "FbaReplenishmentDocument" d
      WHERE d."documentDate" >= ${range.from}
        AND d."documentDate" < ${range.toExclusive}
        AND (
          btrim(d."customerAccount") = ''
          OR (${ledgerAccount} AND ${foreignDocument})
        )
        ${ledgerSku}
        AND NOT EXISTS (
          SELECT 1 FROM scoped_oin_lines s
          WHERE s.doc_ref = UPPER(btrim(d."documentReference"))
            AND s.doc_type = d."documentType"
        )
        AND NOT EXISTS (SELECT 1 FROM proven_ledger proven WHERE proven.id = d.id)
    )
  `;
}

function num(value: { toString(): string } | number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function healthFrom(range: RetailaOinRange, row: {
  documents: number | null;
  lines: number | null;
  latest: Date | null;
  historicDocuments: number | null;
  ongoingDocuments: number | null;
  issues: number | null;
  undatedLines: number | null;
  ledgerOnlyDocuments: number | null;
} | undefined): RetailaOinHealth {
  const documents = row?.documents ?? 0;
  const issueCount = row?.issues ?? 0;
  let warning: string | null = null;
  if (documents === 0 && issueCount === 0) {
    warning = `No RETAILA OIN invoices are in the last ${range.days} days of Autopart sales history. Customer sales stay empty until those invoices are stored there. This page does not ask for the same 504 and TRM files again.`;
  } else if (issueCount > 0) {
    warning = `${issueCount.toLocaleString("en-GB")} RETAILA OIN document${issueCount === 1 ? "" : "s"} in the last ${range.days} days need review. Those quantities are left out so a correction is not counted twice.`;
  } else if ((row?.undatedLines ?? 0) > 0) {
    warning =
      "Some RETAILA OIN lines in this window have no document date, so they are shown in history and left out of the sales totals.";
  }
  return {
    account: RETAILA_AUTOPART_ACCOUNT,
    days: range.days,
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

export async function loadRetailaOinReport(
  range: RetailaOinRange,
): Promise<{ health: RetailaOinHealth; units: RetailaSkuSales[] }> {
  return withForecastQuery((db) => readRetailaOinReport(range, db));
}

function skuWindow(cutoff: Date | null, range: RetailaOinRange): Prisma.Sql {
  if (!cutoff) return Prisma.sql`NULL::numeric`;
  return Prisma.sql`CASE WHEN bool_or(doc_date IS NOT NULL) THEN ${datedWindowSum(cutoff, range, Prisma.sql`doc_date`, Prisma.sql`signed_qty`)} ELSE NULL END`;
}

async function readRetailaOinReport(
  range: RetailaOinRange,
  db: ForecastDb,
): Promise<{ health: RetailaOinHealth; units: RetailaSkuSales[] }> {
  const cuts = salesWindowCutoffs(range);
  const rows = await db.$queryRaw<
    Array<{
      section: string;
      matchKey: string | null;
      sku: string | null;
      units: Prisma.Decimal | null;
      d7: Prisma.Decimal | null;
      d30: Prisma.Decimal | null;
      d60: Prisma.Decimal | null;
      d90: Prisma.Decimal | null;
      d365: Prisma.Decimal | null;
      documents: number | null;
      lines: number | null;
      latest: Date | null;
      historicDocuments: number | null;
      ongoingDocuments: number | null;
      issues: number | null;
      undatedLines: number | null;
      ledgerOnlyDocuments: number | null;
    }>
  >`
    ${retailaOinWith(range)}
    , sku_totals AS (
      SELECT sku_key AS "matchKey", MAX(sku) AS sku,
        ${skuWindow(range.from, range)} AS units,
        ${skuWindow(cuts.d7, range)} AS d7,
        ${skuWindow(cuts.d30, range)} AS d30,
        ${skuWindow(cuts.d60, range)} AS d60,
        ${skuWindow(cuts.d90, range)} AS d90,
        ${skuWindow(cuts.d365, range)} AS d365
      FROM counted_oin_lines
      GROUP BY sku_key
    ),
    ledger_totals AS (
      SELECT l."matchKey" AS "matchKey", MAX(l.sku) AS sku,
        COALESCE(SUM(l.qty), 0) AS units,
        ${datedWindowSum(cuts.d7, range, Prisma.sql`d."documentDate"`, Prisma.sql`l.qty`)} AS d7,
        ${datedWindowSum(cuts.d30, range, Prisma.sql`d."documentDate"`, Prisma.sql`l.qty`)} AS d30,
        ${datedWindowSum(cuts.d60, range, Prisma.sql`d."documentDate"`, Prisma.sql`l.qty`)} AS d60,
        ${datedWindowSum(cuts.d90, range, Prisma.sql`d."documentDate"`, Prisma.sql`l.qty`)} AS d90,
        ${datedWindowSum(cuts.d365, range, Prisma.sql`d."documentDate"`, Prisma.sql`l.qty`)} AS d365
      FROM "FbaReplenishmentLine" l
      INNER JOIN proven_ledger d ON d.id = l."documentId"
      WHERE l."supersededAt" IS NULL
      GROUP BY l."matchKey"
    )
    SELECT 'sku'::text AS section, "matchKey", MAX(sku) AS sku,
      SUM(units) AS units, SUM(d7) AS d7, SUM(d30) AS d30, SUM(d60) AS d60, SUM(d90) AS d90, SUM(d365) AS d365,
      NULL::int AS documents, NULL::int AS lines, NULL::date AS latest,
      NULL::int AS "historicDocuments", NULL::int AS "ongoingDocuments",
      NULL::int AS issues, NULL::int AS "undatedLines", NULL::int AS "ledgerOnlyDocuments"
    FROM (
      SELECT * FROM sku_totals
      UNION ALL
      SELECT * FROM ledger_totals
    ) combined
    GROUP BY "matchKey"
    UNION ALL
    SELECT 'health'::text, NULL::text, NULL::text, NULL::numeric,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines),
      (SELECT COUNT(*)::int FROM counted_oin_lines),
      (SELECT MAX(doc_date) FROM counted_oin_lines),
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines WHERE source = '561L'),
      (SELECT COUNT(DISTINCT doc_ref)::int FROM counted_oin_lines WHERE source = 'ONGOING_TRM21QC'),
      (SELECT COUNT(*)::int FROM issue_oin_documents),
      (SELECT COUNT(*)::int FROM counted_oin_lines WHERE doc_date IS NULL),
      (SELECT COUNT(*)::int FROM proven_ledger)
  `;
  const healthRow = rows.find((row) => row.section === "health");
  return {
    health: healthFrom(range, healthRow),
    units: rows
      .filter((row) => row.section === "sku" && row.matchKey)
      .map((row) => ({
        matchKey: row.matchKey ?? "",
        sku: row.sku ?? "",
        units: row.units == null ? null : num(row.units),
        windows: {
          d7: row.d7 == null ? null : num(row.d7),
          d30: row.d30 == null ? null : num(row.d30),
          d60: row.d60 == null ? null : num(row.d60),
          d90: row.d90 == null ? null : num(row.d90),
          d365: row.d365 == null ? null : num(row.d365),
        },
      })),
  };
}

export async function explainRetailaOinReport(range: RetailaOinRange): Promise<string> {
  const cuts = salesWindowCutoffs(range);
  const rows = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    ${retailaOinWith(range)}
    SELECT sku_key AS "matchKey",
      ${skuWindow(range.from, range)} AS units,
      ${skuWindow(cuts.d7, range)} AS d7,
      ${skuWindow(cuts.d30, range)} AS d30,
      ${skuWindow(cuts.d60, range)} AS d60,
      ${skuWindow(cuts.d90, range)} AS d90,
      ${skuWindow(cuts.d365, range)} AS d365
    FROM counted_oin_lines
    GROUP BY sku_key
  `;
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, "").slice(0, 40)}%`;
}

export async function listRetailaOinHistory(input: {
  range: RetailaOinRange;
  page: number;
  pageSize: number;
  q?: string | null;
  sort?: RetailaOinHistorySort | null;
}): Promise<{ total: number; documents: RetailaOinHistoryDocument[] }> {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(50, Math.max(1, input.pageSize));
  const offset = (page - 1) * pageSize;
  const q = input.q?.trim().toUpperCase() ?? "";
  const sort = input.sort === "reference" || input.sort === "units" ? input.sort : "date";
  const orderSql =
    sort === "reference"
      ? Prisma.sql`"documentReference" ASC, "documentDate" DESC NULLS LAST`
      : sort === "units"
        ? Prisma.sql`units DESC, "documentDate" DESC NULLS LAST, "documentReference" ASC`
        : Prisma.sql`"documentDate" DESC NULLS LAST, "documentReference" ASC`;
  const filterSql = q
    ? Prisma.sql`(
        docs.doc_ref LIKE ${likeTerm(q)}
        OR EXISTS (
          SELECT 1 FROM scoped_oin_lines s
          WHERE s.doc_ref = docs.doc_ref AND (s.sku_key LIKE ${likeTerm(q)} OR s.sku LIKE ${likeTerm(q)})
        )
        OR EXISTS (
          SELECT 1 FROM "FbaReplenishmentLine" ledger_line
          WHERE ledger_line."documentId" = docs.ledger_id
            AND ledger_line."supersededAt" IS NULL
            AND ledger_line."matchKey" LIKE ${likeTerm(q)}
        )
      )`
    : Prisma.sql`TRUE`;
  const rows = await withForecastQuery((db) => db.$queryRaw<
    Array<{
      documentReference: string;
      documentType: string;
      documentDate: Date | null;
      source: string;
      status: string;
      units: Prisma.Decimal;
      total: number;
      lines: unknown;
    }>
  >`
    ${retailaOinWith(input.range)}
    , docs AS (
      SELECT doc_ref,
        NULL::text AS ledger_id,
        MIN(doc_type) AS doc_type,
        MIN(doc_date) AS doc_date,
        CASE WHEN bool_or(source = 'ONGOING_TRM21QC') THEN 'ONGOING_TRM21QC' ELSE '561L' END AS source,
        'COUNTED'::text AS status,
        SUM(signed_qty) AS units
      FROM counted_oin_lines
      GROUP BY doc_ref
      UNION ALL
      SELECT i.doc_ref, NULL::text, MIN(s.doc_type), MIN(s.doc_date), 'BOTH', i.issue, 0::numeric
      FROM issue_oin_documents i
      INNER JOIN scoped_oin_lines s ON s.company_key = i.company_key AND s.doc_ref = i.doc_ref
      GROUP BY i.doc_ref, i.issue
      UNION ALL
      SELECT UPPER(btrim(d."documentReference")), d.id, d."documentType", d."documentDate", 'LEDGER', 'LEDGER_ONLY',
        COALESCE(SUM(l.qty), 0)
      FROM proven_ledger d
      LEFT JOIN "FbaReplenishmentLine" l ON l."documentId" = d.id AND l."supersededAt" IS NULL
      GROUP BY d.id, d."documentReference", d."documentType", d."documentDate"
      UNION ALL
      SELECT UPPER(btrim(d."documentReference")), d.id, d."documentType", d."documentDate", 'LEDGER', 'LEDGER_REVIEW',
        0::numeric
      FROM review_ledger d
      GROUP BY d.id, d."documentReference", d."documentType", d."documentDate"
    ),
    filtered AS (
      SELECT * FROM docs
      WHERE ${filterSql}
    ),
    paged AS (
      SELECT filtered.*, COUNT(*) OVER ()::int AS total
      FROM filtered
    )
    SELECT
      paged.doc_ref AS "documentReference",
      paged.doc_type AS "documentType",
      paged.doc_date AS "documentDate",
      paged.source,
      paged.status,
      paged.units,
      paged.total,
      COALESCE((
        SELECT json_agg(json_build_object(
          'sku', line.sku,
          'description', line.description,
          'units', line.units,
          'source', line.source
        ) ORDER BY line.sku, line.source)
        FROM (
          SELECT c.sku, c.description, c.signed_qty AS units, c.source
          FROM counted_oin_lines c
          WHERE c.doc_ref = paged.doc_ref AND paged.status = 'COUNTED'
          UNION ALL
          SELECT s.sku, s.description, s.signed_qty, s.source
          FROM scoped_oin_lines s
          WHERE s.doc_ref = paged.doc_ref
            AND paged.status NOT IN ('COUNTED', 'LEDGER_ONLY', 'LEDGER_REVIEW')
          UNION ALL
          SELECT l.sku, l.description,
            CASE WHEN paged.status = 'LEDGER_REVIEW' THEN 0::numeric ELSE l.qty END,
            'LEDGER'
          FROM "FbaReplenishmentLine" l
          WHERE l."documentId" = paged.ledger_id
            AND l."supersededAt" IS NULL
            AND paged.status IN ('LEDGER_ONLY', 'LEDGER_REVIEW')
        ) line
      ), '[]'::json) AS lines
    FROM paged
    ORDER BY ${orderSql}
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  return {
    total: rows[0]?.total ?? 0,
    documents: rows.map((row) => ({
      documentReference: row.documentReference,
      documentType: row.documentType,
      documentDate: dateOnly(row.documentDate),
      source: row.source,
      status: row.status as RetailaOinHistoryDocument["status"],
      units: num(row.units),
      lines: parseLines(row.lines),
    })),
  };
}

function parseLines(value: unknown): RetailaOinHistoryLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const line = item as { sku?: unknown; description?: unknown; units?: unknown; source?: unknown };
    if (typeof line.sku !== "string") return [];
    return [
      {
        sku: line.sku,
        description: typeof line.description === "string" ? line.description : null,
        units: num(typeof line.units === "number" || typeof line.units === "string" ? line.units : 0),
        source: typeof line.source === "string" ? line.source : "",
      },
    ];
  });
}

export async function listRetailaOinLinesForSku(
  matchKey: string,
  range: RetailaOinRange,
): Promise<RetailaOinHistoryDocument[]> {
  const rows = await withForecastQuery((db) => db.$queryRaw<
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
    ${retailaOinWith(range, matchKey)}
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
    INNER JOIN proven_ledger d ON d.id = l."documentId"
    WHERE l."supersededAt" IS NULL
      AND l."matchKey" = ${matchKey}
    UNION ALL
    SELECT UPPER(btrim(d."documentReference")), d."documentType", d."documentDate", 'LEDGER', 'LEDGER_REVIEW',
      l.sku, l.description, 0::numeric
    FROM "FbaReplenishmentLine" l
    INNER JOIN review_ledger d ON d.id = l."documentId"
    WHERE l."supersededAt" IS NULL
      AND l."matchKey" = ${matchKey}
    ORDER BY "documentDate" DESC NULLS LAST, "documentReference"
    LIMIT 100
  `);
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
