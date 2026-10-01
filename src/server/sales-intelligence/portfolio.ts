/**
 * Sales Intelligence — Sales Rep Portfolio.
 *
 * Aggregates AutopartSalesLine via SQL/groupBy. Does not load all lines into memory.
 * Credits remain signed negative; cadence/presence use INVOICE documents only.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import { chunkArray, SAFE_IN_LIST_CHUNK } from "@/server/db/prisma-in-chunks";
import {
  addDaysIso,
  daysInclusive,
  formatUkDateRangeLabel,
  previousComparableBusinessPeriod,
  resolveBusinessPeriod,
  todayLondonDateOnly,
  type DateOnlyRange,
  type ResolvedBusinessPeriod,
} from "@/domain/sales-history-period";
import { moneyMinorToDto, parseSalesNetMinor, percentChangeMinor } from "@/domain/sales-intelligence";
import { derivePurchaseCadence, formatCadenceTableLines } from "@/domain/sales-cadence";
import {
  attentionSortKey,
  buildAttentionReasons,
  cadenceLineForCard,
  classifyPeriodMovement,
  isSignificantStoppedBuying,
  needsAttention,
} from "@/domain/sales-attention";
import {
  buildBrandGapOpportunity,
  buildCrossSellOpportunity,
  buildStoppedProductOpportunity,
  compareOpportunityRows,
  PORTFOLIO_CROSS_SELL_CONFIG,
  PORTFOLIO_DEFAULT_PERIOD,
  PORTFOLIO_PAGE_SIZE,
  PORTFOLIO_TOP_OPPORTUNITIES_LIMIT,
  rowMatchesPortfolioFilter,
  type PortfolioCustomerRow,
  type PortfolioFilter,
  type PortfolioKpis,
  type PortfolioOpportunity,
} from "@/domain/sales-portfolio";

async function requirePortfolioActor(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

function canSelectSalesRep(profile: LoadedAccessProfile): boolean {
  return (
    hasPermission(profile, "sales.view_all_accounts") ||
    hasPermission(profile, "admin.access") ||
    hasPermission(profile, "sales.view_team_accounts")
  );
}

const querySchema = z.object({
  period: z.string().optional().nullable(),
  from: z.string().optional().nullable(),
  to: z.string().optional().nullable(),
  salesRepId: z.string().optional().nullable(),
  unassigned: z.boolean().optional().nullable(),
  customerGroupId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  filter: z.string().optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  page: z.number().int().min(1).optional().nullable(),
  pageSize: z.number().int().min(1).max(200).optional().nullable(),
  /** Internal: return all matching rows (CSV / detail). Not for UI pagination. */
  allRows: z.boolean().optional().nullable(),
});

type PortfolioQuery = z.infer<typeof querySchema>;

