/**
 * Stock Overview figures.
 *
 * Physical stock is the Autopart Physical Stk column for the Studley feed.
 * Sellable stock is catalogue Studley Avail minus Automotive Brands reservations.
 * Those columns can differ when reservations are zero because Avail is not Physical Stk.
 * Amazon FBA UK is never added to these totals.
 * Low stock uses a configured safety-stock threshold only — never a fixed band.
 */
import {
  estimatedLineValue,
  resolvePurchasingCost,
  type PurchasingCostSource,
} from "@/domain/purchasing-planner";
import { addMoney, moneyToString, parseMoney, type Money } from "@/domain/money";
import { getEffectiveSellableQuantity, sellableQuantityFromAvail } from "@/domain/stock";

export type OverviewStockStatus = "IN_STOCK" | "LOW" | "OUT_OF_STOCK" | "UNKNOWN";

export type WarehouseImportHealth = "running" | "failed" | "delayed" | "healthy" | "unknown";

export type FbaImportHealth = "current" | "delayed" | "unknown";

/** Variant safety stock wins. A null value is not configured. The global default is not applied. */
export function configuredReorderPoint(
  variantSafety: number | null | undefined,
  autopartSafety: number | null | undefined,
): number | null {
  if (variantSafety != null && Number.isFinite(variantSafety)) return Math.trunc(variantSafety);
  if (autopartSafety != null && Number.isFinite(autopartSafety)) return Math.trunc(autopartSafety);
  return null;
}

export function overviewStockStatus(input: {
  presentInLatestFeed: boolean;
  availQty: number;
  reorderPoint: number | null;
}): OverviewStockStatus {
  if (!input.presentInLatestFeed || !Number.isFinite(input.availQty)) return "UNKNOWN";
  const avail = sellableQuantityFromAvail(input.availQty);
  if (input.availQty <= 0) return "OUT_OF_STOCK";
  if (input.reorderPoint != null && avail <= input.reorderPoint) return "LOW";
  return "IN_STOCK";
}

/** Catalogue-linked sellable stock. Unlinked part numbers are not B2B sellable. */
export function overviewSellableQty(
  linked: boolean,
  availQty: number,
  reservedQty: number | null,
): number | null {
  if (!linked) return null;
  return getEffectiveSellableQuantity({
    autopartAvail: availQty,
    reservedQty: reservedQty ?? 0,
  });
}

/** Reservations held against a catalogue variant. Unlinked parts have no reservation ledger. */
export function overviewUnavailableQty(linked: boolean, reservedQty: number | null): number | null {
  if (!linked) return null;
  return Math.max(0, Math.trunc(reservedQty ?? 0));
}

export const PHYSICAL_QTY_HELP =
  "Studley physical stock from the Autopart feed (Physical Stk). It is not a total of every location and it does not include FBA UK. It can differ from sellable stock when Autopart Avail is lower, even if reservations are zero.";

export const SELLABLE_QTY_HELP =
  "Catalogue Studley availability: Autopart Avail minus Automotive Brands reservations. FBA UK is excluded. Unlinked part numbers have no B2B sellable quantity.";

export const UNAVAILABLE_QTY_HELP =
  "Automotive Brands reservations against Studley Avail. This is not the difference between physical and sellable stock.";

export const STOCK_VALUE_HELP =
  "Physical quantity × unit cost. Unit cost is the preferred supplier cost when one is designated, otherwise Autopart Latest Cost. Selling prices are not used. FBA UK is excluded.";

/** A fresh Stock Overview visit shows catalogue-linked part numbers. Explicit All stays All. */
export function defaultStockOverviewCatalogue(
  value: string | null | undefined,
): "all" | "catalogue" | "external" {
  if (value === "all" || value === "catalogue" || value === "external") return value;
  return "catalogue";
}

export function overviewLineValues(input: {
  physicalQty: number | null;
  sellableQty: number | null;
  supplierUnitCost: string | null;
  latestCost: string | null;
}): {
  unitCost: string | null;
  source: PurchasingCostSource;
  physicalValue: string | null;
  sellableValue: string | null;
} {
  const resolved = resolvePurchasingCost({
    supplierUnitCost: input.supplierUnitCost,
    latestCost: input.latestCost,
  });
  return {
    unitCost: resolved.cost,
    source: resolved.source,
    physicalValue:
      input.physicalQty == null ? null : estimatedLineValue(input.physicalQty, resolved.cost),
    sellableValue:
      input.sellableQty == null ? null : estimatedLineValue(input.sellableQty, resolved.cost),
  };
}

export type OverviewValueTotals = {
  physicalValue: string | null;
  sellableValue: string | null;
  missingCost: number;
  products: number;
  valuedPhysical: number;
  valuedSellable: number;
};

function addKnown(
  current: Money | null,
  amount: string | null,
): { total: Money | null; added: boolean } {
  if (amount == null) return { total: current, added: false };
  const parsed = parseMoney(amount);
  if (!parsed) return { total: current, added: false };
  return { total: current ? addMoney(current, parsed) : parsed, added: true };
}

/** Sums one value per product. A missing cost contributes nothing and is not stored as £0. */
export function accumulateOverviewValue(
  current: {
    physical: Money | null;
    sellable: Money | null;
    missingCost: number;
    products: number;
    valuedPhysical: number;
    valuedSellable: number;
  },
  line: ReturnType<typeof overviewLineValues>,
): void {
  current.products += 1;
  if (line.source === "MISSING") current.missingCost += 1;
  const physical = addKnown(current.physical, line.physicalValue);
  current.physical = physical.total;
  if (physical.added) current.valuedPhysical += 1;
  const sellable = addKnown(current.sellable, line.sellableValue);
  current.sellable = sellable.total;
  if (sellable.added) current.valuedSellable += 1;
}

export function emptyOverviewValue() {
  return {
    physical: null as Money | null,
    sellable: null as Money | null,
    missingCost: 0,
    products: 0,
    valuedPhysical: 0,
    valuedSellable: 0,
  };
}

export function finishOverviewValue(
  current: ReturnType<typeof emptyOverviewValue>,
): OverviewValueTotals {
  return {
    physicalValue: current.physical ? moneyToString(current.physical, 2) : null,
    sellableValue: current.sellable ? moneyToString(current.sellable, 2) : null,
    missingCost: current.missingCost,
    products: current.products,
    valuedPhysical: current.valuedPhysical,
    valuedSellable: current.valuedSellable,
  };
}

/**
 * Healthy only after a fresh successful warehouse import.
 * Stock rows existing is not an input and must not imply health.
 */
export function warehouseImportHealth(input: {
  running: boolean;
  latestStatus: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | null;
  hasSuccessfulImport: boolean;
  stale: boolean;
}): WarehouseImportHealth {
  if (input.running || input.latestStatus === "RUNNING") return "running";
  if (input.latestStatus === "FAILED") return "failed";
  if (!input.hasSuccessfulImport) return "unknown";
  if (input.stale) return "delayed";
  if (input.latestStatus === "SUCCESS" || input.latestStatus === "PARTIAL") return "healthy";
  return "unknown";
}

/** Based on the last successful FBA import file, not on location-stock rows existing. */
export function fbaImportHealth(input: {
  importedAt: string | null;
  stale: boolean;
}): FbaImportHealth {
  if (!input.importedAt) return "unknown";
  return input.stale ? "delayed" : "current";
}

export function overviewStatusLabel(status: OverviewStockStatus): string {
  if (status === "IN_STOCK") return "In Stock";
  if (status === "LOW") return "Low Stock";
  if (status === "OUT_OF_STOCK") return "Out of Stock";
  return "Unknown / Data Unavailable";
}
