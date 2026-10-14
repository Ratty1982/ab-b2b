/**
 * Read-only reconciliation investigation for one customer's historical sales.
 *
 * Selects unreconciled documents and ambiguous account mappings. It does not
 * update invoices, delete duplicates, change certification, or mark a row reconciled.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { buildCsv } from "@/domain/sales-intelligence";
import {
  AMBIGUOUS_ACCOUNT_REASON,
  compareDocumentLines,
  goodsAgainstLinesDifference,
  LINE_COMPARISON_VIEWS,
  lineMatchesComparisonView,
  sourceSpread,
  RECONCILIATION_DOCUMENT_TYPES,
  RECONCILIATION_READ_ONLY_NOTE,
  RECONCILIATION_REASONS,
  RECONCILIATION_SOURCES,
  reconciliationActions,
  reconciliationReasonLabel,
  RECONCILIATION_ACTION_GUIDANCE,
  RECONCILIATION_ACTION_LABELS,
  type LineComparisonView,
  type ReconciliationAction,
  type ReconciliationDocumentType,
  type ReconciliationReason,
} from "@/domain/sales-reconciliation";
import { unifiedSourceLabel, type UnifiedSource } from "@/domain/unified-sales";
import { AuthError } from "@/server/rbac/guards";
import { grants, type LoadedAccessProfile } from "@/server/rbac/access";
import {
  assertCompanyInScope,
  csvSafe,
  decimalString,
  requireSalesIntelligence,
} from "@/server/sales-intelligence/global-history";
import { withReportSql, reportDb } from "@/server/sales-intelligence/report-guard";
import { unifiedLinesCte } from "@/server/sales-intelligence/unified-sales";

const AUTOPART_SOURCE = "AUTOPART";
const LINE_CAP = 8_000;
const DISPLAY_CAP = 100;
const EXPORT_MAX_ROWS = 20_000;
const VIEW_VALUES = LINE_COMPARISON_VIEWS as unknown as [LineComparisonView, ...LineComparisonView[]];
const REASON_VALUES = RECONCILIATION_REASONS as unknown as [ReconciliationReason, ...ReconciliationReason[]];
const SOURCE_VALUES = RECONCILIATION_SOURCES as unknown as [UnifiedSource, ...UnifiedSource[]];
const DOC_VALUES = RECONCILIATION_DOCUMENT_TYPES as unknown as [
  ReconciliationDocumentType,
  ...ReconciliationDocumentType[],
];

const filterSchema = z.object({
  companyId: z.string().min(1),
  reason: z.enum(REASON_VALUES).optional().nullable(),
  accountCode: z.string().max(40).optional().nullable(),
  source: z.enum(SOURCE_VALUES).optional().nullable(),
  documentType: z.enum(DOC_VALUES).optional().nullable(),
  comparison: z.enum(VIEW_VALUES).optional().nullable(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});

type FilterInput = {
  companyId: string;
  reason?: ReconciliationReason;
  accountCode?: string;
  source?: UnifiedSource;
  documentType?: ReconciliationDocumentType;
  comparison: LineComparisonView;
};

function blankToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normaliseFilters(raw: z.infer<typeof filterSchema>): FilterInput {
  const accountCode = blankToUndefined(raw.accountCode)?.toUpperCase();
  const filters: FilterInput = { companyId: raw.companyId, comparison: raw.comparison ?? "DIFFERENCES" };
  if (raw.reason) filters.reason = raw.reason;
  if (accountCode) filters.accountCode = accountCode;
  if (raw.source) filters.source = raw.source;
  if (raw.documentType) filters.documentType = raw.documentType;
  return filters;
}

function canInvestigate(profile: LoadedAccessProfile): boolean {
  return grants(profile, "sales.view_all_accounts", "admin.access");
}

function reportKey(kind: string, filters: FilterInput, page: number, pageSize: number): string {
  return [
    kind,
    filters.companyId,
    filters.reason ?? "",
    filters.accountCode ?? "",
    filters.source ?? "",
    filters.documentType ?? "",
    filters.comparison,
    page,
    pageSize,
  ].join("|");
}

function investigationCte(filters: FilterInput): Prisma.Sql {
  const includeAmbiguous = !filters.reason || filters.reason === AMBIGUOUS_ACCOUNT_REASON;
  const unifiedParts: Prisma.Sql[] = [Prisma.sql`u.status = 'UNRECONCILED'`];
  if (filters.reason === AMBIGUOUS_ACCOUNT_REASON) unifiedParts.push(Prisma.sql`FALSE`);
  else if (filters.reason) unifiedParts.push(Prisma.sql`u.reason = ${filters.reason}`);
  if (filters.accountCode) unifiedParts.push(Prisma.sql`u.account_code = ${filters.accountCode}`);
  if (filters.documentType) unifiedParts.push(Prisma.sql`u.doc_type = ${filters.documentType}`);
  const unifiedWhere = Prisma.join(unifiedParts, " AND ");
  const ambiguousGate = includeAmbiguous ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
  const accountHistorical = filters.accountCode
    ? Prisma.sql`AND UPPER(btrim(l."accountCode")) = ${filters.accountCode}`
    : Prisma.empty;
  const accountDated = filters.accountCode
    ? Prisma.sql`AND UPPER(btrim(l."autopartCustomerCode")) = ${filters.accountCode}`
    : Prisma.empty;
  const accountHeader = filters.accountCode
    ? Prisma.sql`AND UPPER(btrim(d."autopartCustomerCode")) = ${filters.accountCode}`
    : Prisma.empty;
  const typeHistorical = filters.documentType
    ? Prisma.sql`AND (CASE WHEN l."documentType" IN ('INVOICE', 'CREDIT') THEN l."documentType" ELSE 'UNKNOWN' END) = ${filters.documentType}`
    : Prisma.empty;
  const typeDated = filters.documentType
    ? Prisma.sql`AND l."documentType"::text = ${filters.documentType}`
    : Prisma.empty;
  const typeHeader = filters.documentType
    ? Prisma.sql`AND d."documentType"::text = ${filters.documentType}`
    : Prisma.empty;
  const visibleSource = filters.source ? Prisma.sql`source = ${filters.source}` : Prisma.sql`TRUE`;

  return Prisma.sql`
    ${unifiedLinesCte([filters.companyId], null)}
    , company_codes AS (
      SELECT DISTINCT code
      FROM (
        SELECT UPPER(btrim(c."autopartCustomerCode")) AS code
        FROM "Company" c
        WHERE c.id = ${filters.companyId}
          AND c."autopartCustomerCodeVerifiedAt" IS NOT NULL
        UNION ALL
        SELECT UPPER(btrim(al."alias"))
        FROM "AutopartCustomerAccountAlias" al
        WHERE al."companyId" = ${filters.companyId}
        UNION ALL
        SELECT UPPER(btrim(a."accountCode"))
        FROM "AutopartAccount" a
        WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
          AND a."companyId" = ${filters.companyId}
      ) codes
      WHERE code <> ''
    )
    , ambiguous_codes AS (
      SELECT owners.code
      FROM (
        SELECT UPPER(btrim(c."autopartCustomerCode")) AS code, c.id AS company_id
        FROM "Company" c
        WHERE c."autopartCustomerCodeVerifiedAt" IS NOT NULL
          AND UPPER(btrim(c."autopartCustomerCode")) IN (SELECT code FROM company_codes)
        UNION ALL
        SELECT UPPER(btrim(al."alias")), al."companyId"
        FROM "AutopartCustomerAccountAlias" al
        WHERE UPPER(btrim(al."alias")) IN (SELECT code FROM company_codes)
        UNION ALL
        SELECT UPPER(btrim(a."accountCode")), a."companyId"
        FROM "AutopartAccount" a
        WHERE a."sourceSystem" = ${AUTOPART_SOURCE}
          AND a."companyId" IS NOT NULL
          AND UPPER(btrim(a."accountCode")) IN (SELECT code FROM company_codes)
      ) owners
      WHERE owners.code <> ''
      GROUP BY owners.code
      HAVING COUNT(DISTINCT owners.company_id) > 1
    )
    , headers_504 AS (
      SELECT
        NULLIF(UPPER(btrim(d."documentReference")), '') AS doc_ref,
        d."documentType"::text AS doc_type,
        MAX(d."goodsNet")::numeric(18, 2) AS goods_net
      FROM "AutopartSalesDocument" d
      WHERE d."has504" = TRUE
        AND NULLIF(UPPER(btrim(d."documentReference")), '') IS NOT NULL
        AND (
          d."companyId" = ${filters.companyId}
          OR UPPER(btrim(d."autopartCustomerCode")) IN (SELECT code FROM ambiguous_codes)
        )
      GROUP BY 1, 2
    )
    , base AS MATERIALIZED (
      SELECT
        u.line_id,
        u.source,
        u.account_code,
        u.doc_type,
        u.doc_ref,
        u.sku,
        u.qty,
        u.net,
        u.reason,
        COALESCE(u.doc_ref, 'LINE:' || u.line_id) AS group_ref
      FROM u
      WHERE ${unifiedWhere}
      UNION ALL
      SELECT
        l.id,
        'HISTORICAL_561L'::text,
        UPPER(btrim(l."accountCode")),
        CASE WHEN l."documentType" IN ('INVOICE', 'CREDIT') THEN l."documentType" ELSE 'UNKNOWN' END,
        NULLIF(UPPER(btrim(COALESCE(l."documentReference", ''))), ''),
        UPPER(btrim(l."partNumber")),
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."quantity") ELSE l."quantity" END)::numeric(18, 3),
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesAmount") ELSE l."salesAmount" END)::numeric(18, 2),
        ${AMBIGUOUS_ACCOUNT_REASON}::text,
        COALESCE(NULLIF(UPPER(btrim(COALESCE(l."documentReference", ''))), ''), 'LINE:' || l.id)
      FROM "AutopartInvoiceLine" l
      INNER JOIN ambiguous_codes a ON a.code = UPPER(btrim(l."accountCode"))
      WHERE ${ambiguousGate}
        AND l."salesMeasure" = 'NET_EX_VAT'
        ${accountHistorical}
        ${typeHistorical}
      UNION ALL
      SELECT
        l.id,
        CASE WHEN l."source" = 'ONGOING_TRM21QC' THEN 'TRM21QC_FEED' ELSE 'COMPANY_561L_SLRB' END,
        UPPER(btrim(l."autopartCustomerCode")),
        l."documentType"::text,
        NULLIF(UPPER(btrim(l."documentReference")), ''),
        UPPER(btrim(l."sku")),
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."units") ELSE l."units" END)::numeric(18, 3),
        (CASE WHEN l."documentType" = 'CREDIT' THEN -ABS(l."salesNet") ELSE l."salesNet" END)::numeric(18, 2),
        ${AMBIGUOUS_ACCOUNT_REASON}::text,
        COALESCE(NULLIF(UPPER(btrim(l."documentReference")), ''), 'LINE:' || l.id)
      FROM "AutopartSalesLine" l
      INNER JOIN ambiguous_codes a ON a.code = UPPER(btrim(l."autopartCustomerCode"))
      WHERE ${ambiguousGate}
        AND l."documentType" IN ('INVOICE', 'CREDIT', 'UNKNOWN')
        ${accountDated}
        ${typeDated}
      UNION ALL
      SELECT
        d.id,
        'ONGOING_504'::text,
        UPPER(btrim(d."autopartCustomerCode")),
        d."documentType"::text,
        NULLIF(UPPER(btrim(d."documentReference")), ''),
        ''::text,
        0::numeric(18, 3),
        COALESCE(d."goodsNet", 0)::numeric(18, 2),
        ${AMBIGUOUS_ACCOUNT_REASON}::text,
        COALESCE(NULLIF(UPPER(btrim(d."documentReference")), ''), 'LINE:' || d.id)
      FROM "AutopartSalesDocument" d
      INNER JOIN ambiguous_codes a ON a.code = UPPER(btrim(d."autopartCustomerCode"))
      WHERE ${ambiguousGate}
        AND d."has504" = TRUE
        ${accountHeader}
        ${typeHeader}
    )
    , visible AS MATERIALIZED (
      SELECT * FROM base
      WHERE ${visibleSource}
    )
    , doc_keys AS (
      SELECT DISTINCT group_ref, doc_type FROM visible
    )
    , grouped AS (
      SELECT
        k.group_ref,
        k.doc_type,
        MIN(b.doc_ref) AS doc_ref,
        MIN(b.account_code) AS account_code,
        COUNT(v.line_id)::int AS line_count,
        COALESCE(SUM(b.net) FILTER (WHERE b.source <> 'ONGOING_504'), 0)::numeric(18, 2) AS product_net,
        array_agg(DISTINCT b.source)::text[] AS sources,
        array_agg(DISTINCT b.reason)::text[] AS reasons
      FROM doc_keys k
      INNER JOIN base b ON b.group_ref = k.group_ref AND b.doc_type = k.doc_type
      LEFT JOIN visible v ON v.line_id = b.line_id AND v.source = b.source
      GROUP BY k.group_ref, k.doc_type
    )
  `;
}

type RawInvestigationRow = {
  total: number;
  groupOrd: number | null;
  groupRef: string | null;
  docType: string | null;
  docRef: string | null;
  accountCode: string | null;
  lineCount: number | null;
  productNet: Prisma.Decimal | null;
  goodsNet: Prisma.Decimal | null;
  sources: string[] | null;
  reasons: string[] | null;
  sourceTotals: unknown;
  lineId: string | null;
  sku: string | null;
  qty: Prisma.Decimal | null;
  net: Prisma.Decimal | null;
  source: string | null;
  reason: string | null;
  difference: Prisma.Decimal | null;
};

type SourceTotal = { source: string; sourceLabel: string; qty: string; net: string; lineCount: number };

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asSourceTotals(value: unknown): SourceTotal[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { source?: unknown; net?: unknown; qty?: unknown; lines?: unknown };
    if (typeof row.source !== "string") return [];
    return [
      {
        source: row.source,
        sourceLabel: unifiedSourceLabel(row.source),
        net: String(row.net ?? "0.00"),
        qty: String(row.qty ?? "0"),
        lineCount: Number(row.lines ?? 0),
      },
    ];
  });
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function foldDocuments(rows: RawInvestigationRow[], view: LineComparisonView) {
  const total = Number(rows[0]?.total ?? 0);
  const documents = new Map<
    string,
    {
      order: number;
      id: string;
      reference: string | null;
      documentType: string;
      accountCode: string;
      reasons: string[];
      actions: ReconciliationAction[];
      sources: SourceTotal[];
      goodsNet: string | null;
      productLineNet: string;
      difference: string | null;
      lineCount: number;
      lines: Array<{
        lineId: string;
        sku: string;
        qty: string;
        net: string;
        source: string;
        sourceLabel: string;
        invoiceReference: string | null;
        reason: string;
        reasonLabel: string;
        difference: string;
      }>;
    }
  >();
  for (const row of rows) {
    if (!row.groupRef || !row.docType) continue;
    const key = `${row.groupRef}|${row.docType}`;
    let document = documents.get(key);
    if (!document) {
      const goodsNet = row.goodsNet == null ? null : decimalString(row.goodsNet, 2);
      const productLineNet = decimalString(row.productNet, 2);
      const reasons = asStringList(row.reasons);
      const sources = asSourceTotals(row.sourceTotals);
      document = {
        order: Number(row.groupOrd ?? 0),
        id: key,
        reference: row.docRef,
        documentType: row.docType,
        accountCode: row.accountCode ?? "",
        reasons,
        actions: reconciliationActions(reasons),
        sources,
        goodsNet,
        productLineNet,
        difference:
          goodsAgainstLinesDifference(goodsNet, productLineNet) ??
          sourceSpread(sources.map((source) => source.net)),
        lineCount: Number(row.lineCount ?? 0),
        lines: [],
      };
      documents.set(key, document);
    }
    if (row.lineId && row.source && row.reason) {
      document.lines.push({
        lineId: row.lineId,
        sku: row.sku ?? "",
        qty: decimalString(row.qty, 3),
        net: decimalString(row.net, 2),
        source: row.source,
        sourceLabel: unifiedSourceLabel(row.source),
        invoiceReference: row.docRef,
        reason: row.reason,
        reasonLabel: reconciliationReasonLabel(row.reason),
        difference: decimalString(row.difference, 2),
      });
    }
  }
  return {
    total,
    documents: [...documents.values()]
      .sort((left, right) => left.order - right.order)
      .map((document) => {
        const compared = compareDocumentLines({
          lines: document.lines.map((line) => ({
            lineId: line.lineId,
            source: line.source,
            sku: line.sku,
            qty: line.qty,
            net: line.net,
            reason: line.reason,
          })),
          sources: document.sources.map((source) => ({
            source: source.source,
            sourceLabel: source.sourceLabel,
            lineCount: source.lineCount,
            net: source.net,
          })),
        });
        const visibleRows = compared.rows.filter((row) => lineMatchesComparisonView(row.kind, view));
        const loadedLines = document.sources.reduce((sum, source) => sum + source.lineCount, 0);
        return {
          id: document.id,
          reference: document.reference,
          documentType: document.documentType,
          accountCode: document.accountCode,
          reasons: document.reasons,
          reasonLabels: document.reasons.map((reason) => reconciliationReasonLabel(reason)),
          actions: document.actions,
          actionLabels: document.actions.map((action) => RECONCILIATION_ACTION_LABELS[action]),
          guidance: document.actions.map((action) => RECONCILIATION_ACTION_GUIDANCE[action]),
          sources: document.sources,
          goodsNet: document.goodsNet,
          productLineNet: document.productLineNet,
          difference: document.difference,
          lineCount: document.lineCount,
          comparison: {
            view,
            matching: compared.matching,
            missing: compared.missing,
            quantityChanged: compared.quantityChanged,
            netChanged: compared.netChanged,
            repeated: compared.repeated,
            held: compared.held,
            summary: compared.summary,
            totalDifference: compared.totalDifference ?? document.difference,
            totalDifferenceSummary:
              compared.totalDifferenceSummary ??
              (document.goodsNet != null
                ? `504 goods total ${document.goodsNet} differs from product lines ${document.productLineNet} by ${document.difference ?? "0.00"}. This is not certified sales.`
                : null),
            rows: visibleRows.slice(0, DISPLAY_CAP),
            rowsTruncated: visibleRows.length > DISPLAY_CAP || loadedLines > document.lines.length,
          },
        };
      }),
  };
}

async function queryInvestigationPage(filters: FilterInput, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const rows = await reportDb().$queryRaw<RawInvestigationRow[]>`
    ${investigationCte(filters)}
    SELECT
      totals.total,
      page.group_ord AS "groupOrd",
      page.group_ref AS "groupRef",
      page.doc_type AS "docType",
      page.doc_ref AS "docRef",
      page.account_code AS "accountCode",
      page.line_count AS "lineCount",
      page.product_net AS "productNet",
      page.goods_net AS "goodsNet",
      page.sources,
      page.reasons,
      page.source_totals AS "sourceTotals",
      line.line_id AS "lineId",
      line.sku,
      line.qty,
      line.net,
      line.source,
      line.reason,
      line.difference
    FROM (SELECT COUNT(*)::int AS total FROM doc_keys) totals
    LEFT JOIN LATERAL (
      SELECT
        g.group_ref,
        g.doc_type,
        g.doc_ref,
        g.account_code,
        g.line_count,
        g.product_net,
        h.goods_net,
        g.sources,
        g.reasons,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'source', s.source,
            'net', s.net::text,
            'qty', s.qty::text,
            'lines', s.lines
          ) ORDER BY s.source), '[]'::json)
          FROM (
            SELECT b.source,
              SUM(b.net)::numeric(18, 2) AS net,
              SUM(b.qty)::numeric(18, 3) AS qty,
              COUNT(*)::int AS lines
            FROM base b
            WHERE b.group_ref = g.group_ref AND b.doc_type = g.doc_type
            GROUP BY b.source
          ) s
        ) AS source_totals,
        ROW_NUMBER() OVER (
          ORDER BY ABS(COALESCE(h.goods_net, 0) - g.product_net) DESC, g.group_ref ASC, g.doc_type ASC
        ) AS group_ord
      FROM grouped g
      LEFT JOIN headers_504 h ON h.doc_ref = g.group_ref AND h.doc_type = g.doc_type
      ORDER BY ABS(COALESCE(h.goods_net, 0) - g.product_net) DESC, g.group_ref ASC, g.doc_type ASC
      LIMIT ${pageSize} OFFSET ${offset}
    ) page ON TRUE
    LEFT JOIN LATERAL (
      SELECT numbered.line_id, numbered.sku, numbered.qty, numbered.net, numbered.source,
        numbered.reason, numbered.difference
      FROM (
        SELECT
          b.line_id,
          b.sku,
          b.qty,
          b.net,
          b.source,
          b.reason,
          b.net AS difference,
          ROW_NUMBER() OVER (ORDER BY b.sku ASC, b.source ASC, b.line_id ASC) AS n
        FROM base b
        WHERE b.group_ref = page.group_ref AND b.doc_type = page.doc_type
      ) numbered
      WHERE numbered.n <= ${LINE_CAP}
    ) line ON page.group_ref IS NOT NULL
  `;
  const folded = foldDocuments(rows, filters.comparison);
  return {
    permitted: true as const,
    readOnlyNote: RECONCILIATION_READ_ONLY_NOTE,
    page,
    pageSize,
    total: folded.total,
    documents: folded.documents,
  };
}

export async function getSalesReconciliationInvestigation(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const parsed = filterSchema.parse(raw ?? {});
  await assertCompanyInScope(profile, parsed.companyId);
  if (!canInvestigate(profile)) return { permitted: false as const };
  const filters = normaliseFilters(parsed);
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 10;
  return withReportSql(reportKey("reconcile-detail", filters, page, pageSize), () =>
    queryInvestigationPage(filters, page, pageSize),
  );
}

type ExportRow = {
  docRef: string | null;
  docType: string;
  accountCode: string;
  lineId: string;
  sku: string;
  qty: Prisma.Decimal;
  net: Prisma.Decimal;
  source: string;
  reason: string;
  goodsNet: Prisma.Decimal | null;
};

function discrepancyCsvRows(rows: ExportRow[], view: LineComparisonView, customerName: string): string[][] {
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const key = `${row.docRef ?? ""}|${row.docType}|${row.accountCode}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const csvRows: string[][] = [];
  for (const group of groups.values()) {
    const head = group[0];
    if (!head) continue;
    const sourceMap = new Map<string, { net: Prisma.Decimal; lines: number }>();
    for (const row of group) {
      if (row.source === "ONGOING_504") continue;
      const current = sourceMap.get(row.source) ?? { net: new Prisma.Decimal(0), lines: 0 };
      current.net = current.net.plus(row.net);
      current.lines += 1;
      sourceMap.set(row.source, current);
    }
    const sources = [...sourceMap.entries()].map(([source, total]) => ({
      source,
      sourceLabel: unifiedSourceLabel(source),
      lineCount: total.lines,
      net: total.net.toFixed(2),
    }));
    const compared = compareDocumentLines({
      lines: group.map((row) => ({
        lineId: row.lineId,
        source: row.source,
        sku: row.sku,
        qty: decimalString(row.qty, 3),
        net: decimalString(row.net, 2),
        reason: row.reason,
      })),
      sources,
    });
    const goodsNet = head.goodsNet == null ? null : decimalString(head.goodsNet, 2);
    const productNet = sources
      .reduce((sum, source) => sum.plus(new Prisma.Decimal(source.net)), new Prisma.Decimal(0))
      .toFixed(2);
    const goodsDifference = goodsAgainstLinesDifference(goodsNet, productNet);
    const sourceTotals = sources.map((source) => `${source.sourceLabel} ${source.lineCount} lines ${source.net}`).join("; ");
    const totalDifference = compared.totalDifference ?? goodsDifference ?? "";
    const actionLabel = reconciliationActions([...new Set(group.map((row) => row.reason))])
      .map((item) => RECONCILIATION_ACTION_LABELS[item])
      .join("; ");
    if (view === "DIFFERENCES" && (compared.totalDifference || goodsDifference)) {
      csvRows.push(
        [
          customerName,
          head.docRef ?? "",
          head.docType,
          head.accountCode,
          "Document total",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          sourceTotals,
          totalDifference ?? "",
          goodsNet ?? "",
          actionLabel,
        ].map(csvSafe),
      );
    }
    for (const occurrence of compared.rows.filter((row) => lineMatchesComparisonView(row.kind, view))) {
      const present = occurrence.sources.filter((source) => !source.missing);
      csvRows.push(
        [
          customerName,
          head.docRef ?? "",
          head.docType,
          head.accountCode,
          occurrence.label,
          occurrence.sku,
          String(occurrence.occurrence),
          present.map((source) => source.sourceLabel).join("; ") || occurrence.sources.map((source) => source.sourceLabel).join("; "),
          present.map((source) => `${source.sourceLabel} ${source.qty ?? "missing"}`).join("; "),
          present.map((source) => `${source.sourceLabel} ${source.net ?? "missing"}`).join("; "),
          occurrence.qtyDifference ?? "",
          occurrence.netDifference ?? "",
          sourceTotals,
          totalDifference ?? "",
          goodsNet ?? "",
          actionLabel,
        ].map(csvSafe),
      );
    }
  }
  return csvRows;
}

export async function exportSalesReconciliationCsv(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const parsed = filterSchema.parse(raw ?? {});
  const { company } = await assertCompanyInScope(profile, parsed.companyId);
  if (!canInvestigate(profile)) {
    throw new AuthError("Reconciliation investigation is limited to management.", "FORBIDDEN", 403);
  }
  const filters = normaliseFilters(parsed);
  const rows = await withReportSql(reportKey("reconcile-export", filters, 1, EXPORT_MAX_ROWS), () =>
    reportDb().$queryRaw<ExportRow[]>`
      ${investigationCte(filters)}
      SELECT
        b.doc_ref AS "docRef",
        b.doc_type AS "docType",
        b.account_code AS "accountCode",
        b.line_id AS "lineId",
        b.sku,
        b.qty,
        b.net,
        b.source,
        b.reason,
        h.goods_net AS "goodsNet"
      FROM base b
      INNER JOIN doc_keys k ON k.group_ref = b.group_ref AND k.doc_type = b.doc_type
      LEFT JOIN headers_504 h ON h.doc_ref = b.group_ref AND h.doc_type = b.doc_type
      ORDER BY b.doc_ref ASC NULLS LAST, b.sku ASC, b.source ASC, b.line_id ASC
      LIMIT ${EXPORT_MAX_ROWS + 1}
    `,
  );
  const truncated = rows.length > EXPORT_MAX_ROWS;
  const limited = truncated ? rows.slice(0, EXPORT_MAX_ROWS) : rows;
  const headers = [
    "Customer",
    "Invoice reference",
    "Document type",
    "Account",
    "Finding",
    "SKU",
    "Occurrence",
    "Source",
    "Quantity",
    "Signed net",
    "Quantity difference",
    "Net difference",
    "Source totals",
    "Total difference",
    "504 goods total",
    "Action required",
  ];
  const csvRows = discrepancyCsvRows(limited, filters.comparison, company.name);
  const safeName = company.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || company.id;
  const filename =
    filters.comparison === "DIFFERENCES"
      ? `reconciliation-discrepancies-${safeName}.csv`
      : `reconciliation-lines-${safeName}.csv`;
  return {
    filename,
    csv: buildCsv(headers, csvRows),
    truncated,
    rowCount: csvRows.length,
    readOnlyNote: RECONCILIATION_READ_ONLY_NOTE,
  };
}