async function resolvePortfolioCompanyIds(
  profile: LoadedAccessProfile,
  input: PortfolioQuery,
): Promise<{ companyIds: string[]; salesRepFilterLabel: string | null }> {
  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope !== "all" && scope.length === 0) {
    return { companyIds: [], salesRepFilterLabel: null };
  }

  let companyIds = scope === "all" ? null : [...scope];

  // Sales reps without view-all: force their own portfolio (ignore foreign salesRepId).
  const actorRep = await prisma.salesRep.findFirst({
    where: { userId: profile.userId, active: true },
    select: { id: true, user: { select: { name: true } } },
  });

  if (!canSelectSalesRep(profile)) {
    if (!actorRep) return { companyIds: [], salesRepFilterLabel: null };
    const assigned = await prisma.companyAssignment.findMany({
      where: { salesRepId: actorRep.id },
      select: { companyId: true },
    });
    const assignedIds = assigned.map((a) => a.companyId);
    const filtered =
      companyIds == null ? assignedIds : assignedIds.filter((id) => companyIds!.includes(id));
    return {
      companyIds: filtered,
      salesRepFilterLabel: actorRep.user.name ?? "My portfolio",
    };
  }

  if (input.unassigned) {
    const assigned = await prisma.companyAssignment.findMany({
      select: { companyId: true },
      distinct: ["companyId"],
    });
    const assignedSet = new Set(assigned.map((a) => a.companyId));
    if (companyIds == null) {
      const all = await prisma.company.findMany({
        where: { status: { in: ["ACTIVE", "ON_HOLD", "PENDING_APPROVAL", "PROSPECT"] } },
        select: { id: true },
        take: 50_000,
      });
      companyIds = all.map((c) => c.id).filter((id) => !assignedSet.has(id));
    } else {
      companyIds = companyIds.filter((id) => !assignedSet.has(id));
    }
    return { companyIds, salesRepFilterLabel: "Unassigned" };
  }

  if (input.salesRepId) {
    const assigned = await prisma.companyAssignment.findMany({
      where: { salesRepId: input.salesRepId },
      select: { companyId: true },
    });
    const assignedIds = assigned.map((a) => a.companyId);
    const rep = await prisma.salesRep.findUnique({
      where: { id: input.salesRepId },
      select: { user: { select: { name: true } }, code: true },
    });
    const filtered =
      companyIds == null ? assignedIds : assignedIds.filter((id) => companyIds!.includes(id));
    return {
      companyIds: filtered,
      salesRepFilterLabel: rep?.user.name ?? rep?.code ?? "Sales rep",
    };
  }

  if (companyIds == null) {
    // Management "all" — still bound to companies that have sales or assignments for practicality.
    // Pull active companies with Autopart history or assignment in chunks via sales presence later.
    const companies = await prisma.company.findMany({
      where: {
        OR: [
          { autopartCustomerCode: { not: null } },
          { assignments: { some: {} } },
          { autopartSalesLines: { some: {} } },
        ],
      },
      select: { id: true },
      take: 20_000,
    });
    companyIds = companies.map((c) => c.id);
  }

  if (input.customerGroupId) {
    const members = await prisma.company.findMany({
      where: { customerGroupId: input.customerGroupId, id: { in: companyIds } },
      select: { id: true },
    });
    companyIds = members.map((m) => m.id);
  }

  return { companyIds, salesRepFilterLabel: null };
}

async function netSalesByCompany(
  companyIds: string[],
  range: DateOnlyRange,
  brandId?: string | null,
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (companyIds.length === 0) return out;
  const bounds = {
    gte: new Date(`${range.from}T00:00:00.000Z`),
    lte: new Date(`${range.to}T23:59:59.999Z`),
  };

  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    if (brandId) {
      const rows = await prisma.$queryRaw<Array<{ companyId: string; net: Prisma.Decimal }>>`
        SELECT l."companyId" AS "companyId", COALESCE(SUM(l."salesNet"), 0) AS net
        FROM "AutopartSalesLine" l
        INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
        LEFT JOIN "ProductVariant" pv ON UPPER(pv.sku) = UPPER(l.sku)
        LEFT JOIN "Product" p ON p.id = pv."productId"
        WHERE l."companyId" IN (${Prisma.join(chunk)})
          AND d."companyId" IS NOT NULL
          AND d."documentDate" >= ${bounds.gte}
          AND d."documentDate" <= ${bounds.lte}
          AND p."brandId" = ${brandId}
        GROUP BY l."companyId"
      `;
      for (const r of rows) out.set(r.companyId, parseSalesNetMinor(r.net));
    } else {
      const rows = await prisma.autopartSalesLine.groupBy({
        by: ["companyId"],
        where: {
          companyId: { in: chunk },
          document: {
            is: {
              companyId: { not: null },
              documentDate: { gte: bounds.gte, lte: bounds.lte },
            },
          },
        },
        _sum: { salesNet: true },
      });
      for (const r of rows) {
        if (r.companyId) out.set(r.companyId, parseSalesNetMinor(r._sum.salesNet));
      }
    }
  }
  return out;
}

async function invoiceSkuSetsByCompany(
  companyIds: string[],
  range: DateOnlyRange,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (companyIds.length === 0) return out;
  const bounds = {
    gte: new Date(`${range.from}T00:00:00.000Z`),
    lte: new Date(`${range.to}T23:59:59.999Z`),
  };
  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<Array<{ companyId: string; sku: string }>>`
      SELECT DISTINCT l."companyId" AS "companyId", UPPER(l.sku) AS sku
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND l."documentType" = 'INVOICE'
        AND d."companyId" IS NOT NULL
        AND d."documentDate" >= ${bounds.gte}
        AND d."documentDate" <= ${bounds.lte}
    `;
    for (const r of rows) {
      const set = out.get(r.companyId) ?? new Set<string>();
      set.add(r.sku);
      out.set(r.companyId, set);
    }
  }
  return out;
}

