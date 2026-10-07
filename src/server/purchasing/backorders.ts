/**
 * Purchasing Backorders workspace — current 216V outstanding position + history.
 * Does not mutate 231PO3NEW, forecast weights, companies, or catalogue products.
 */

import { z } from "zod";
import type { AutopartBackorderChangeStatus } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requirePurchasingAccess } from "@/server/rbac/guards";
import { dateOnlyIsoFromDate } from "@/domain/sales-history-period";
import { formatOperationalDateTime, formatOrDash } from "@/lib/datetime";
import {
  AUTOPART_PRODUCT_KIND_LABEL,
  classifyAutopartProduct,
  type AutopartProductKind as ProductKind,
} from "@/domain/autopart-product";
import {
  AUTOPART_216V_ATTENTION_RULES,
  AUTOPART_216V_CHANGE_STATUS_LABEL,
  AUTOPART_216V_STOCK_POSITION_LABEL,
  attentionIdsForBackorder,
  firstSeenAgeDays,
  firstSeenAgeLabel,
  resolveAutopart216vSkuCover,
  type Autopart216vAttentionId,
  type Autopart216vStockPosition,
} from "@/domain/autopart-216v-position";
import { next216vExpectedLabel, resolveAutopart216vFreshness, headline216vFeedHealth, label216vSnapshotSource } from "@/domain/autopart-216v-freshness";
import { requireBackorderManage } from "@/server/purchasing/backorder-import";
import {
  AUTOPART_216V_MOVEMENTS,
  AUTOPART_216V_MOVEMENT_CHANGE_STATUS,
  AUTOPART_216V_MOVEMENT_LABEL,
  autopart216vMovementIgnoredFilters,
  autopart216vMovementQuantities,
  type Autopart216vMovement,
  type Autopart216vMovementFilterKey,
} from "@/domain/autopart-216v-movement";
import {
  autopartConditionLabel,
  type BackorderConditionFilter,
} from "@/domain/autopart-product-condition";

const listInput = z.object({
  movement: z.enum(AUTOPART_216V_MOVEMENTS).optional().nullable(),
  q: z.string().optional().nullable(),
  status: z
    .enum(["NEW", "UNCHANGED", "QUANTITY_REDUCED", "QUANTITY_INCREASED"])
    .optional()
    .nullable(),
  position: z
    .enum([
      "STOCK_AVAILABLE",
      "PART_STOCK_AVAILABLE",
      "INCOMING_COVERS",
      "INCOMING_PART_COVERS",
      "NO_STOCK_NO_INCOMING",
      "PRODUCT_NOT_IN_CURRENT_STOCK_FEED",
    ])
    .optional()
    .nullable(),
  ageDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).optional().nullable(),
  customerAccount: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  catalogueType: z.enum(["CATALOGUE", "EXTERNAL", "HISTORIC_ONLY"]).optional().nullable(),
  condition: z.enum(["HAS", "NONE", "S", "N", "O", "W", "D", "M"]).optional().nullable(),
  view: z.enum(["lines", "sku", "customer", "attention"]).optional().nullable(),
  page: z.number().int().positive().optional().nullable(),
  pageSize: z.number().int().positive().max(200).optional().nullable(),
});

function num(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value: { toString(): string } | number | null | undefined): string | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type ProductInclude = {
  id: string;
  sku: string;
  matchKey: string;
  description: string | null;
  availQty: number;
  incomingQty: number | null;
  physicalQty: number | null;
  presentInLatestFeed: boolean;
  sourceUpdatedAt: Date | null;
  catalogueVariantId: string | null;
  conditionCode: string | null;
  catalogueVariant: {
    sku: string;
    product: { brand: { name: string; slug: string } };
  } | null;
};

type LineRow = {
  id: string;
  identityKey: string;
  orderNumber: string;
  customerAccount: string;
  customerNameSnapshot: string;
  customerOrderRef: string;
  partNumber: string;
  partMatchKey: string;
  descriptionSnapshot: string;
  outstandingQty: { toString(): string };
  unitValue: { toString(): string } | null;
  outstandingValue: { toString(): string } | null;
  changeStatus: AutopartBackorderChangeStatus;
  previousQty: { toString(): string } | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date;
  companyId: string | null;
  company: { id: string; name: string; autopartCustomerCode: string | null } | null;
  autopartProduct: ProductInclude | null;
};

