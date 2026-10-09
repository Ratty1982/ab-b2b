/**
 * Internal CRM view of global Autopart invoice lines.
 * Staff visibility does not use historicalAccessEnabled or the portal flag.
 * Ledger money stays out of this payload.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireCompanyAccess } from "@/server/rbac/guards";
import type { LoadedAccessProfile } from "@/server/rbac/access";

const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

export type GlobalHistoryBatch = {
  id: string;
  filename: string;
  kind: string;
  completedAt: string | null;
};

export type CompanyGlobalAutopartHistory = {
  restricted: boolean;
  source: "GLOBAL_AUTOPART_IMPORT" | "NONE";
  mappingStatus: "LINKED" | "UNLINKED";
  accounts: Array<{
    id: string;
    accountCode: string;
    originalName: string;
    mappingStatus: "LINKED";
    portalHistoricalAccess: boolean;
    classification: string;
  }>;
  lineCount: number | null;
  documentCount: number | null;
  productsPurchased: number | null;
  netSalesExVat: string | null;
  salesExVat: string | null;
  creditsExVat: string | null;
  zeroLineCount: number | null;
  salesLineCount: number | null;
  creditLineCount: number | null;
  netQuantity: string | null;
  purchaseDate: null;
  purchaseDateNote: string;
  ledgerRowCount: number | null;
  latestBatch: GlobalHistoryBatch | null;
  products: Array<{ partNumber: string; quantity: string; netSalesExVat: string }>;
  nativeOrdersIncluded: false;
  label: string;
};

function money2(value: { toFixed: (digits: number) => string } | null | undefined): string {
  if (value == null) return "0.00";
  return value.toFixed(2);
}

function qty3(value: { toFixed: (digits: number) => string } | null | undefined): string {
  if (value == null) return "0.000";
  return value.toFixed(3);
}

async function staffProfile(actorUserId: string, companyId: string): Promise<LoadedAccessProfile> {
  const profile = await requireCompanyAccess(actorUserId, companyId);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot view internal Autopart history", "FORBIDDEN", 403);
  }
  return profile;
}

export async function loadCompanyGlobalAutopartHistory(
  actorUserId: string,
  companyId: string,
): Promise<CompanyGlobalAutopartHistory> {
  const profile = await staffProfile(actorUserId, companyId);
  const canHistory = profile.permissions.has("autopart.history.view");
  const canLedger = profile.permissions.has("autopart.ledger.view");
  const accounts = await prisma.autopartAccount.findMany({
    where: { companyId },
    orderBy: { accountCode: "asc" },
    select: {
      id: true,
      accountCode: true,
      originalName: true,
      classification: true,
      historicalAccessEnabled: true,
    },
  });
  const codes = accounts.map((account) => account.accountCode);
  const mapped = accounts.map((account) => ({
    id: account.id,
    accountCode: account.accountCode,
    originalName: account.originalName,
    mappingStatus: "LINKED" as const,
    portalHistoricalAccess: account.historicalAccessEnabled,
    classification: account.classification,
  }));
  const purchaseDateNote =
    "Imported 561L product lines have no source invoice date. No purchase date is invented from the ledger.";

  if (!canHistory) {
    return {
      restricted: true,
      source: "NONE",
      mappingStatus: codes.length ? "LINKED" : "UNLINKED",
      accounts: mapped,
      lineCount: null,
      documentCount: null,
      productsPurchased: null,
      netSalesExVat: null,
      salesExVat: null,
      creditsExVat: null,
      zeroLineCount: null,
      salesLineCount: null,
      creditLineCount: null,
      netQuantity: null,
      purchaseDate: null,
      purchaseDateNote,
      ledgerRowCount: null,
      latestBatch: null,
      products: [],
      nativeOrdersIncluded: false,
      label: "Autopart historical sales are restricted for this user.",
    };
  }

  if (codes.length === 0) {
    return emptyHistory(mapped, purchaseDateNote, canLedger ? 0 : null);
  }

  const where = { accountCode: { in: codes } };
  const [all, sales, credits, documents, productsPurchased, products, latestBatch, ledgerRowCount] =
    await Promise.all([
      prisma.autopartInvoiceLine.aggregate({
        where,
        _count: { _all: true },
        _sum: { salesAmount: true, quantity: true },
      }),
      prisma.autopartInvoiceLine.aggregate({
        where: { ...where, salesAmount: { gt: 0 } },
        _count: { _all: true },
        _sum: { salesAmount: true },
      }),
      prisma.autopartInvoiceLine.aggregate({
        where: { ...where, salesAmount: { lt: 0 } },
        _count: { _all: true },
        _sum: { salesAmount: true },
      }),
      countDistinctDocuments(codes),
      countDistinctProducts(codes),
      prisma.autopartInvoiceLine.groupBy({
        by: ["partNumber"],
        where,
        _sum: { quantity: true, salesAmount: true },
        orderBy: { _sum: { salesAmount: "desc" } },
        take: 10,
      }),
      prisma.autopartImportBatch.findFirst({
        where: { invoiceLines: { some: where } },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, filename: true, kind: true, completedAt: true },
      }),
      canLedger ? prisma.autopartLedgerTransaction.count({ where }) : Promise.resolve(null),
    ]);

  const lineCount = all._count._all;
  const salesLineCount = sales._count._all;
  const creditLineCount = credits._count._all;
  return {
    restricted: false,
    source: lineCount > 0 ? "GLOBAL_AUTOPART_IMPORT" : "NONE",
    mappingStatus: "LINKED",
    accounts: mapped,
    lineCount,
    documentCount: documents,
    productsPurchased,
    netSalesExVat: money2(all._sum.salesAmount),
    salesExVat: money2(sales._sum.salesAmount),
    creditsExVat: money2(credits._sum.salesAmount),
    zeroLineCount: lineCount - salesLineCount - creditLineCount,
    salesLineCount,
    creditLineCount,
    netQuantity: qty3(all._sum.quantity),
    purchaseDate: null,
    purchaseDateNote,
    ledgerRowCount,
    latestBatch: latestBatch
      ? {
          id: latestBatch.id,
          filename: latestBatch.filename,
          kind: latestBatch.kind,
          completedAt: latestBatch.completedAt?.toISOString() ?? null,
        }
      : null,
    products: products.map((row) => ({
      partNumber: row.partNumber,
      quantity: qty3(row._sum.quantity),
      netSalesExVat: money2(row._sum.salesAmount),
    })),
    nativeOrdersIncluded: false,
    label:
      "Autopart historical product lines for the linked account. Net sales exclude VAT. This is not native B2B order turnover and not a customer balance.",
  };
}

function emptyHistory(
  accounts: CompanyGlobalAutopartHistory["accounts"],
  purchaseDateNote: string,
  ledgerRowCount: number | null,
): CompanyGlobalAutopartHistory {
  return {
    restricted: false,
    source: "NONE",
    mappingStatus: accounts.length ? "LINKED" : "UNLINKED",
    accounts,
    lineCount: 0,
    documentCount: 0,
    productsPurchased: 0,
    netSalesExVat: "0.00",
    salesExVat: "0.00",
    creditsExVat: "0.00",
    zeroLineCount: 0,
    salesLineCount: 0,
    creditLineCount: 0,
    netQuantity: "0.000",
    purchaseDate: null,
    purchaseDateNote,
    ledgerRowCount,
    latestBatch: null,
    products: [],
    nativeOrdersIncluded: false,
    label:
      "No global Autopart invoice lines are linked to this company. A missing legacy company import is not treated as missing global history.",
  };
}

async function countDistinctDocuments(codes: string[]): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ documents: number }>>`
    SELECT COUNT(*)::int AS documents
    FROM (
      SELECT 1
      FROM "AutopartInvoiceLine"
      WHERE "accountCode" IN (${Prisma.join(codes)})
        AND "documentReference" IS NOT NULL
        AND btrim("documentReference") <> ''
      GROUP BY "accountCode", COALESCE("documentType", ''), "documentReference"
    ) docs
  `;
  return Number(rows[0]?.documents ?? 0);
}

async function countDistinctProducts(codes: string[]): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ products: number }>>`
    SELECT COUNT(DISTINCT "partNumber")::int AS products
    FROM "AutopartInvoiceLine"
    WHERE "accountCode" IN (${Prisma.join(codes)})
  `;
  return Number(rows[0]?.products ?? 0);
}

export async function listCompanyAutopartInvoiceLines(
  actorUserId: string,
  input: { companyId: string; q?: string; page?: number },
) {
  const profile = await staffProfile(actorUserId, input.companyId);
  if (!profile.permissions.has("autopart.history.view")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  const page =
    input.page != null && Number.isFinite(input.page) && input.page > 0
      ? Math.min(Math.floor(input.page), MAX_PAGE)
      : 1;
  const accounts = await prisma.autopartAccount.findMany({
    where: { companyId: input.companyId },
    select: { accountCode: true },
  });
  const codes = accounts.map((account) => account.accountCode);
  const q = input.q?.trim() ?? "";
  if (codes.length === 0) {
    return {
      total: 0,
      page,
      pageSize: PAGE_SIZE,
      salesMeasure: "NET_EX_VAT",
      purchaseDateNote:
        "Imported 561L product lines have no source invoice date. No purchase date is invented from the ledger.",
      items: [],
    };
  }
  const where: Prisma.AutopartInvoiceLineWhereInput = {
    accountCode: { in: codes },
    ...(q
      ? {
          OR: [
            { partNumber: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { rawInvAndLn: { contains: q, mode: "insensitive" } },
            { documentReference: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.autopartInvoiceLine.count({ where }),
    prisma.autopartInvoiceLine.findMany({
      where,
      orderBy: [{ accountCode: "asc" }, { rawInvAndLn: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        accountCode: true,
        rawInvAndLn: true,
        documentReference: true,
        documentType: true,
        partNumber: true,
        description: true,
        quantity: true,
        salesAmount: true,
        salesMeasure: true,
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    salesMeasure: "NET_EX_VAT" as const,
    purchaseDateNote:
      "Imported 561L product lines have no source invoice date. No purchase date is invented from the ledger.",
    items: items.map((item) => ({
      id: item.id,
      accountCode: item.accountCode,
      rawInvAndLn: item.rawInvAndLn,
      documentReference: item.documentReference,
      documentType: item.documentType,
      partNumber: item.partNumber,
      description: item.description,
      quantity: item.quantity.toFixed(3),
      salesAmount: item.salesAmount.toFixed(2),
      salesMeasure: item.salesMeasure,
      purchaseDate: null as null,
    })),
  };
}

export function purchaseDataStatus(input: {
  restricted: boolean;
  globalLines: number | null;
  legacyLines: number;
}): "GLOBAL" | "LEGACY" | "NOT_IMPORTED" | "RESTRICTED" {
  if (input.restricted) return "RESTRICTED";
  if ((input.globalLines ?? 0) > 0) return "GLOBAL";
  if (input.legacyLines > 0) return "LEGACY";
  return "NOT_IMPORTED";
}