async function invoicePurchaseDatesByCompany(
  companyIds: string[],
  lookbackFrom: string,
  asOf: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (companyIds.length === 0) return out;
  const bounds = {
    gte: new Date(`${lookbackFrom}T00:00:00.000Z`),
    lte: new Date(`${asOf}T23:59:59.999Z`),
  };
  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<Array<{ companyId: string; d: Date }>>`
      SELECT DISTINCT l."companyId" AS "companyId", d."documentDate" AS d
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND l."documentType" = 'INVOICE'
        AND d."companyId" IS NOT NULL
        AND d."documentDate" IS NOT NULL
        AND d."documentDate" >= ${bounds.gte}
        AND d."documentDate" <= ${bounds.lte}
    `;
    for (const r of rows) {
      const iso = r.d.toISOString().slice(0, 10);
      const list = out.get(r.companyId) ?? [];
      list.push(iso);
      out.set(r.companyId, list);
    }
  }
  return out;
}

async function productsPurchasedByCompany(
  companyIds: string[],
  range: DateOnlyRange,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (companyIds.length === 0) return out;
  const bounds = {
    gte: new Date(`${range.from}T00:00:00.000Z`),
    lte: new Date(`${range.to}T23:59:59.999Z`),
  };
  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.$queryRaw<Array<{ companyId: string; n: bigint }>>`
      SELECT l."companyId" AS "companyId", COUNT(DISTINCT UPPER(l.sku))::bigint AS n
      FROM "AutopartSalesLine" l
      INNER JOIN "AutopartSalesDocument" d ON d.id = l."documentId"
      WHERE l."companyId" IN (${Prisma.join(chunk)})
        AND l."documentType" = 'INVOICE'
        AND d."companyId" IS NOT NULL
        AND d."documentDate" >= ${bounds.gte}
        AND d."documentDate" <= ${bounds.lte}
      GROUP BY l."companyId"
    `;
    for (const r of rows) out.set(r.companyId, Number(r.n));
  }
  return out;
}

async function openFollowUpCounts(companyIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (companyIds.length === 0) return out;
  for (const chunk of chunkArray(companyIds, SAFE_IN_LIST_CHUNK)) {
    const rows = await prisma.task.groupBy({
      by: ["companyId"],
      where: {
        companyId: { in: chunk },
        status: { in: ["OPEN", "IN_PROGRESS"] },
        sourceModule: {
          in: [
            "SALES_ENQUIRY",
            "GAP_ANALYSIS",
            "RANGE_OPPORTUNITY",
            "REBATE_ANALYSIS",
            "PORTFOLIO",
          ],
        },
      },
      _count: { _all: true },
    });
    for (const r of rows) {
      if (r.companyId) out.set(r.companyId, r._count._all);
    }
  }
  return out;
}

function buildCrossSellForCustomer(
  companyId: string,
  ownSkus: Set<string>,
  allCompanySkus: Map<string, Set<string>>,
): PortfolioOpportunity[] {
  const opportunities: PortfolioOpportunity[] = [];
  if (ownSkus.size === 0) return opportunities;

  // Seed = top SKUs by how often they appear as seeds (use all own SKUs, cap work).
  const seeds = [...ownSkus].slice(0, 12);
  const suggestions = new Map<string, { co: number; cohort: number; seed: string }>();

  for (const seed of seeds) {
    let cohort = 0;
    const coCounts = new Map<string, number>();
    for (const [cid, skus] of allCompanySkus) {
      if (cid === companyId) continue;
      if (!skus.has(seed)) continue;
      cohort += 1;
      for (const other of skus) {
        if (other === seed || ownSkus.has(other)) continue;
        coCounts.set(other, (coCounts.get(other) ?? 0) + 1);
      }
    }
    if (cohort < PORTFOLIO_CROSS_SELL_CONFIG.minCohortBuyers) continue;
    for (const [sku, co] of coCounts) {
      const prev = suggestions.get(sku);
      if (!prev || co > prev.co) suggestions.set(sku, { co, cohort, seed });
    }
  }

  const ranked = [...suggestions.entries()]
    .map(([sku, v]) => ({ sku, ...v, adoption: v.co / v.cohort }))
    .sort((a, b) => b.adoption - a.adoption || b.co - a.co)
    .slice(0, PORTFOLIO_CROSS_SELL_CONFIG.maxSuggestionsPerCustomer);

  for (const s of ranked) {
    const opp = buildCrossSellOpportunity({
      seedSku: s.seed,
      suggestedSku: s.sku,
      coBuyers: s.co,
      cohortSize: s.cohort,
    });
    if (opp) opportunities.push(opp);
  }
  return opportunities;
}