export type BackorderLineView = {
  id: string;
  identityKey: string;
  status: AutopartBackorderChangeStatus;
  statusLabel: string;
  ageDays: number;
  ageLabel: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string;
  orderNumber: string;
  customerAccount: string;
  customerName: string;
  customerOrderRef: string;
  companyId: string | null;
  companyName: string | null;
  unmapped: boolean;
  sku: string;
  partMatchKey: string;
  description: string;
  outstandingQty: number;
  previousQty: number | null;
  unitValue: string | null;
  outstandingValue: string | null;
  availQty: number | null;
  incomingQty: number | null;
  physicalQty: number | null;
  stockFeedAt: string | null;
  presentInLatestFeed: boolean;
  position: Autopart216vStockPosition;
  positionLabel: string;
  coverSummary: string;
  incomingHasEta: false;
  productKind: ProductKind | "UNKNOWN";
  productKindLabel: string;
  brand: string | null;
  brandSlug: string | null;
  autopartProductId: string | null;
  attention: Autopart216vAttentionId[];
  /** Current 231PO3NEW product condition. Not part of 216V identity or movement. */
  conditionCode: string | null;
  conditionLabel: string | null;
};

function productKindOf(product: ProductInclude | null): ProductKind | "UNKNOWN" {
  if (!product) return "UNKNOWN";
  return classifyAutopartProduct({
    hasCatalogueVariant: Boolean(product.catalogueVariantId),
    presentInLatestFeed: product.presentInLatestFeed,
  });
}

function enrichLines(lines: LineRow[], now = new Date()): BackorderLineView[] {
  const outstanding = lines.filter((l) => l.changeStatus !== "CLEARED");
  const skuDemand = new Map<string, number>();
  for (const line of outstanding) {
    skuDemand.set(line.partMatchKey, (skuDemand.get(line.partMatchKey) ?? 0) + num(line.outstandingQty));
  }
  const skuCover = new Map<string, ReturnType<typeof resolveAutopart216vSkuCover>>();
  for (const line of outstanding) {
    const existing = skuCover.get(line.partMatchKey);
    if (existing && existing.position !== "PRODUCT_NOT_IN_CURRENT_STOCK_FEED") continue;
    const product = line.autopartProduct;
    skuCover.set(
      line.partMatchKey,
      resolveAutopart216vSkuCover({
        outstandingQty: skuDemand.get(line.partMatchKey) ?? 0,
        availQty: product?.presentInLatestFeed ? product.availQty : null,
        incomingQty: product?.presentInLatestFeed ? (product.incomingQty ?? 0) : null,
        presentInLatestFeed: Boolean(product?.presentInLatestFeed),
      }),
    );
  }

  return outstanding.map((line) => {
    const cover = skuCover.get(line.partMatchKey)!;
    const kind = productKindOf(line.autopartProduct);
    const ageDays = firstSeenAgeDays(line.firstSeenAt, now);
    const outstandingValue = num(line.outstandingValue);
    const brand = line.autopartProduct?.catalogueVariant?.product.brand ?? null;
    return {
      id: line.id,
      identityKey: line.identityKey,
      status: line.changeStatus,
      statusLabel: AUTOPART_216V_CHANGE_STATUS_LABEL[line.changeStatus],
      ageDays,
      ageLabel: firstSeenAgeLabel(ageDays),
      firstSeenAt: line.firstSeenAt.toISOString(),
      lastSeenAt: line.lastSeenAt.toISOString(),
      lastChangedAt: line.lastChangedAt.toISOString(),
      orderNumber: line.orderNumber,
      customerAccount: line.customerAccount,
      customerName: line.company?.name ?? line.customerNameSnapshot,
      customerOrderRef: line.customerOrderRef,
      companyId: line.companyId,
      companyName: line.company?.name ?? null,
      unmapped: !line.companyId,
      sku: line.partNumber,
      partMatchKey: line.partMatchKey,
      description: line.descriptionSnapshot,
      outstandingQty: num(line.outstandingQty),
      previousQty: line.previousQty == null ? null : num(line.previousQty),
      unitValue: money(line.unitValue),
      outstandingValue: money(line.outstandingValue),
      availQty: cover.availQty,
      incomingQty: cover.incomingQty,
      physicalQty: line.autopartProduct?.physicalQty ?? null,
      stockFeedAt: line.autopartProduct?.sourceUpdatedAt?.toISOString() ?? null,
      presentInLatestFeed: Boolean(line.autopartProduct?.presentInLatestFeed),
      position: cover.position,
      positionLabel: AUTOPART_216V_STOCK_POSITION_LABEL[cover.position],
      coverSummary: cover.coverSummary,
      incomingHasEta: false as const,
      productKind: kind,
      productKindLabel:
        kind === "UNKNOWN" ? "Historic/not current" : AUTOPART_PRODUCT_KIND_LABEL[kind],
      brand: brand?.name ?? null,
      brandSlug: brand?.slug ?? null,
      autopartProductId: line.autopartProduct?.id ?? null,
      conditionCode: line.autopartProduct?.conditionCode ?? null,
      conditionLabel: autopartConditionLabel(line.autopartProduct?.conditionCode ?? null),
      attention: attentionIdsForBackorder({
        ageDays,
        outstandingValue,
        skuPosition: cover.position,
        skuAvailQty: cover.availQty,
      }),
    };
  });
}

