import { describe, expect, it } from "vitest";
import {
  configuredReorderPoint,
  fbaImportHealth,
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
});