export async function getSalesRepPortfolio(actorUserId: string, raw: unknown) {
  const profile = await requirePortfolioActor(actorUserId);
  const input = querySchema.parse(raw ?? {});

  const resolved = resolveBusinessPeriod({
    period: input.period,
    from: input.from,
    to: input.to,
    defaultPeriod: PORTFOLIO_DEFAULT_PERIOD,
  });
  if (!resolved.ok) {
    throw new AuthError(resolved.message, "VALIDATION", 400);
  }
  const current: ResolvedBusinessPeriod = resolved.value;
  const previousRange =
    current.period === "ALL"
      ? null
      : previousComparableBusinessPeriod(current.range, current.period);
  const currentPeriodDays = daysInclusive(current.range);

  const { companyIds, salesRepFilterLabel } = await resolvePortfolioCompanyIds(profile, input);
  const asOf = todayLondonDateOnly();
  const cadenceFrom = addDaysIso(asOf, -729);
  const actorSalesRepId = await resolveActorSalesRepId(profile.userId);

  const [currentSales, previousSales, currentSkus, previousSkus, purchaseDates, productCounts, followUps] =
    await Promise.all([
      netSalesByCompany(companyIds, current.range, input.brandId),
      previousRange
        ? netSalesByCompany(companyIds, previousRange, input.brandId)
        : Promise.resolve(new Map<string, bigint>()),
      invoiceSkuSetsByCompany(companyIds, current.range),
      previousRange
        ? invoiceSkuSetsByCompany(companyIds, previousRange)
        : Promise.resolve(new Map<string, Set<string>>()),
      invoicePurchaseDatesByCompany(companyIds, cadenceFrom, asOf),
      productsPurchasedByCompany(companyIds, current.range),
      openFollowUpCounts(companyIds),
    ]);

  // Lifetime invoice SKUs for cross-sell / brand gap (bounded lookback = cadence window).
  const lifetimeSkus = await invoiceSkuSetsByCompany(companyIds, {
    from: cadenceFrom,
    to: asOf,
  });

  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: {
          id: true,
          name: true,
          autopartCustomerCode: true,
          customerGroupId: true,
          customerGroup: { select: { id: true, name: true } },
          assignments: {
            where: { isPrimary: true },
            take: 1,
            select: {
              salesRepId: true,
              salesRep: { select: { id: true, user: { select: { name: true } } } },
            },
          },
        },
      })
    : [];

  // Brand catalogue for brand-gap (group peers).
  const brandBySku = new Map<string, { brandId: string; brandName: string }>();
  const allSkus = new Set<string>();
  for (const set of lifetimeSkus.values()) for (const s of set) allSkus.add(s);
  if (allSkus.size > 0) {
    for (const skuChunk of chunkArray([...allSkus], 200)) {
      const variants = await prisma.productVariant.findMany({
        where: { OR: skuChunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" } })) },
        select: {
          sku: true,
          product: { select: { brandId: true, brand: { select: { name: true } } } },
        },
      });
      for (const v of variants) {
        if (v.product.brandId) {
          brandBySku.set(v.sku.toUpperCase(), {
            brandId: v.product.brandId,
            brandName: v.product.brand.name,
          });
        }
      }
    }
  }

  const groupBrandBuyers = new Map<string, Map<string, Set<string>>>();
  // groupId → brandName → companyIds
  for (const c of companies) {
    if (!c.customerGroupId) continue;
    const skus = lifetimeSkus.get(c.id);
    if (!skus) continue;
    const byBrand = groupBrandBuyers.get(c.customerGroupId) ?? new Map<string, Set<string>>();
    for (const sku of skus) {
      const b = brandBySku.get(sku);
      if (!b) continue;
      const set = byBrand.get(b.brandName) ?? new Set<string>();
      set.add(c.id);
      byBrand.set(b.brandName, set);
    }
    groupBrandBuyers.set(c.customerGroupId, byBrand);
  }

  const q = input.q?.trim().toLowerCase() ?? "";
  const filter = (input.filter ?? "ALL") as PortfolioFilter;
  const rows: PortfolioCustomerRow[] = [];

  let kpiCurrent = 0n;
  let kpiPrevious = 0n;
  let needingAttention = 0;
  let dormantCustomers = 0;
  let growingCustomers = 0;
  let decliningCustomers = 0;
  let activeCustomers = 0;
  let openFollowUps = 0;

  for (const c of companies) {
    if (q) {
      const hay = `${c.name} ${c.autopartCustomerCode ?? ""} ${c.customerGroup?.name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const cur = currentSales.get(c.id) ?? 0n;
    const prev = previousSales.get(c.id) ?? 0n;
    const movement = classifyPeriodMovement(cur, prev);
    const cadence = derivePurchaseCadence(purchaseDates.get(c.id) ?? [], { asOf });
    const curSet = currentSkus.get(c.id) ?? new Set();
    const prevSet = previousSkus.get(c.id) ?? new Set();
    const stopped: string[] = [];
    for (const sku of prevSet) {
      if (!curSet.has(sku)) stopped.push(sku);
    }

    const life = lifetimeSkus.get(c.id) ?? new Set();
    const opportunities: PortfolioOpportunity[] = [];
    const significantStopped = isSignificantStoppedBuying({
      stoppedCount: stopped.length,
      previousSkuCount: prevSet.size,
      daysSinceLastPurchase: cadence.daysSinceLastPurchase,
      growing: movement.growing,
      currentPeriodDays,
    });

    const stoppedOpp = buildStoppedProductOpportunity({
      count: stopped.length,
      sampleSkus: stopped.slice(0, 3),
      significantForAttention: significantStopped,
    });
    if (stoppedOpp) opportunities.push(stoppedOpp);

    opportunities.push(...buildCrossSellForCustomer(c.id, life, lifetimeSkus));

    if (c.customerGroupId) {
      const brandMap = groupBrandBuyers.get(c.customerGroupId);
      if (brandMap) {
        const ownBrands = new Set<string>();
        for (const sku of life) {
          const b = brandBySku.get(sku);
          if (b) ownBrands.add(b.brandName);
        }
        for (const [brandName, buyers] of brandMap) {
          if (ownBrands.has(brandName)) continue;
          const peers = [...buyers].filter((id) => id !== c.id).length;
          const opp = buildBrandGapOpportunity({
            brandName,
            peerCount: peers,
            groupName: c.customerGroup?.name ?? null,
          });
          if (opp) opportunities.push(opp);
        }
      }
    }

    const reasons = buildAttentionReasons({
      cadence,
      movement,
      stoppedProductCount: stopped.length,
      previousSkuCount: prevSet.size,
      currentPeriodDays,
    });
    const dormant = reasons.some((r) => r.code === "DORMANT");
    const attention = needsAttention(reasons);
    const follow = followUps.get(c.id) ?? 0;
    const primary = c.assignments[0];
    const cadenceLines = formatCadenceTableLines(cadence);

    const row: PortfolioCustomerRow = {
      companyId: c.id,
      companyName: c.name,
      customerGroupId: c.customerGroupId,
      customerGroupName: c.customerGroup?.name ?? null,
      mamAccount: c.autopartCustomerCode,
      salesRepId: primary?.salesRepId ?? null,
      salesRepName: primary?.salesRep.user.name ?? null,
      currentNetSales: moneyMinorToDto(cur),
      previousNetSales: moneyMinorToDto(prev),
      movement: moneyMinorToDto(movement.movementMinor),
      movementPercent: movement.percentChange,
      declining: movement.declining,
      growing: movement.growing,
      lastPurchaseDate: cadence.lastPurchaseDate,
      typicalIntervalDays: cadence.typicalIntervalDays,
      daysSinceLastPurchase: cadence.daysSinceLastPurchase,
      cadenceSummary: cadenceLineForCard(cadence),
      cadenceIntervalLabel: cadenceLines.interval,
      cadenceLastPurchaseLabel: cadenceLines.last,
      productsPurchased: productCounts.get(c.id) ?? 0,
      stoppedProductCount: stopped.length,
      significantStoppedBuying: significantStopped,
      opportunityCount: opportunities.length,
      openFollowUpCount: follow,
      attentionReasons: reasons,
      needsAttention: attention,
      dormant,
      opportunities: opportunities.slice(0, 8),
    };

    // KPIs over full filtered-by-q set before attention filters
    kpiCurrent += cur;
    kpiPrevious += prev;
    if (cur !== 0n || (productCounts.get(c.id) ?? 0) > 0) activeCustomers += 1;
    if (attention) needingAttention += 1;
    if (dormant) dormantCustomers += 1;
    if (movement.growing) growingCustomers += 1;
    if (movement.declining) decliningCustomers += 1;
    openFollowUps += follow;

    if (rowMatchesPortfolioFilter(row, filter)) rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    const ka = attentionSortKey(a.attentionReasons);
    const kb = attentionSortKey(b.attentionReasons);
    if (ka !== kb) return ka - kb;
    return Number(b.currentNetSales) - Number(a.currentNetSales) || a.companyName.localeCompare(b.companyName);
  });

  const topOpportunities = [...rows]
    .filter((r) => r.opportunityCount > 0)
    .sort(compareOpportunityRows)
    .slice(0, PORTFOLIO_TOP_OPPORTUNITIES_LIMIT);

  const total = rows.length;
  const page = input.page ?? 1;
  const pageSize = input.allRows ? Math.max(total, 1) : (input.pageSize ?? PORTFOLIO_PAGE_SIZE);
  const pageRows = input.allRows ? rows : rows.slice((page - 1) * pageSize, page * pageSize);

  const kpis: PortfolioKpis = {
    netSales: moneyMinorToDto(kpiCurrent),
    previousNetSales: moneyMinorToDto(kpiPrevious),
    movement: moneyMinorToDto(kpiCurrent - kpiPrevious),
    movementPercent: percentChangeMinor(kpiCurrent, kpiPrevious),
    activeCustomers,
    needingAttention,
    dormantCustomers,
    growingCustomers,
    decliningCustomers,
    openFollowUps,
  };

  const reps = canSelectSalesRep(profile)
    ? await prisma.salesRep.findMany({
        where: { active: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, user: { select: { name: true } } },
      })
    : [];

  const groups = await prisma.customerGroup.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 500,
  });

  const brands = await prisma.brand.findMany({
    where: { products: { some: { isActive: true } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 200,
  });

  return {
    period: {
      key: current.period,
      label: current.label,
      displayFrom: current.displayFrom,
      displayTo: current.displayTo,
      displayRangeLabel: current.displayRangeLabel,
    },
    comparison: previousRange
      ? {
          from: previousRange.from,
          to: previousRange.to,
          label: formatUkDateRangeLabel(previousRange.from, previousRange.to),
        }
      : null,
    salesRepFilterLabel,
    canSelectSalesRep: canSelectSalesRep(profile),
    actorSalesRepId,
    kpis,
    topOpportunities,
    rows: pageRows,
    page,
    pageSize,
    total,
    filter,
    q: input.q ?? "",
    salesReps: reps.map((r) => ({
      id: r.id,
      label: r.user.name ?? r.code,
    })),
    customerGroups: groups,
    brands,
    methodology: PORTFOLIO_METHODOLOGY,
  };
}

async function resolveActorSalesRepId(userId: string): Promise<string | null> {
  const rep = await prisma.salesRep.findFirst({
    where: { userId, active: true },
    select: { id: true },
  });
  return rep?.id ?? null;
}

export const PORTFOLIO_METHODOLOGY = {
  salesSource:
    "Autopart realised sales (AutopartSalesLine / AutopartSalesDocument). AB Order lines are not used (avoids double counting).",
  comparison:
    "Calendar presets compare the same ordinal portion of the previous calendar period (e.g. This Month on 1 Oct → 1 Oct vs 1 Sep; on 10 Oct → 1–10 Oct vs 1–10 Sep, with month-length clamping). Complete Last Month/Quarter/Year compare the prior complete calendar period. Rolling periods use an immediately preceding equal-length window.",
  attentionVsOpportunity:
    "Needs Attention means investigation may be required (dormant, purchase gap, material decline, or significant stopped buying). Opportunities are positive selling leads (cross-sell, brand gap, milder not-bought-this-period). Opportunity alone never places a customer in Needs Attention.",
  cadence:
    "Typical purchase interval = median gap (days) between consecutive distinct INVOICE document dates. Requires at least 3 invoice purchase dates. Credits do not create purchase events.",
  purchaseGap:
    "Needs attention when days since last invoice purchase ≥ max(14, ceil(typicalInterval × 1.5)).",
  dormant:
    "Dormant when days since last invoice purchase ≥ max(45, ceil(typicalInterval × 2)). Insufficient history is never labelled dormant.",
  materialDecline:
    "Needs Attention decline requires both ≥ 20% fall and ≥ £100 absolute fall vs the comparable period. Smaller %/£ movements are not attention cases (they may still show as movement in the table).",
  stoppedProducts:
    "Gap STOPPED (invoice presence previous, none current) can appear as an opportunity (“not bought this period”). Needs Attention “Stopped buying” only when ≥ 3 stopped SKUs and ≥ 25% of previous-period SKUs (or ≥ 5 absolute), and not for growing daily buyers on a very short current period.",
  crossSell:
    `Shown only when ≥ ${PORTFOLIO_CROSS_SELL_CONFIG.minCohortBuyers} comparable customers bought seed SKU and ≥ ${PORTFOLIO_CROSS_SELL_CONFIG.minCoBuyers} of them also bought the suggestion (≥ ${Math.round(PORTFOLIO_CROSS_SELL_CONFIG.minAdoption * 100)}% adoption). Denominator is always shown. No estimated £ value.`,
  brandGap:
    `Within a Customer Group, brand Y is suggested when ≥ ${PORTFOLIO_CROSS_SELL_CONFIG.minBrandGapPeers} other members buy Y and this company has no invoice history for Y.`,
  credits: "Credits remain signed negative financial activity and never create invoice purchase presence or cadence events.",
} as const;

export async function exportSalesRepPortfolioCsv(actorUserId: string, raw: unknown): Promise<string> {
  const full = await getSalesRepPortfolio(actorUserId, {
    ...(typeof raw === "object" && raw ? raw : {}),
    page: 1,
    allRows: true,
  });

  const header = [
    "Customer",
    "Customer Group",
    "MAM Account",
    "Sales Rep",
    "Current Net Sales",
    "Previous Net Sales",
    "Movement",
    "Movement %",
    "Last Purchase",
    "Typical Purchase Interval Days",
    "Days Since Last Purchase",
    "Products Purchased",
    "Stopped Products",
    "Opportunity Count",
    "Open Follow-ups",
    "Attention Reasons",
  ];

  const lines = [header.join(",")];
  for (const r of full.rows) {
    const pct = r.movementPercent == null ? "" : r.movementPercent.toFixed(1);
    const reasons = r.attentionReasons.map((a) => a.label).join("; ");
    lines.push(
      [
        csv(r.companyName),
        csv(r.customerGroupName ?? ""),
        csv(r.mamAccount ?? ""),
        csv(r.salesRepName ?? ""),
        r.currentNetSales,
        r.previousNetSales,
        r.movement,
        pct,
        formatUk(r.lastPurchaseDate),
        r.typicalIntervalDays ?? "",
        r.daysSinceLastPurchase ?? "",
        r.productsPurchased,
        r.stoppedProductCount,
        r.opportunityCount,
        r.openFollowUpCount,
        csv(reasons),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function csv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatUk(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export async function getPortfolioCustomerDetail(actorUserId: string, raw: unknown) {
  const profile = await requirePortfolioActor(actorUserId);
  const input = z
    .object({
      companyId: z.string().min(1),
      period: z.string().optional().nullable(),
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
    })
    .parse(raw);

  const scope = await resolveSalesIntelligenceCompanyScope(profile);
  if (scope !== "all" && !scope.includes(input.companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }

  const portfolio = await getSalesRepPortfolio(actorUserId, {
    period: input.period,
    from: input.from,
    to: input.to,
    filter: "ALL",
    page: 1,
    allRows: true,
  });
  const row = portfolio.rows.find((r) => r.companyId === input.companyId);
  if (!row) {
    throw new AuthError("Customer not found in portfolio scope", "NOT_FOUND", 404);
  }
  return {
    period: portfolio.period,
    comparison: portfolio.comparison,
    customer: row,
    methodology: PORTFOLIO_METHODOLOGY,
  };
}