type IdentityFilterable = {
  orderNumber: string;
  customerName: string;
  customerAccount: string;
  sku: string;
  description: string;
  customerOrderRef: string;
  companyName: string | null;
  brandSlug: string | null;
  productKind: ProductKind | "UNKNOWN";
};

/** Filters meaningful for both current and historical (cleared) lines. */
function applyIdentityFilters<T extends IdentityFilterable>(rows: T[], input: z.infer<typeof listInput>): T[] {
  const q = input.q?.trim().toLowerCase() ?? "";
  let out = rows;
  if (input.customerAccount) {
    const acc = input.customerAccount.trim().toUpperCase();
    out = out.filter((r) => r.customerAccount.trim().toUpperCase() === acc);
  }
  if (input.brand) out = out.filter((r) => r.brandSlug === input.brand);
  if (input.catalogueType === "CATALOGUE") out = out.filter((r) => r.productKind === "CATALOGUE");
  if (input.catalogueType === "EXTERNAL") out = out.filter((r) => r.productKind === "EXTERNAL");
  if (input.catalogueType === "HISTORIC_ONLY") {
    out = out.filter((r) => r.productKind === "HISTORIC_ONLY" || r.productKind === "UNKNOWN");
  }
  if (q) {
    out = out.filter((r) => {
      const hay = [
        r.orderNumber,
        r.customerName,
        r.customerAccount,
        r.sku,
        r.description,
        r.customerOrderRef,
        r.companyName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return out;
}

function applyFilters(rows: BackorderLineView[], input: z.infer<typeof listInput>): BackorderLineView[] {
  let out = rows;
  if (input.status) out = out.filter((r) => r.status === input.status);
  if (input.position) out = out.filter((r) => r.position === input.position);
  if (input.ageDays) out = out.filter((r) => r.ageDays >= input.ageDays!);
  out = applyIdentityFilters(out, input);
  out = applyConditionFilter(out, input.condition);
  return out.sort((a, b) => {
    const value = Number(b.outstandingValue ?? 0) - Number(a.outstandingValue ?? 0);
    if (value !== 0) return value;
    return a.orderNumber.localeCompare(b.orderNumber);
  });
}

function applyConditionFilter<T extends { conditionCode: string | null }>(
  rows: T[],
  condition: BackorderConditionFilter | null | undefined,
): T[] {
  if (!condition) return rows;
  if (condition === "HAS") return rows.filter((row) => Boolean(row.conditionCode));
  if (condition === "NONE") return rows.filter((row) => !row.conditionCode);
  return rows.filter((row) => row.conditionCode === condition);
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, rows: rows.slice(start, start + pageSize) };
}

function groupSkus(rows: BackorderLineView[]) {
  const map = new Map<string, BackorderLineView[]>();
  for (const row of rows) {
    const list = map.get(row.partMatchKey) ?? [];
    list.push(row);
    map.set(row.partMatchKey, list);
  }
  return [...map.entries()]
    .map(([partMatchKey, lines]) => {
      const first = lines[0]!;
      const outstandingQty = lines.reduce((s, l) => s + l.outstandingQty, 0);
      const outstandingValue = lines.reduce((s, l) => s + Number(l.outstandingValue ?? 0), 0);
      return {
        partMatchKey,
        sku: first.sku,
        description: first.description,
        productKind: first.productKind,
        productKindLabel: first.productKindLabel,
        brand: first.brand,
        conditionCode: first.conditionCode,
        conditionLabel: first.conditionLabel,
        outstandingQty,
        outstandingValue: outstandingValue.toFixed(2),
        orders: new Set(lines.map((l) => l.orderNumber)).size,
        customers: new Set(lines.map((l) => l.customerAccount.trim().toUpperCase())).size,
        availQty: first.availQty,
        incomingQty: first.incomingQty,
        position: first.position,
        positionLabel: first.positionLabel,
        coverSummary: first.coverSummary,
        incomingHasEta: false as const,
        oldestAgeDays: Math.max(...lines.map((l) => l.ageDays)),
        oldestAgeLabel: firstSeenAgeLabel(Math.max(...lines.map((l) => l.ageDays))),
        lines,
      };
    })
    .sort((a, b) => b.outstandingQty - a.outstandingQty);
}

function groupCustomers(rows: BackorderLineView[]) {
  const map = new Map<string, BackorderLineView[]>();
  for (const row of rows) {
    const key = row.customerAccount.trim().toUpperCase() || row.customerName;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([account, lines]) => {
      const first = lines[0]!;
      const outstandingValue = lines.reduce((s, l) => s + Number(l.outstandingValue ?? 0), 0);
      const oldest = Math.max(...lines.map((l) => l.ageDays));
      const coverIssues = [...new Set(lines.filter((l) => l.position !== "STOCK_AVAILABLE").map((l) => l.positionLabel))];
      return {
        customerAccount: account,
        customerName: first.customerName,
        companyId: first.companyId,
        companyName: first.companyName,
        unmapped: first.unmapped,
        orders: new Set(lines.map((l) => l.orderNumber)).size,
        lines: lines.length,
        units: lines.reduce((s, l) => s + l.outstandingQty, 0),
        outstandingValue: outstandingValue.toFixed(2),
        oldestAgeDays: oldest,
        oldestAgeLabel: firstSeenAgeLabel(oldest),
        stockCoverIssues: coverIssues,
        attentionCount: lines.filter((l) => l.attention.length > 0).length,
        lineRows: lines,
      };
    })
    .sort((a, b) => Number(b.outstandingValue) - Number(a.outstandingValue));
}

const lineInclude = {
  company: { select: { id: true, name: true, autopartCustomerCode: true } },
  autopartProduct: {
    select: {
      id: true,
      sku: true,
      matchKey: true,
      description: true,
      availQty: true,
      incomingQty: true,
      physicalQty: true,
      presentInLatestFeed: true,
      sourceUpdatedAt: true,
      catalogueVariantId: true,
      conditionCode: true,
      catalogueVariant: {
        select: { sku: true, product: { select: { brand: { select: { name: true, slug: true } } } } },
      },
    },
  },
} as const;

async function loadLatestSnapshot() {
  return prisma.autopartBackorderSnapshot.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { importedAt: "desc" },
    include: { lines: { include: lineInclude } },
  });
}

type LoadedSnapshot = NonNullable<Awaited<ReturnType<typeof loadLatestSnapshot>>>;

export type BackorderMovementRowView = {
  id: string;
  identityKey: string;
  movement: Autopart216vMovement;
  status: AutopartBackorderChangeStatus;
  statusLabel: string;
  /** False for CLEARED: historical line, not part of current outstanding totals. */
  currentlyOutstanding: boolean;
  orderNumber: string;
  customerAccount: string;
  customerName: string;
  customerOrderRef: string;
  companyId: string | null;
  companyName: string | null;
  unmapped: boolean;
  sku: string;
  partMatchKey: string;
  description: string;
  productKind: ProductKind | "UNKNOWN";
  productKindLabel: string;
  brand: string | null;
  brandSlug: string | null;
  previousQty: number | null;
  currentQty: number | null;
  changeQty: number | null;
  unitValue: string | null;
  previousValue: string | null;
  currentValue: string | null;
  firstSeenAt: string;
  ageLabel: string;
  lastChangedAt: string;
  clearedAt: string | null;
  availQty: number | null;
  incomingQty: number | null;
  position: Autopart216vStockPosition | null;
  positionLabel: string | null;
  coverSummary: string | null;
  /** Current product master condition. For CLEARED this is not a historic snapshot. */
  conditionCode: string | null;
  conditionLabel: string | null;
};

async function loadPreviousCommittedSnapshot(current: LoadedSnapshot) {
  return prisma.autopartBackorderSnapshot.findFirst({
    where: { status: "COMMITTED", importedAt: { lt: current.importedAt }, id: { not: current.id } },
    orderBy: { importedAt: "desc" },
    select: { id: true, importedAt: true, receivedAt: true, filename: true },
  });
}

function movementSort(a: BackorderMovementRowView, b: BackorderMovementRowView) {
  const value =
    Number(b.currentValue ?? b.previousValue ?? 0) - Number(a.currentValue ?? a.previousValue ?? 0);
  if (value !== 0) return value;
  return a.orderNumber.localeCompare(b.orderNumber);
}

/**
 * Lines classified into `movement` by the import that produced the current committed snapshot.
 * CLEARED rows are the historical CLEARED records persisted on the current snapshot (identity
 * carried from the previous snapshot) — never derived from the current outstanding rows.
 */
async function buildMovementRows(
  snapshot: LoadedSnapshot,
  outstanding: BackorderLineView[],
  movement: Autopart216vMovement,
  input: z.infer<typeof listInput>,
  now: Date,
) {
  const changeStatus = AUTOPART_216V_MOVEMENT_CHANGE_STATUS[movement];
  const ignored = autopart216vMovementIgnoredFilters(movement);
  const effective = {
    ...input,
    ...Object.fromEntries(ignored.map((key) => [key, null])),
  } as z.infer<typeof listInput>;

  const previous = await loadPreviousCommittedSnapshot(snapshot);
  const raw = snapshot.lines as unknown as LineRow[];
  const movementLines = raw.filter((l) => l.changeStatus === changeStatus);
  const previousValues = new Map<string, string | null>();
  if (previous && movement !== "NEW" && movementLines.length) {
    const prevLines = await prisma.autopartBackorderLine.findMany({
      where: {
        snapshotId: previous.id,
        identityKey: { in: movementLines.map((l) => l.identityKey) },
        changeStatus: { not: "CLEARED" },
      },
      select: { identityKey: true, outstandingValue: true },
    });
    for (const line of prevLines) previousValues.set(line.identityKey, money(line.outstandingValue));
  }

  function previousValueOf(identityKey: string, previousQty: number | null, unitValue: string | null) {
    const stored = previousValues.get(identityKey);
    if (stored != null) return stored;
    if (previousQty == null || unitValue == null) return null;
    return (previousQty * Number(unitValue)).toFixed(2);
  }

  let rows: BackorderMovementRowView[];
  if (movement === "CLEARED") {
    rows = movementLines.map((line) => {
      const kind = productKindOf(line.autopartProduct);
      const brand = line.autopartProduct?.catalogueVariant?.product.brand ?? null;
      const ageDays = firstSeenAgeDays(line.firstSeenAt, now);
      const quantities = autopart216vMovementQuantities({
        movement,
        outstandingQty: num(line.outstandingQty),
        previousQty: line.previousQty == null ? null : num(line.previousQty),
      });
      const unitValue = money(line.unitValue);
      return {
        id: line.id,
        identityKey: line.identityKey,
        movement,
        status: line.changeStatus,
        statusLabel: AUTOPART_216V_CHANGE_STATUS_LABEL[line.changeStatus],
        currentlyOutstanding: false,
        orderNumber: line.orderNumber,
        customerAccount: line.customerAccount,
        customerName: line.company?.name ?? line.customerNameSnapshot,
        customerOrderRef: line.customerOrderRef,
        companyId: line.companyId,
        companyName: line.company?.name ?? null,
        unmapped: !line.companyId,
        sku: line.partNumber,
        partMatchKey: line.partMatchKey,
        description: line.descriptionSnapshot,
        productKind: kind,
        productKindLabel: kind === "UNKNOWN" ? "Historic/not current" : AUTOPART_PRODUCT_KIND_LABEL[kind],
        brand: brand?.name ?? null,
        brandSlug: brand?.slug ?? null,
        ...quantities,
        unitValue,
        previousValue: previousValueOf(line.identityKey, quantities.previousQty, unitValue),
        currentValue: null,
        firstSeenAt: line.firstSeenAt.toISOString(),
        ageLabel: firstSeenAgeLabel(ageDays),
        lastChangedAt: line.lastChangedAt.toISOString(),
        clearedAt: line.lastChangedAt.toISOString(),
        availQty: null,
        incomingQty: null,
        position: null,
        positionLabel: null,
        coverSummary: null,
        conditionCode: line.autopartProduct?.conditionCode ?? null,
        conditionLabel: autopartConditionLabel(line.autopartProduct?.conditionCode ?? null),
      };
    });
    rows = applyConditionFilter(applyIdentityFilters(rows, effective), effective.condition).sort(movementSort);
  } else {
    rows = applyFilters(
      outstanding.filter((l) => l.status === changeStatus),
      effective,
    ).map((line) => {
      const quantities = autopart216vMovementQuantities({
        movement,
        outstandingQty: line.outstandingQty,
        previousQty: line.previousQty,
      });
      return {
        id: line.id,
        identityKey: line.identityKey,
        movement,
        status: line.status,
        statusLabel: line.statusLabel,
        currentlyOutstanding: true,
        orderNumber: line.orderNumber,
        customerAccount: line.customerAccount,
        customerName: line.customerName,
        customerOrderRef: line.customerOrderRef,
        companyId: line.companyId,
        companyName: line.companyName,
        unmapped: line.unmapped,
        sku: line.sku,
        partMatchKey: line.partMatchKey,
        description: line.description,
        productKind: line.productKind,
        productKindLabel: line.productKindLabel,
        brand: line.brand,
        brandSlug: line.brandSlug,
        ...quantities,
        unitValue: line.unitValue,
        previousValue:
          movement === "NEW" ? null : previousValueOf(line.identityKey, quantities.previousQty, line.unitValue),
        currentValue: line.outstandingValue,
        firstSeenAt: line.firstSeenAt,
        ageLabel: line.ageLabel,
        lastChangedAt: line.lastChangedAt,
        clearedAt: null,
        availQty: line.availQty,
        incomingQty: line.incomingQty,
        position: line.position,
        positionLabel: line.positionLabel,
        coverSummary: line.coverSummary,
        conditionCode: line.conditionCode,
        conditionLabel: line.conditionLabel,
      };
    }).sort(movementSort);
  }

  const ignoredFilters = ignored.filter((key) => input[key] != null) as Autopart216vMovementFilterKey[];
  return {
    movement,
    label: AUTOPART_216V_MOVEMENT_LABEL[movement],
    kpiCount: movementLines.length,
    ignoredFilters,
    previousSnapshot: previous
      ? {
          id: previous.id,
          filename: previous.filename,
          receivedLabel: formatOrDash(formatOperationalDateTime(previous.receivedAt ?? previous.importedAt)),
        }
      : null,
    rows,
  };
}

async function feedSettingsRow() {
  return prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export async function outstandingBackorderUnitsBySku(): Promise<Map<string, number>> {
  const latest = await prisma.autopartBackorderSnapshot.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { importedAt: "desc" },
    select: { id: true },
  });
  const out = new Map<string, number>();
  if (!latest) return out;
  const grouped = await prisma.autopartBackorderLine.groupBy({
    by: ["partMatchKey"],
    where: { snapshotId: latest.id, changeStatus: { not: "CLEARED" } },
    _sum: { outstandingQty: true },
  });
  for (const row of grouped) {
    out.set(row.partMatchKey, num(row._sum.outstandingQty));
  }
  return out;
}

