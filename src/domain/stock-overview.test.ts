import { describe, expect, it } from "vitest";
import { fbaLocationForImport, FBA_COUNTRY_LOCATIONS } from "@/domain/fba-stock";
import { warehouseDisplayName } from "@/domain/stock";
import {
  accumulateOverviewValue,
  configuredReorderPoint,
  defaultStockOverviewCatalogue,
  emptyOverviewValue,
  fbaImportHealth,
  finishOverviewValue,
  overviewLineValues,
  overviewSellableQty,
  overviewStatusLabel,
  overviewStockStatus,
  overviewUnavailableQty,
  warehouseImportHealth,
} from "@/domain/stock-overview";

describe("stock overview calculations", () => {
  it("does not treat a small quantity as low stock without a configured threshold", () => {
    expect(
      overviewStockStatus({ presentInLatestFeed: true, availQty: 3, reorderPoint: null }),
    ).toBe("IN_STOCK");
    expect(
      overviewStockStatus({ presentInLatestFeed: true, availQty: 20, reorderPoint: null }),
    ).toBe("IN_STOCK");
    expect(configuredReorderPoint(null, null)).toBeNull();
  });

  it("uses the configured reorder point and keeps zero as out of stock", () => {
    expect(configuredReorderPoint(12, 4)).toBe(12);
    expect(configuredReorderPoint(null, 4)).toBe(4);
    expect(configuredReorderPoint(0, null)).toBe(0);
    expect(overviewStockStatus({ presentInLatestFeed: true, availQty: 10, reorderPoint: 12 })).toBe(
      "LOW",
    );
    expect(overviewStockStatus({ presentInLatestFeed: true, availQty: 12, reorderPoint: 12 })).toBe(
      "LOW",
    );
    expect(overviewStockStatus({ presentInLatestFeed: true, availQty: 13, reorderPoint: 12 })).toBe(
      "IN_STOCK",
    );
    expect(overviewStockStatus({ presentInLatestFeed: true, availQty: 0, reorderPoint: 12 })).toBe(
      "OUT_OF_STOCK",
    );
    expect(
      overviewStockStatus({ presentInLatestFeed: true, availQty: -3, reorderPoint: null }),
    ).toBe("OUT_OF_STOCK");
  });

  it("marks parts missing from the latest import as unknown", () => {
    expect(overviewStockStatus({ presentInLatestFeed: false, availQty: 8, reorderPoint: 1 })).toBe(
      "UNKNOWN",
    );
    expect(overviewStatusLabel("UNKNOWN")).toBe("Unknown / Data Unavailable");
  });

  it("sells catalogue Avail minus reservations and leaves unlinked sellable empty", () => {
    expect(overviewSellableQty(true, 20, 0)).toBe(20);
    expect(overviewSellableQty(true, 10, 4)).toBe(6);
    expect(overviewSellableQty(true, 2, 9)).toBe(0);
    expect(overviewSellableQty(false, 40, null)).toBeNull();
    expect(overviewUnavailableQty(true, 4)).toBe(4);
    expect(overviewUnavailableQty(false, null)).toBeNull();
  });

  it("does not call the import healthy just because a status is missing or stale", () => {
    expect(
      warehouseImportHealth({
        running: false,
        latestStatus: null,
        hasSuccessfulImport: false,
        stale: false,
      }),
    ).toBe("unknown");
    expect(
      warehouseImportHealth({
        running: false,
        latestStatus: "FAILED",
        hasSuccessfulImport: true,
        stale: false,
      }),
    ).toBe("failed");
    expect(
      warehouseImportHealth({
        running: true,
        latestStatus: "FAILED",
        hasSuccessfulImport: true,
        stale: true,
      }),
    ).toBe("running");
    expect(
      warehouseImportHealth({
        running: false,
        latestStatus: "SUCCESS",
        hasSuccessfulImport: true,
        stale: true,
      }),
    ).toBe("delayed");
    expect(
      warehouseImportHealth({
        running: false,
        latestStatus: "SUCCESS",
        hasSuccessfulImport: true,
        stale: false,
      }),
    ).toBe("healthy");
    expect(fbaImportHealth({ importedAt: null, stale: false })).toBe("unknown");
    expect(fbaImportHealth({ importedAt: "2026-10-01T00:00:00.000Z", stale: true })).toBe(
      "delayed",
    );
  });

  it("keeps a fresh visit on linked products and an explicit All selection", () => {
    expect(defaultStockOverviewCatalogue(undefined)).toBe("catalogue");
    expect(defaultStockOverviewCatalogue("")).toBe("catalogue");
    expect(defaultStockOverviewCatalogue("all")).toBe("all");
    expect(defaultStockOverviewCatalogue("external")).toBe("external");
  });

  it("values physical and sellable stock from supplier cost or Autopart latest cost", () => {
    const override = overviewLineValues({
      physicalQty: 44,
      sellableQty: 6,
      supplierUnitCost: "2.0000",
      latestCost: "12.5000",
    });
    expect(override).toMatchObject({
      unitCost: "2.0000",
      source: "SUPPLIER_OVERRIDE",
      physicalValue: "88.00",
      sellableValue: "12.00",
    });
    const latest = overviewLineValues({
      physicalQty: 10,
      sellableQty: null,
      supplierUnitCost: null,
      latestCost: "9.0000",
    });
    expect(latest.physicalValue).toBe("90.00");
    expect(latest.sellableValue).toBeNull();
    const missing = overviewLineValues({
      physicalQty: 18,
      sellableQty: 6,
      supplierUnitCost: null,
      latestCost: null,
    });
    expect(missing.source).toBe("MISSING");
    expect(missing.physicalValue).toBeNull();
    expect(missing.sellableValue).toBeNull();

    const totals = emptyOverviewValue();
    accumulateOverviewValue(totals, override);
    accumulateOverviewValue(totals, latest);
    accumulateOverviewValue(totals, missing);
    expect(finishOverviewValue(totals)).toEqual({
      physicalValue: "178.00",
      sellableValue: "12.00",
      missingCost: 1,
      products: 3,
      valuedPhysical: 2,
      valuedSellable: 1,
    });
  });

  it("shows the Autopart warehouse as Studley and leaves other codes unchanged", () => {
    expect(warehouseDisplayName("AUTOPART", "Autopart")).toBe("Studley");
    expect(warehouseDisplayName("OTHER", "North depot")).toBe("North depot");
  });

  it("keeps future FBA countries off the UK location", () => {
    expect(fbaLocationForImport("UK")?.locationCode).toBe("FBA");
    expect(fbaLocationForImport("UK")?.label).toBe("FBA UK");
    expect(fbaLocationForImport("DE")).toBeNull();
    const codes = Object.values(FBA_COUNTRY_LOCATIONS).map((location) => location.locationCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("FBA_DE");
    expect(codes.filter((code) => code === "FBA")).toHaveLength(1);
  });
});
