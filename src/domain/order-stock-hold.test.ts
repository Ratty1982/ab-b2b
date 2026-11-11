import { describe, expect, it } from "vitest";
import {
  assessStockHoldLineCoverage,
  blocksAutopartExportForStockHold,
  isActiveStockHold,
  orderStockHoldReadyEmailIdempotencyKey,
  orderStockHoldReadyRecipientIdempotencyKey,
  staffStockHoldLabel,
  STOCK_HOLD_STAFF_LABEL,
} from "@/domain/order-stock-hold";

describe("order stock hold domain", () => {
  it("labels waiting holds for staff UIs and fail-closes export under hold policy", () => {
    expect(isActiveStockHold("WAITING_STOCK")).toBe(true);
    expect(isActiveStockHold("READY_TO_EXPORT")).toBe(false);
    expect(blocksAutopartExportForStockHold("WAITING_STOCK")).toBe(true);
    expect(blocksAutopartExportForStockHold("WAITING_STOCK", "SHIP_AS_AVAILABLE")).toBe(true);
    expect(blocksAutopartExportForStockHold("READY_TO_EXPORT")).toBe(false);
    expect(blocksAutopartExportForStockHold("CANCELLED_HOLD", "SHIP_AS_AVAILABLE")).toBe(false);
    expect(blocksAutopartExportForStockHold(null, "HOLD_UNTIL_COMPLETE")).toBe(true);
    expect(blocksAutopartExportForStockHold("NONE", "HOLD_UNTIL_COMPLETE")).toBe(true);
    expect(blocksAutopartExportForStockHold("WAITING_STOCK", "HOLD_UNTIL_COMPLETE")).toBe(true);
    expect(blocksAutopartExportForStockHold("CANCELLED_HOLD", "HOLD_UNTIL_COMPLETE")).toBe(true);
    expect(blocksAutopartExportForStockHold("READY_TO_EXPORT", "HOLD_UNTIL_COMPLETE")).toBe(true);
    expect(
      blocksAutopartExportForStockHold("READY_TO_EXPORT", "HOLD_UNTIL_COMPLETE", {
        stockReleasedAt: "2026-11-11T12:00:00.000Z",
        stockReleaseReason: "STOCK_SYNC_FULL_COVERAGE",
      }),
    ).toBe(false);
    expect(
      blocksAutopartExportForStockHold("READY_TO_EXPORT", "HOLD_UNTIL_COMPLETE", {
        stockReleasedAt: "2026-11-11T12:00:00.000Z",
        stockReleaseReason: "OPS_SQL",
      }),
    ).toBe(true);
    expect(staffStockHoldLabel("WAITING_STOCK")).toBe(STOCK_HOLD_STAFF_LABEL);
  });

  it("counts own ACTIVE reservations toward coverage without double-counting free stock", () => {
    const assessment = assessStockHoldLineCoverage([
      {
        orderItemId: "oi1",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget",
        requiredQty: 10,
        ownActiveReservedQty: 4,
        freeConfirmedSellableQty: 6,
        stockConfirmed: true,
      },
    ]);
    expect(assessment.fullyCoverable).toBe(true);
    expect(assessment.lines[0]?.remainingToReserve).toBe(6);
    expect(assessment.lines[0]?.availableIncludingOwn).toBe(10);
  });

  it("shares free + own pools across sibling lines of the same variant", () => {
    const falsePositive = assessStockHoldLineCoverage([
      {
        orderItemId: "oi1",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget A",
        requiredQty: 5,
        ownActiveReservedQty: 5,
        freeConfirmedSellableQty: 0,
        stockConfirmed: true,
      },
      {
        orderItemId: "oi2",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget B",
        requiredQty: 5,
        ownActiveReservedQty: 0,
        freeConfirmedSellableQty: 0,
        stockConfirmed: true,
      },
    ]);
    expect(falsePositive.fullyCoverable).toBe(false);
    expect(falsePositive.reason).toBe("INSUFFICIENT_STOCK");

    const covered = assessStockHoldLineCoverage([
      {
        orderItemId: "oi1",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget A",
        requiredQty: 5,
        ownActiveReservedQty: 5,
        freeConfirmedSellableQty: 5,
        stockConfirmed: true,
      },
      {
        orderItemId: "oi2",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget B",
        requiredQty: 5,
        ownActiveReservedQty: 0,
        freeConfirmedSellableQty: 5,
        stockConfirmed: true,
      },
    ]);
    expect(covered.fullyCoverable).toBe(true);
    expect(covered.lines.reduce((sum, line) => sum + line.remainingToReserve, 0)).toBe(5);
  });

  it("blocks when free + own cannot cover required qty", () => {
    const assessment = assessStockHoldLineCoverage([
      {
        orderItemId: "oi1",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget",
        requiredQty: 10,
        ownActiveReservedQty: 4,
        freeConfirmedSellableQty: 5,
        stockConfirmed: true,
      },
    ]);
    expect(assessment.fullyCoverable).toBe(false);
    expect(assessment.reason).toBe("INSUFFICIENT_STOCK");
    expect(assessment.blockingSkus[0]?.shortfallQty).toBe(1);
  });

  it("treats unconfirmed stock as unavailable beyond own reservations", () => {
    const assessment = assessStockHoldLineCoverage([
      {
        orderItemId: "oi1",
        variantId: "v1",
        sku: "SKU-A",
        name: "Widget",
        requiredQty: 5,
        ownActiveReservedQty: 2,
        freeConfirmedSellableQty: 99,
        stockConfirmed: false,
      },
    ]);
    expect(assessment.fullyCoverable).toBe(false);
    expect(assessment.reason).toBe("STOCK_UNTRUSTED");
    expect(assessment.lines[0]?.availableIncludingOwn).toBe(2);
  });

  it("builds stable email idempotency keys", () => {
    expect(orderStockHoldReadyEmailIdempotencyKey("ord1")).toBe(
      "ORDER_STOCK_HOLD_READY_INTERNAL:ord1",
    );
    expect(
      orderStockHoldReadyRecipientIdempotencyKey({
        orderId: "ord1",
        toEmail: "Rep@Example.com",
        salesRepEmail: "rep@example.com",
      }),
    ).toBe("ORDER_STOCK_HOLD_READY_INTERNAL_SALES_REP:ord1");
    expect(
      orderStockHoldReadyRecipientIdempotencyKey({
        orderId: "ord1",
        toEmail: "ops@example.com",
        salesRepEmail: "rep@example.com",
      }),
    ).toBe("ORDER_STOCK_HOLD_READY_INTERNAL:ord1:ops@example.com");
  });
});