export async function getBackorderWorkspace(actorUserId: string, raw: unknown = {}) {
  const profile = await requirePurchasingAccess(actorUserId);
  const input = listInput.parse(raw ?? {});
  const [snapshot, settings] = await Promise.all([loadLatestSnapshot(), feedSettingsRow()]);
  const now = new Date();
  const lastBusinessDate = snapshot ? dateOnlyIsoFromDate(snapshot.businessDate) : null;
  const freshness = resolveAutopart216vFreshness({
    lastSuccessAt: snapshot?.importedAt ?? settings.lastSuccessAt,
    lastBusinessDate,
    now,
    scheduleHour: settings.scheduleHour,
  });

  const allLines = snapshot ? enrichLines(snapshot.lines as unknown as LineRow[], now) : [];
  const changeCounts = {
    NEW: allLines.filter((l) => l.status === "NEW").length,
    UNCHANGED: allLines.filter((l) => l.status === "UNCHANGED").length,
    QUANTITY_REDUCED: allLines.filter((l) => l.status === "QUANTITY_REDUCED").length,
    QUANTITY_INCREASED: allLines.filter((l) => l.status === "QUANTITY_INCREASED").length,
    CLEARED: snapshot?.lines.filter((l) => l.changeStatus === "CLEARED").length ?? 0,
  };

  const filtered = applyFilters(allLines, input);
  const pageSize = input.pageSize ?? 50;
  const page = input.page ?? 1;
  const view = input.view ?? "lines";
  const skuGroups = groupSkus(filtered);
  const customerGroups = groupCustomers(filtered);
  const attention = {
    rules: AUTOPART_216V_ATTENTION_RULES,
    STOCK_NOW_AVAILABLE: filtered.filter((l) => l.attention.includes("STOCK_NOW_AVAILABLE")),
    NO_STOCK_NO_INCOMING: filtered.filter((l) => l.attention.includes("NO_STOCK_NO_INCOMING")),
    INCOMING_DOES_NOT_COVER: filtered.filter((l) => l.attention.includes("INCOMING_DOES_NOT_COVER")),
    LONG_STANDING: filtered.filter((l) => l.attention.includes("LONG_STANDING")),
    HIGH_VALUE: filtered.filter((l) => l.attention.includes("HIGH_VALUE")),
  };

  const uniqueAttentionIds = new Set(filtered.filter((l) => l.attention.length > 0).map((l) => l.id));
  const attentionSummary = {
    STOCK_NOW_AVAILABLE: attention.STOCK_NOW_AVAILABLE.length,
    NO_STOCK_NO_INCOMING: attention.NO_STOCK_NO_INCOMING.length,
    INCOMING_DOES_NOT_COVER: attention.INCOMING_DOES_NOT_COVER.length,
    LONG_STANDING: attention.LONG_STANDING.length,
    HIGH_VALUE: attention.HIGH_VALUE.length,
    unique: uniqueAttentionIds.size,
  };

  const pagedLines = paginate(filtered, page, pageSize);
  const pagedSkus = paginate(skuGroups, page, pageSize);
  const pagedCustomers = paginate(customerGroups, page, pageSize);

  const movementResult =
    snapshot && input.movement ? await buildMovementRows(snapshot, allLines, input.movement, input, now) : null;
  const movement = movementResult
    ? {
        movement: movementResult.movement,
        label: movementResult.label,
        kpiCount: movementResult.kpiCount,
        ignoredFilters: movementResult.ignoredFilters,
        previousSnapshot: movementResult.previousSnapshot,
        ...paginate(movementResult.rows, page, pageSize),
      }
    : null;

  const brands = [...new Set(allLines.map((l) => l.brandSlug).filter((b): b is string => Boolean(b)))].sort();
  const customers = [...new Map(allLines.map((l) => [l.customerAccount.trim().toUpperCase(), l.customerName])).entries()]
    .filter(([acc]) => acc)
    .map(([account, name]) => ({ account, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    canManage: hasPermission(profile, "purchasing.manage"),
    freshness: {
      ...freshness,
      headline: headline216vFeedHealth({
        status: freshness.status,
        stale: freshness.stale,
        lastError: settings.lastError,
        lastBusinessDate,
      }),
      lastReceivedLabel: snapshot
        ? formatOrDash(formatOperationalDateTime(snapshot.receivedAt ?? snapshot.importedAt))
        : "Never",
      nextExpectedLabel: next216vExpectedLabel(now),
      filename: snapshot?.filename ?? null,
      emptyValid: snapshot?.emptyValid ?? false,
      source: snapshot?.source ?? null,
      sourceLabel: label216vSnapshotSource(snapshot?.source ?? null),
    },
    feed: {
      enabled: settings.enabled,
      configured: settings.configured,
      scheduleHour: settings.scheduleHour,
      workingDaysOnly: settings.workingDaysOnly,
      allowedSender: settings.allowedSender,
      lastPolledAt: settings.lastPolledAt?.toISOString() ?? null,
      lastSuccessAt: settings.lastSuccessAt?.toISOString() ?? null,
      lastError: settings.lastError,
      automaticPolling: settings.enabled ? ("ON" as const) : ("OFF" as const),
    },
    current: snapshot
      ? {
          snapshotId: snapshot.id,
          outstandingOrders: snapshot.orderCount,
          outstandingLines: snapshot.outstandingLineCount,
          customers: snapshot.accountCount,
          outstandingUnits: num(snapshot.outstandingQty),
          outstandingValue: money(snapshot.outstandingValue) ?? "0.00",
          newToday: changeCounts.NEW,
          clearedSincePrevious: changeCounts.CLEARED,
          reducedSincePrevious: changeCounts.QUANTITY_REDUCED,
          increasedSincePrevious: changeCounts.QUANTITY_INCREASED,
        }
      : null,
    identity:
      "Order No + customer account + SKU matchKey + customer order/reference (occurrence suffix if the same combination repeats in the file)",
    changeCounts,
    brands,
    customers,
    view,
    viewCounts: {
      lines: filtered.length,
      skus: skuGroups.length,
      customers: customerGroups.length,
      attention: attentionSummary.unique,
    },
    attentionSummary,
    lines: view === "lines" ? pagedLines : { total: filtered.length, page, pageSize, rows: [] as BackorderLineView[] },
    skus: view === "sku" ? pagedSkus : { total: skuGroups.length, page, pageSize, rows: [] as ReturnType<typeof groupSkus> },
    customerGroups:
      view === "customer"
        ? pagedCustomers
        : { total: customerGroups.length, page, pageSize, rows: [] as ReturnType<typeof groupCustomers> },
    attention,
    movement,
  };
}

export async function getBackorderLineDetail(actorUserId: string, lineId: string) {
  await requirePurchasingAccess(actorUserId);
  const current = await prisma.autopartBackorderLine.findUnique({
    where: { id: lineId },
    include: { ...lineInclude, snapshot: true },
  });
  if (!current) throw new AuthError("Backorder line not found", "NOT_FOUND", 404);
  if (current.changeStatus === "CLEARED") {
    throw new AuthError("Cleared backorders are historical and have no current outstanding detail", "NOT_FOUND", 404);
  }
  const [history, enriched] = await Promise.all([
    prisma.autopartBackorderLine.findMany({
      where: { identityKey: current.identityKey, snapshot: { status: "COMMITTED" } },
      select: {
        outstandingQty: true,
        changeStatus: true,
        snapshot: { select: { businessDate: true, importedAt: true } },
      },
      orderBy: { snapshot: { businessDate: "asc" } },
    }),
    Promise.resolve(enrichLines([current as unknown as LineRow])[0]!),
  ]);
  const timeline = history.map((h) => ({
    date: dateOnlyIsoFromDate(h.snapshot.businessDate),
    qty: num(h.outstandingQty),
    status: h.changeStatus,
  }));
  return {
    line: enriched,
    timeline,
    stockDisclaimer:
      "Line-level cover is indicative and is not a reservation or allocation. Multiple backorders share the same Autopart Avail.",
  };
}

function movementCsv(movement: Autopart216vMovement, rows: BackorderMovementRowView[]) {
  const header = [
    "Movement",
    "Status",
    "Order No",
    "Customer Account",
    "Customer",
    "Customer Order Ref",
    "SKU",
    "Description",
    "Previous Qty",
    "Current Qty",
    "Change",
    "Unit Value",
    "Previous Value",
    "Current Value",
    "First Seen",
    movement === "CLEARED" ? "Cleared At" : "Last Changed",
    "Avail",
    "Incoming",
    "Stock Position",
    "Product Type",
    ...(movement === "CLEARED"
      ? ["Current Condition Code", "Current Product Condition"]
      : ["Condition Code", "Condition"]),
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [
        csvCell(AUTOPART_216V_MOVEMENT_LABEL[movement]),
        csvCell(r.statusLabel),
        csvCell(r.orderNumber),
        csvCell(r.customerAccount),
        csvCell(r.customerName),
        csvCell(r.customerOrderRef),
        csvCell(r.sku),
        csvCell(r.description),
        r.previousQty ?? "",
        r.currentQty ?? "",
        r.changeQty ?? "",
        r.unitValue ?? "",
        r.previousValue ?? "",
        r.currentValue ?? "",
        csvCell(r.firstSeenAt.slice(0, 10)),
        csvCell((r.clearedAt ?? r.lastChangedAt).slice(0, 10)),
        r.availQty ?? "",
        r.incomingQty ?? "",
        csvCell(r.positionLabel ?? ""),
        csvCell(r.productKindLabel),
        csvCell(r.conditionCode ?? ""),
        csvCell(r.conditionCode ? (r.conditionLabel ?? "") : ""),
      ].join(","),
    ),
  ].join("\n");
  return {
    filename: `autopart-216v-backorders-${movement.toLowerCase()}.csv`,
    csv,
    mime: "text/csv;charset=utf-8",
  };
}

export async function exportBackordersCsv(actorUserId: string, raw: unknown = {}) {
  await requirePurchasingAccess(actorUserId);
  const input = listInput.parse(raw ?? {});
  const snapshot = await loadLatestSnapshot();
  if (input.movement) {
    const movementRows = snapshot
      ? (await buildMovementRows(snapshot, enrichLines(snapshot.lines as unknown as LineRow[]), input.movement, input, new Date())).rows
      : [];
    return movementCsv(input.movement, movementRows);
  }
  const rows = snapshot ? applyFilters(enrichLines(snapshot.lines as unknown as LineRow[]), input) : [];
  const header = [
    "Status",
    "First Seen",
    "Order No",
    "Customer Account",
    "Customer",
    "Customer Order Ref",
    "SKU",
    "Description",
    "Outstanding Qty",
    "Unit Value",
    "Outstanding Value",
    "Avail",
    "Incoming",
    "Stock Position",
    "Product Type",
    "Condition Code",
    "Condition",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [
        csvCell(r.statusLabel),
        csvCell(r.firstSeenAt.slice(0, 10)),
        csvCell(r.orderNumber),
        csvCell(r.customerAccount),
        csvCell(r.customerName),
        csvCell(r.customerOrderRef),
        csvCell(r.sku),
        csvCell(r.description),
        r.outstandingQty,
        r.unitValue ?? "",
        r.outstandingValue ?? "",
        r.availQty ?? "",
        r.incomingQty ?? "",
        csvCell(r.positionLabel),
        csvCell(r.productKindLabel),
        csvCell(r.conditionCode ?? ""),
        csvCell(r.conditionCode ? (r.conditionLabel ?? "") : ""),
      ].join(","),
    ),
  ].join("\n");
  return { filename: "autopart-216v-backorders.csv", csv, mime: "text/csv;charset=utf-8" };
}

export async function getBackorderFeedSettings(actorUserId: string) {
  const workspace = await getBackorderWorkspace(actorUserId, { pageSize: 1 });
  return { feed: workspace.feed, freshness: workspace.freshness, canManage: workspace.canManage };
}

export async function updateBackorderFeedSettings(
  actorUserId: string,
  raw: { enabled?: boolean; allowedSender?: string | null },
) {
  await requireBackorderManage(actorUserId);
  const enabled = Boolean(raw.enabled);
  const allowedSender = raw.allowedSender?.trim() || null;
  const row = await prisma.autopartBackorderFeedSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled, allowedSender, configured: enabled },
    update: { enabled, allowedSender, configured: enabled, updatedByUserId: actorUserId },
  });
  return {
    enabled: row.enabled,
    configured: row.configured,
    allowedSender: row.allowedSender,
    automaticPolling: row.enabled ? ("ON" as const) : ("OFF" as const),
  };
}
