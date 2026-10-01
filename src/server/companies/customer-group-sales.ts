/**
 * Customer Group sales reporting — aggregates AutopartSalesLine once across
 * member Companies (no Company + MAM double counting).
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import {
  ALL_DATED_HISTORY_QUERY_RANGE,
  documentDatePrismaBounds,
  lastNDaysRange,
  todayLondonDateOnly,
  type DateOnlyRange,
} from "@/domain/sales-history-period";
import {
  buildCsv,
  moneyMinorToDto,
  parseSalesNetMinor,
  totalsToDto,
} from "@/domain/sales-intelligence";
import {
  loadHistoricSalesLines,
  summarizeHistoricLines,
  type HistoricLineRow,
} from "@/server/sales-intelligence/historic-lines";
import { Prisma } from "@prisma/client";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import { resolveCustomerGroupCompanyIds } from "@/server/companies/customer-groups";

async function resolveGroupReportingScope(
  profile: LoadedAccessProfile,
): Promise<string[] | "all"> {
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope === "all" || scope.length > 0) return scope;
  // Internal ops with companies.view (no sales scope) see all group members.
  if (
    profile.actorType === "INTERNAL" &&
    hasPermission(profile, "companies.view") &&
    !hasPermission(profile, "sales.view_own_accounts") &&
    !hasPermission(profile, "sales.view_team_accounts")
  ) {
    return "all";
  }
  return scope;
}

const groupPeriodSchema = z.enum(["LAST_7", "LAST_30", "LAST_90", "LAST_365", "ALL", "CUSTOM"]);

function resolveGroupPeriod(
  periodRaw?: string | null,
  fromRaw?: string | null,
  toRaw?: string | null,
): DateOnlyRange {
  const today = todayLondonDateOnly();
  const parsed = groupPeriodSchema.safeParse(periodRaw ?? "LAST_30");
  const period = parsed.success ? parsed.data : "LAST_30";
  if (period === "ALL") return ALL_DATED_HISTORY_QUERY_RANGE;
  if (period === "CUSTOM") {
    return {
      from: fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : "0001-01-01",
      to: toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : "9999-12-31",
    };
  }
  if (period === "LAST_7") return lastNDaysRange(today, 7);
  if (period === "LAST_90") return lastNDaysRange(today, 90);
  if (period === "LAST_365") return lastNDaysRange(today, 365);
  return lastNDaysRange(today, 30);
}

async function requireGroupReporting(userId: string) {
  const profile = await requireSystemPermission(userId, "customer_groups.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot access Customer Group reporting", "FORBIDDEN", 403);
  }
  return profile;
}

function emptyBucket() {
  return {
    units: 0,
    netSalesMinor: 0n,
    invoiceSalesMinor: 0n,
    creditsMinor: 0n,
    docs: new Set<string>(),
    skus: new Set<string>(),
    lastDate: null as string | null,
  };
}

function accumulateBucket(
  bucket: ReturnType<typeof emptyBucket>,
  line: HistoricLineRow,
) {
  const minor = parseSalesNetMinor(line.salesNet);
  bucket.units += Number(line.units ?? 0);
  bucket.netSalesMinor += minor;
  if (line.documentType === "INVOICE") {
    bucket.invoiceSalesMinor += minor;
  } else if (line.documentType === "CREDIT") {
    bucket.creditsMinor += minor;
  }
  bucket.docs.add(`${line.companyId}:${line.documentType}:${line.documentReference}`);
  bucket.skus.add(line.sku.trim().toUpperCase());
  const d = line.document?.documentDate?.toISOString().slice(0, 10) ?? null;
  if (d && (!bucket.lastDate || d > bucket.lastDate)) bucket.lastDate = d;
}

function bucketToDto(bucket: ReturnType<typeof emptyBucket>) {
  return {
    units: bucket.units,
    netSales: moneyMinorToDto(bucket.netSalesMinor),
    invoiceSales: moneyMinorToDto(bucket.invoiceSalesMinor),
    credits: moneyMinorToDto(bucket.creditsMinor),
    documents: bucket.docs.size,
    productsPurchased: bucket.skus.size,
    lastPurchase: bucket.lastDate,
  };
}

export async function getCustomerGroupSalesSummary(actorUserId: string, raw: unknown) {
  const profile = await requireGroupReporting(actorUserId);
  const input = z
    .object({
      groupId: z.string().cuid(),
      period: groupPeriodSchema.optional(),
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
      companyId: z.string().cuid().optional().nullable(),
      mamAccount: z.string().max(80).optional().nullable(),
    })
    .parse(raw ?? {});

  const scope = await resolveGroupReportingScope(profile);
  const resolved = await resolveCustomerGroupCompanyIds(input.groupId, scope);
  let companyIds = resolved.companyIds;
  if (input.companyId) {
    if (!companyIds.includes(input.companyId)) {
      throw new AuthError("Company is not in this Customer Group (or out of scope)", "FORBIDDEN", 403);
    }
    companyIds = [input.companyId];
  }

  const range = resolveGroupPeriod(input.period, input.from, input.to);
  const mamFilter = input.mamAccount?.trim().toUpperCase() || null;
  const bounds = documentDatePrismaBounds(range);

  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: resolved.companyIds } },
        select: {
          id: true,
          name: true,
          tradingName: true,
          autopartCustomerCode: true,
          autopartAccountAliases: { select: { alias: true, label: true } },
          assignments: {
            where: { isPrimary: true },
            take: 1,
            select: {
              salesRep: {
                select: {
                  displayName: true,
                  user: { select: { name: true, email: true } },
                },
              },
            },
          },
        },
      })
    : [];
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const lineWhere: Prisma.AutopartSalesLineWhereInput =
    companyIds.length === 0
      ? { companyId: "__none__" }
      : {
          companyId: { in: companyIds },
          ...(mamFilter
            ? { autopartCustomerCode: { equals: mamFilter, mode: "insensitive" as const } }
            : {}),
          document: {
            is: {
              companyId: { not: null },
              documentDate: { gte: bounds.gte, lte: bounds.lte },
            },
          },
        };

  // Prefer DB aggregation for large retail histories — avoid loading 60k+ rows into Node.
  const lineCount =
    companyIds.length === 0 ? 0 : await prisma.autopartSalesLine.count({ where: lineWhere });

  let summary: {
    invoiceSales: string;
    credits: string;
    netSales: string;
    units: number;
    purchaseTransactions: number;
    productsPurchased: number;
    customers: number;
    documents: number;
    lastPurchase: string | null;
  };
  let byCompanyMap = new Map<string, ReturnType<typeof emptyBucket>>();
  let byMamMap = new Map<string, ReturnType<typeof emptyBucket> & { companyId: string }>();
  let products: Array<{
    sku: string;
    description: string | null;
    units: number;
    netSales: string;
    invoiceSales: string;
    credits: string;
    documents: number;
    productsPurchased: number;
    lastPurchase: string | null;
  }> = [];

  if (lineCount <= 25_000) {
    const lines =
      companyIds.length === 0
        ? []
        : await loadHistoricSalesLines({
            companyId: { in: companyIds },
            range,
          });
    const filtered = mamFilter
      ? lines.filter((l) => l.autopartCustomerCode.trim().toUpperCase() === mamFilter)
      : lines;
    const summaryTotals = summarizeHistoricLines(filtered);
    summary = {
      ...totalsToDto(summaryTotals),
      documents: new Set(
        filtered.map((l) => `${l.companyId}:${l.documentType}:${l.documentReference}`),
      ).size,
      lastPurchase: filtered.reduce<string | null>((acc, l) => {
        const d = l.document?.documentDate?.toISOString().slice(0, 10) ?? null;
        if (!d) return acc;
        return !acc || d > acc ? d : acc;
      }, null),
    };
    for (const line of filtered) {
      let cb = byCompanyMap.get(line.companyId);
      if (!cb) {
        cb = emptyBucket();
        byCompanyMap.set(line.companyId, cb);
      }
      accumulateBucket(cb, line);
      const mam = line.autopartCustomerCode.trim().toUpperCase() || "UNKNOWN";
      let mb = byMamMap.get(mam);
      if (!mb) {
        mb = { ...emptyBucket(), companyId: line.companyId };
        byMamMap.set(mam, mb);
      }
      accumulateBucket(mb, line);
    }
    const bySku = new Map<string, ReturnType<typeof emptyBucket> & { desc: string | null }>();
    for (const line of filtered) {
      const key = line.sku.trim().toUpperCase();
      let row = bySku.get(key);
      if (!row) {
        row = { ...emptyBucket(), desc: line.descriptionSnapshot };
        bySku.set(key, row);
      }
      accumulateBucket(row, line);
      if (!row.desc && line.descriptionSnapshot) row.desc = line.descriptionSnapshot;
    }
    products = [...bySku.entries()]
      .map(([sku, row]) => ({
        sku,
        description: row.desc,
        ...bucketToDto(row),
      }))
      .sort((a, b) => Number(b.netSales) - Number(a.netSales))
      .slice(0, 200);
  } else {
    const byCompanyType = await prisma.autopartSalesLine.groupBy({
      by: ["companyId", "documentType"],
      where: lineWhere,
      _sum: { salesNet: true, units: true },
    });
    const byMamType = await prisma.autopartSalesLine.groupBy({
      by: ["autopartCustomerCode", "companyId", "documentType"],
      where: lineWhere,
      _sum: { salesNet: true, units: true },
    });
    const bySkuAgg = await prisma.autopartSalesLine.groupBy({
      by: ["sku"],
      where: lineWhere,
      _sum: { salesNet: true, units: true },
      orderBy: { _sum: { salesNet: "desc" } },
      take: 200,
    });
    const distinctDocs = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT 1
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        WHERE l."companyId" IN (${Prisma.join(companyIds)})
          AND d."documentDate" >= ${bounds.gte}
          AND d."documentDate" <= ${bounds.lte}
          ${mamFilter ? Prisma.sql`AND UPPER(l."autopartCustomerCode") = ${mamFilter}` : Prisma.empty}
        GROUP BY l."companyId", l."documentType", l."documentReference"
      ) t
    `;
    const lastDoc = await prisma.autopartSalesDocument.findFirst({
      where: {
        companyId: { in: companyIds },
        documentDate: { gte: bounds.gte, lte: bounds.lte },
        ...(mamFilter
          ? { autopartCustomerCode: { equals: mamFilter, mode: "insensitive" } }
          : {}),
      },
      orderBy: { documentDate: "desc" },
      select: { documentDate: true },
    });
    const skuCount = await prisma.autopartSalesLine.groupBy({
      by: ["sku"],
      where: lineWhere,
    });

    let net = 0n;
    let inv = 0n;
    let cred = 0n;
    let units = 0;
    byCompanyMap = new Map();
    for (const row of byCompanyType) {
      const minor = parseSalesNetMinor(row._sum.salesNet);
      let bucket = byCompanyMap.get(row.companyId);
      if (!bucket) {
        bucket = emptyBucket();
        byCompanyMap.set(row.companyId, bucket);
      }
      bucket.units += Number(row._sum.units ?? 0);
      bucket.netSalesMinor += minor;
      units += Number(row._sum.units ?? 0);
      net += minor;
      if (row.documentType === "INVOICE") {
        bucket.invoiceSalesMinor += minor;
        inv += minor;
      } else if (row.documentType === "CREDIT") {
        bucket.creditsMinor += minor;
        cred += minor;
      }
    }
    byMamMap = new Map();
    for (const row of byMamType) {
      const mam = row.autopartCustomerCode.trim().toUpperCase() || "UNKNOWN";
      const minor = parseSalesNetMinor(row._sum.salesNet);
      let bucket = byMamMap.get(mam);
      if (!bucket) {
        bucket = { ...emptyBucket(), companyId: row.companyId };
        byMamMap.set(mam, bucket);
      }
      bucket.units += Number(row._sum.units ?? 0);
      bucket.netSalesMinor += minor;
      if (row.documentType === "INVOICE") bucket.invoiceSalesMinor += minor;
      else if (row.documentType === "CREDIT") bucket.creditsMinor += minor;
    }
    summary = {
      invoiceSales: moneyMinorToDto(inv),
      credits: moneyMinorToDto(cred),
      netSales: moneyMinorToDto(net),
      units,
      purchaseTransactions: 0,
      productsPurchased: skuCount.length,
      customers: byCompanyMap.size,
      documents: Number(distinctDocs[0]?.count ?? 0),
      lastPurchase: lastDoc?.documentDate?.toISOString().slice(0, 10) ?? null,
    };
    products = bySkuAgg.map((row) => ({
      sku: row.sku,
      description: null,
      units: Number(row._sum.units ?? 0),
      netSales: moneyMinorToDto(parseSalesNetMinor(row._sum.salesNet)),
      invoiceSales: moneyMinorToDto(0n),
      credits: moneyMinorToDto(0n),
      documents: 0,
      productsPurchased: 1,
      lastPurchase: null,
    }));
  }

  const byCompany = resolved.companyIds
    .map((id) => {
      const c = companyById.get(id);
      const bucket = byCompanyMap.get(id) ?? emptyBucket();
      const rep = c?.assignments[0]?.salesRep;
      return {
        companyId: id,
        name: c?.name ?? id,
        tradingName: c?.tradingName ?? null,
        mamAccounts:
          (c?.autopartCustomerCode ? 1 : 0) + (c?.autopartAccountAliases.length ?? 0),
        salesperson: rep
          ? rep.displayName || rep.user.name || rep.user.email
          : null,
        ...bucketToDto(bucket),
      };
    })
    .sort((a, b) => Number(b.netSales) - Number(a.netSales));

  const byMamAccount = [...byMamMap.entries()]
    .map(([accountCode, bucket]) => {
      const c = companyById.get(bucket.companyId);
      const aliasLabel =
        c?.autopartAccountAliases.find((a) => a.alias === accountCode)?.label ?? null;
      return {
        accountCode,
        label: aliasLabel,
        companyId: bucket.companyId,
        companyName: c?.name ?? null,
        ...bucketToDto(bucket),
      };
    })
    .sort((a, b) => Number(b.netSales) - Number(a.netSales));

  // Salesperson breakdown (informational — ownership remains on Company)
  const bySalesperson = new Map<string, { name: string; netSalesMinor: bigint; companies: Set<string> }>();
  for (const row of byCompany) {
    const key = row.salesperson ?? "Unassigned";
    let entry = bySalesperson.get(key);
    if (!entry) {
      entry = { name: key, netSalesMinor: 0n, companies: new Set() };
      bySalesperson.set(key, entry);
    }
    entry.netSalesMinor += parseSalesNetMinor(row.netSales);
    entry.companies.add(row.companyId);
  }

  const mamAccountCount = companies.reduce(
    (n, c) => n + (c.autopartCustomerCode ? 1 : 0) + c.autopartAccountAliases.length,
    0,
  );

  return {
    group: {
      id: resolved.group.id,
      name: resolved.group.name,
      active: resolved.group.active,
      companyCount: resolved.companyIds.length,
      mamAccountCount,
    },
    period: range,
    filter: {
      companyId: input.companyId ?? null,
      mamAccount: mamFilter,
    },
    summary,
    byCompany,
    byMamAccount,
    products,
    bySalesperson: [...bySalesperson.values()]
      .map((s) => ({
        name: s.name,
        companyCount: s.companies.size,
        netSales: moneyMinorToDto(s.netSalesMinor),
      }))
      .sort((a, b) => Number(b.netSales) - Number(a.netSales)),
  };
}

export async function listCustomerGroupDocuments(actorUserId: string, raw: unknown) {
  const profile = await requireGroupReporting(actorUserId);
  const input = z
    .object({
      groupId: z.string().cuid(),
      period: groupPeriodSchema.optional(),
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
      companyId: z.string().cuid().optional().nullable(),
      mamAccount: z.string().max(80).optional().nullable(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .parse(raw ?? {});

  const scope = await resolveGroupReportingScope(profile);
  const resolved = await resolveCustomerGroupCompanyIds(input.groupId, scope);
  let companyIds = resolved.companyIds;
  if (input.companyId) {
    if (!companyIds.includes(input.companyId)) {
      throw new AuthError("Company is not in this Customer Group (or out of scope)", "FORBIDDEN", 403);
    }
    companyIds = [input.companyId];
  }
  const range = resolveGroupPeriod(input.period, input.from, input.to);
  const bounds = documentDatePrismaBounds(range);
  const mamFilter = input.mamAccount?.trim().toUpperCase() || null;
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;

  if (companyIds.length === 0) {
    return {
      total: 0,
      page,
      pageSize,
      items: [] as Array<{
        companyId: string;
        companyName: string;
        documentType: string;
        documentReference: string;
        documentDate: string | null;
        mamAccount: string;
        units: number;
        netSales: string;
        lineCount: number;
      }>,
    };
  }

  // Paginate documents in the DB — never load tens of thousands of lines into Node.
  const docWhere: Prisma.AutopartSalesDocumentWhereInput = {
    companyId: { in: companyIds },
    documentDate: { gte: bounds.gte, lte: bounds.lte },
    ...(mamFilter
      ? { autopartCustomerCode: { equals: mamFilter, mode: "insensitive" as const } }
      : {}),
  };

  const [total, docs] = await Promise.all([
    prisma.autopartSalesDocument.count({ where: docWhere }),
    prisma.autopartSalesDocument.findMany({
      where: docWhere,
      orderBy: [{ documentDate: "desc" }, { documentReference: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        companyId: true,
        documentType: true,
        documentReference: true,
        documentDate: true,
        autopartCustomerCode: true,
      },
    }),
  ]);

  const docIds = docs.map((d) => d.id);
  const lineAggs =
    docIds.length === 0
      ? []
      : await prisma.autopartSalesLine.groupBy({
          by: ["documentId"],
          where: { documentId: { in: docIds } },
          _sum: { units: true, salesNet: true },
          _count: { _all: true },
        });
  const aggByDocId = new Map(
    lineAggs.map((a) => [
      a.documentId!,
      {
        units: Number(a._sum.units ?? 0),
        netSalesMinor: parseSalesNetMinor(a._sum.salesNet),
        lineCount: a._count._all,
      },
    ]),
  );

  const companies = await prisma.company.findMany({
    where: { id: { in: [...new Set(docs.map((d) => d.companyId!).filter(Boolean))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.name]));

  return {
    total,
    page,
    pageSize,
    items: docs.map((d) => {
      const agg = aggByDocId.get(d.id) ?? {
        units: 0,
        netSalesMinor: 0n,
        lineCount: 0,
      };
      return {
        companyId: d.companyId!,
        companyName: nameById.get(d.companyId!) ?? d.companyId!,
        documentType: d.documentType,
        documentReference: d.documentReference,
        documentDate: d.documentDate?.toISOString().slice(0, 10) ?? null,
        mamAccount: d.autopartCustomerCode,
        units: agg.units,
        netSales: moneyMinorToDto(agg.netSalesMinor),
        lineCount: agg.lineCount,
      };
    }),
  };
}

export async function listCustomerGroupProductLines(actorUserId: string, raw: unknown) {
  const profile = await requireGroupReporting(actorUserId);
  const input = z
    .object({
      groupId: z.string().cuid(),
      period: groupPeriodSchema.optional(),
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
      companyId: z.string().cuid().optional().nullable(),
      mamAccount: z.string().max(80).optional().nullable(),
      documentReference: z.string().max(80).optional().nullable(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(5000).optional(),
    })
    .parse(raw ?? {});

  const scope = await resolveGroupReportingScope(profile);
  const resolved = await resolveCustomerGroupCompanyIds(input.groupId, scope);
  let companyIds = resolved.companyIds;
  if (input.companyId) {
    if (!companyIds.includes(input.companyId)) {
      throw new AuthError("Company is not in this Customer Group (or out of scope)", "FORBIDDEN", 403);
    }
    companyIds = [input.companyId];
  }
  const range = resolveGroupPeriod(input.period, input.from, input.to);
  const bounds = documentDatePrismaBounds(range);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 100;
  const mamFilter = input.mamAccount?.trim().toUpperCase() || null;
  const docRef = input.documentReference?.trim().toUpperCase() || null;

  if (companyIds.length === 0) {
    return {
      total: 0,
      page,
      pageSize,
      items: [] as Array<{
        companyId: string;
        companyName: string;
        mamAccount: string;
        documentType: string;
        documentReference: string;
        documentDate: string | null;
        sku: string;
        description: string | null;
        units: number;
        netSales: string;
      }>,
    };
  }

  const lineWhere: Prisma.AutopartSalesLineWhereInput = {
    companyId: { in: companyIds },
    ...(mamFilter
      ? { autopartCustomerCode: { equals: mamFilter, mode: "insensitive" as const } }
      : {}),
    ...(docRef
      ? { documentReference: { equals: docRef, mode: "insensitive" as const } }
      : {}),
    document: {
      is: {
        companyId: { not: null },
        documentDate: { gte: bounds.gte, lte: bounds.lte },
      },
    },
  };

  const [total, lines] = await Promise.all([
    prisma.autopartSalesLine.count({ where: lineWhere }),
    prisma.autopartSalesLine.findMany({
      where: lineWhere,
      orderBy: [{ documentReference: "desc" }, { lineNumber: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        companyId: true,
        autopartCustomerCode: true,
        documentType: true,
        documentReference: true,
        sku: true,
        descriptionSnapshot: true,
        units: true,
        salesNet: true,
        document: { select: { documentDate: true } },
      },
    }),
  ]);

  const companies = await prisma.company.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.companyId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.name]));

  return {
    total,
    page,
    pageSize,
    items: lines.map((l) => ({
      companyId: l.companyId,
      companyName: nameById.get(l.companyId) ?? l.companyId,
      mamAccount: l.autopartCustomerCode,
      documentType: l.documentType,
      documentReference: l.documentReference,
      documentDate: l.document?.documentDate?.toISOString().slice(0, 10) ?? null,
      sku: l.sku,
      description: l.descriptionSnapshot,
      units: Number(l.units ?? 0),
      netSales: moneyMinorToDto(parseSalesNetMinor(l.salesNet)),
    })),
  };
}

export async function exportCustomerGroupSalesCsv(actorUserId: string, raw: unknown) {
  const input = z
    .object({
      groupId: z.string().cuid(),
      period: groupPeriodSchema.optional(),
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
      companyId: z.string().cuid().optional().nullable(),
      mamAccount: z.string().max(80).optional().nullable(),
    })
    .parse(raw ?? {});
  const all = await listCustomerGroupProductLines(actorUserId, {
    ...input,
    page: 1,
    pageSize: 5000,
  });
  const group = await prisma.customerGroup.findUnique({
    where: { id: input.groupId },
    select: { name: true },
  });
  const headers = [
    "Customer Group",
    "Company",
    "MAM Account",
    "Document",
    "Document Type",
    "Date",
    "SKU",
    "Description",
    "Quantity",
    "Net Sales",
  ];
  const rows = all.items.map((r) => [
    group?.name ?? input.groupId,
    r.companyName,
    r.mamAccount,
    r.documentReference,
    r.documentType,
    r.documentDate ?? "",
    r.sku,
    r.description ?? "",
    String(r.units),
    r.netSales,
  ]);
  return {
    filename: `customer-group-${(group?.name ?? input.groupId).replace(/[^\w.-]+/g, "_")}-sales.csv`,
    csv: buildCsv(headers, rows),
    rowCount: rows.length,
    truncated: all.total > rows.length,
  };
}
