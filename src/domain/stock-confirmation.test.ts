import { describe, expect, it } from "vitest";
import {
  adminStockStatusLabel,
  isOrderableWithConfirmedStock,
  isTrustedAutopartMasterForReconcile,
  publicAvailabilityFromConfirmation,
  resolveStockConfirmationState,
} from "@/domain/stock-confirmation";
import { isOrderableByStockPolicy } from "@/domain/ordering";
import { decodeStockFeedBytes } from "@/domain/stock-feed-decode";

describe("stock confirmation states", () => {
  it("treats missing inventory as UNSYNCED", () => {
    expect(
      resolveStockConfirmationState({
        hasInventoryRow: false,
        stockSource: "AUTOPART",
        onHandQty: 0,
        stale: false,
      }),
    ).toBe("UNSYNCED");
  });

  it("distinguishes confirmed zero, positive, stale, and manual", () => {
    expect(
      resolveStockConfirmationState({
        hasInventoryRow: true,
        stockSource: "AUTOPART",
        onHandQty: 0,
        stale: false,
      }),
    ).toBe("CONFIRMED_ZERO");
    expect(
      resolveStockConfirmationState({
        hasInventoryRow: true,
        stockSource: "AUTOPART",
        onHandQty: 20,
        stale: false,
      }),
    ).toBe("CONFIRMED_POSITIVE");
    expect(
      resolveStockConfirmationState({
        hasInventoryRow: true,
        stockSource: "AUTOPART",
        onHandQty: 20,
        stale: true,
      }),
    ).toBe("STALE");
    expect(
      resolveStockConfirmationState({
        hasInventoryRow: true,
        stockSource: "MANUAL",
        onHandQty: 0,
        stale: true,
      }),
    ).toBe("MANUAL_OVERRIDE");
  });

  it("never advertises unknown stock as in-stock or backorder", () => {
    expect(
      publicAvailabilityFromConfirmation({
        state: "UNSYNCED",
        sellableQty: 0,
        stale: false,
        backorderAllowed: true,
      }),
    ).toBeNull();
    expect(
      publicAvailabilityFromConfirmation({
        state: "CONFIRMED_ZERO",
        sellableQty: 0,
        stale: false,
        backorderAllowed: true,
      }),
    ).toBe("backorder");
    expect(
      publicAvailabilityFromConfirmation({
        state: "CONFIRMED_ZERO",
        sellableQty: 0,
        stale: false,
        backorderAllowed: false,
      }),
    ).toBe("out");
  });

  it("blocks ordering for unknown stock even when backorders ALLOW", () => {
    expect(
      isOrderableWithConfirmedStock({
        stockConfirmed: false,
        sellableQty: 0,
        stale: false,
        backorderPolicy: "ALLOW",
      }),
    ).toBe(false);
    expect(
      isOrderableByStockPolicy(
        { sellableQty: 0, stale: false, availability: null, stockConfirmed: false },
        "ALLOW",
      ),
    ).toBe(false);
    expect(
      isOrderableWithConfirmedStock({
        stockConfirmed: true,
        sellableQty: 0,
        stale: false,
        backorderPolicy: "ALLOW",
      }),
    ).toBe(true);
    expect(
      isOrderableWithConfirmedStock({
        stockConfirmed: true,
        sellableQty: 0,
        stale: false,
        backorderPolicy: "DENY",
      }),
    ).toBe(false);
    expect(
      isOrderableWithConfirmedStock({
        stockConfirmed: true,
        sellableQty: 20,
        stale: false,
        backorderPolicy: "DENY",
      }),
    ).toBe(true);
  });

  it("labels admin status clearly", () => {
    expect(
      adminStockStatusLabel({
        state: "UNSYNCED",
        sellableQty: 0,
        backorderAllowed: true,
        availability: null,
      }),
    ).toBe("Stock not confirmed");
    expect(
      adminStockStatusLabel({
        state: "CONFIRMED_ZERO",
        sellableQty: 0,
        backorderAllowed: true,
        availability: "backorder",
      }),
    ).toBe("Available to Backorder");
  });

  it("trusts presentInLatestFeed or recent lastSeenAt", () => {
    const now = new Date("2026-11-06T12:00:00.000Z");
    expect(
      isTrustedAutopartMasterForReconcile({
        presentInLatestFeed: true,
        lastSeenAt: null,
        now,
      }),
    ).toBe(true);
    expect(
      isTrustedAutopartMasterForReconcile({
        presentInLatestFeed: false,
        lastSeenAt: new Date("2026-11-06T10:00:00.000Z"),
        now,
        staleHours: 36,
      }),
    ).toBe(true);
    expect(
      isTrustedAutopartMasterForReconcile({
        presentInLatestFeed: false,
        lastSeenAt: new Date("2026-11-01T10:00:00.000Z"),
        now,
        staleHours: 36,
      }),
    ).toBe(false);
  });
});

describe("stock feed decode", () => {
  it("strips UTF-8 BOM and prefers windows-1252 when it preserves Avail headers", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("(231PO3NEW)\nPart Number  Stk  Avail  Pick Qty\n")]);
    const decoded = decodeStockFeedBytes(withBom);
    expect(decoded.bom).toBe(true);
    expect(decoded.text).toContain("231PO3NEW");
    expect(decoded.text.charCodeAt(0)).not.toBe(0xfeff);
  });
});
