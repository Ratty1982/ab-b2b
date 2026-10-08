/**
 * Stock Overview figures.
 *
 * Warehouse Avail (AutopartProduct.availQty) is the imported sellable quantity.
 * B2B sellable stock is Avail minus catalogue reservations. Physical stock is a
 * separate imported figure. Amazon FBA is never added to these totals.
 * Low stock uses a configured safety-stock threshold only — never a fixed band.
 */
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
export function overviewSellableQty(linked: boolean, availQty: number, reservedQty: number | null): number | null {
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
export function fbaImportHealth(input: { importedAt: string | null; stale: boolean }): FbaImportHealth {
  if (!input.importedAt) return "unknown";
  return input.stale ? "delayed" : "current";
}

export function overviewStatusLabel(status: OverviewStockStatus): string {
  if (status === "IN_STOCK") return "In Stock";
  if (status === "LOW") return "Low Stock";
  if (status === "OUT_OF_STOCK") return "Out of Stock";
  return "Unknown";
}
