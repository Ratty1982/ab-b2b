import { describe, expect, it } from "vitest";
import { parseAutopart231Po3New } from "@/domain/stock-parse";
import { parseIncomingCell } from "@/domain/stock-parse-types";
import { publicAvailabilityFromQty } from "@/domain/availability";
import {
  buildNative231Po3New,
  buildNative231Po3NewTwoPages,
  NATIVE_231PO3NEW_PORD_HEADER,
} from "@/server/stock/fixtures/native-231po3new";
import {
  REAL_231PO3NEW_PORD_EXCERPT,
  REAL_231PO3NEW_PORD_EXPECTATIONS,
} from "@/server/stock/fixtures/real-231po3new-pord-excerpt";
import {
  suggestedPurchaseQty,
  resolvePurchasingStatus,
  DEFAULT_PURCHASING_SETTINGS,
} from "@/domain/purchasing-forecast";

function parsedOrThrow(text: string) {
  const parsed = parseAutopart231Po3New(text);
  if ("code" in parsed) throw new Error(parsed.message);
  return parsed;
}

describe("231PO3NEW P/Ord Qty → Incoming", () => {
  it("recognises P/Ord Qty on the real concatenated header", () => {
    expect(NATIVE_231PO3NEW_PORD_HEADER).toMatch(/P\/Ord Qty/);
    expect(NATIVE_231PO3NEW_PORD_HEADER).toMatch(/MaxOther Info/);
    expect(NATIVE_231PO3NEW_PORD_HEADER).toMatch(/P\/Ord QtySub Grp/);
    const parsed = parsedOrThrow(
      buildNative231Po3New([
        {
          sku: "GC5000",
          description: "GLASS CLEANER 5L",
          stk: "93.0000",
          avail: "36.0000",
          pick: "0.0000",
          physical: "93.0000",
          incoming: "240.0000",
        },
      ]),
    );
    expect(parsed.incomingHeader).toBe("P/Ord Qty");
  });

  it("maps P/Ord Qty to incomingQty and does not use the field after Physical Stk", () => {
    const parsed = parsedOrThrow(
      buildNative231Po3New([
        {
          sku: "GC5000",
          description: "GLASS CLEANER 5L",
          stk: "40.0000",
          avail: "37.0000",
          pick: "0.0000",
          physical: "41.0000",
          incoming: "240.0000",
          ryr: "120",
          curr: "9",
          mth1: "14",
          min: "24",
          max: "96",
        },
        {
          sku: "ZEROIN",
          description: "ZERO INCOMING",
          stk: "10.0000",
          avail: "8.0000",
          pick: "0.0000",
          physical: "10.0000",
          incoming: "0.0000",
          ryr: "111",
          curr: "9",
          mth1: "14",
          min: "24",
          max: "96",
        },
        {
          sku: "BLANKIN",
          description: "BLANK INCOMING",
          stk: "10.0000",
          avail: "9.0000",
          pick: "0.0000",
          physical: "10.0000",
          incoming: "",
        },
      ]),
    );
    const gc = parsed.rows.find((r) => r.sku === "GC5000");
    expect(gc?.avail).toMatchObject({ ok: true, value: 37 });
    expect(gc?.incoming).toEqual({ ok: true, value: 240, raw: "240.0000" });
    expect(gc?.incoming).not.toMatchObject({ value: 41 });
    expect(gc?.incoming).not.toMatchObject({ value: 120 });
    expect(gc?.incoming).not.toMatchObject({ value: 9 });
    expect(gc?.incoming).not.toMatchObject({ value: 14 });
    expect(gc?.incoming).not.toMatchObject({ value: 24 });
    expect(gc?.incoming).not.toMatchObject({ value: 96 });
    expect(parsed.rows.find((r) => r.sku === "ZEROIN")?.incoming).toMatchObject({ ok: true, value: 0 });
    expect(parsed.rows.find((r) => r.sku === "BLANKIN")?.incoming).toMatchObject({ ok: false, reason: "blank" });
  });

  it("does not treat an Incoming header or Ryr/Curr/Mth/Min/Max as P/Ord Qty", () => {
    const fakeIncoming = [
      "Page : 1",
      "AUTOPART SYSTEM STOCK USAGES / REORDER INFORMATION (231PO3NEW)",
      "Branch  Group Part Number          C Description                     Latest Cost     Stk     Avail  Pick Qty Physical Stk Incoming",
      "--------------------------------------------------------------------------------",
      "  01    AA    GC5000                   GLASS CLEANER 5L                 1.41   93.0000  36.0000   0.0000    93.0000     120",
      "  01    AA    OK2                      OK TWO                           1.41   11.0000   9.0000   0.0000    11.0000      48",
      "  01    AA    OK3                      OK THREE                         1.41   12.0000  10.0000   0.0000    12.0000      96",
    ].join("\n");
    const parsed = parsedOrThrow(fakeIncoming);
    expect(parsed.incomingHeader).toBeNull();
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 36 });
    expect(parsed.rows[0]?.incoming).toBeUndefined();
  });

  it("keeps Avail when P/Ord Qty is malformed or negative", () => {
    const parsed = parsedOrThrow(
      buildNative231Po3New([
        { sku: "OK1", description: "OK ONE", stk: "10.0000", avail: "8.0000", pick: "0.0000", physical: "10.0000", incoming: "12.0000" },
        { sku: "OK2", description: "OK TWO", stk: "11.0000", avail: "9.0000", pick: "0.0000", physical: "11.0000", incoming: "36.0000" },
        { sku: "OK3", description: "OK THREE", stk: "12.0000", avail: "10.0000", pick: "0.0000", physical: "12.0000", incoming: "48.0000" },
        { sku: "BADIN", description: "BAD INCOMING", stk: "13.0000", avail: "11.0000", pick: "0.0000", physical: "13.0000", incoming: "n/a" },
        { sku: "NEGIN", description: "NEG INCOMING", stk: "14.0000", avail: "7.0000", pick: "0.0000", physical: "14.0000", incoming: "-4" },
      ]),
    );
    expect(parsed.rows.find((r) => r.sku === "BADIN")?.avail).toMatchObject({ ok: true, value: 11 });
    expect(parsed.rows.find((r) => r.sku === "BADIN")?.incoming).toMatchObject({ ok: false, reason: "invalid" });
    expect(parsed.rows.find((r) => r.sku === "NEGIN")?.avail).toMatchObject({ ok: true, value: 7 });
    expect(parsed.rows.find((r) => r.sku === "NEGIN")?.incoming).toMatchObject({ ok: false, reason: "negative" });
  });

  it("imports Avail when P/Ord Qty is missing and does not use a positional fallback", () => {
    const parsed = parsedOrThrow(
      buildNative231Po3New([
        { sku: "GC5000", description: "GLASS CLEANER 5L", stk: "93.0000", avail: "36.0000", pick: "0.0000", physical: "93.0000" },
      ]),
    );
    expect(parsed.incomingHeader).toBeNull();
    expect(parsed.rows[0]?.incoming).toBeUndefined();
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 36 });
  });

  it("ignores repeated page headers and still reads P/Ord Qty on page 2", () => {
    const text = buildNative231Po3NewTwoPages(
      [
        { sku: "P1A", description: "PAGE ONE A", stk: "10.0000", avail: "8.0000", pick: "0.0000", physical: "10.0000", incoming: "12.0000" },
        { sku: "P1B", description: "PAGE ONE B", stk: "11.0000", avail: "9.0000", pick: "0.0000", physical: "11.0000", incoming: "0.0000" },
        { sku: "P1C", description: "PAGE ONE C", stk: "12.0000", avail: "10.0000", pick: "0.0000", physical: "12.0000", incoming: "24.0000" },
      ],
      [
        { sku: "P2A", description: "PAGE TWO A", stk: "20.0000", avail: "18.0000", pick: "0.0000", physical: "20.0000", incoming: "240.0000" },
        { sku: "P2B", description: "PAGE TWO B", stk: "21.0000", avail: "19.0000", pick: "0.0000", physical: "21.0000", incoming: "60.0000" },
        { sku: "P2C", description: "PAGE TWO C", stk: "22.0000", avail: "17.0000", pick: "0.0000", physical: "22.0000", incoming: "0.0000" },
      ],
    );
    const parsed = parsedOrThrow(text);
    expect(parsed.rows.some((r) => r.sku === "Branch")).toBe(false);
    expect(parsed.rows.some((r) => r.sku.toUpperCase() === "PAGE")).toBe(false);
    expect(parsed.rows.find((r) => r.sku === "P1A")?.incoming).toMatchObject({ ok: true, value: 12 });
    expect(parsed.rows.find((r) => r.sku === "P2A")?.incoming).toMatchObject({ ok: true, value: 240 });
    expect(parsed.rows.find((r) => r.sku === "P2A")?.avail).toMatchObject({ ok: true, value: 18 });
    expect(parsed.rows.find((r) => r.sku === "P2C")?.incoming).toMatchObject({ ok: true, value: 0 });
  });

  it("parses the genuine 05 Oct 2026 excerpt: P/Ord Qty equals incoming, not Ryr", () => {
    const parsed = parsedOrThrow(REAL_231PO3NEW_PORD_EXCERPT);
    expect(parsed.incomingHeader).toBe("P/Ord Qty");
    expect(parsed.rows.some((r) => r.sku === "Branch")).toBe(false);
    for (const expected of REAL_231PO3NEW_PORD_EXPECTATIONS) {
      const row = parsed.rows.find((r) => r.sku === expected.sku);
      expect(row, expected.sku).toBeTruthy();
      expect(row?.avail).toMatchObject({ ok: true, value: expected.avail });
      expect(row?.usage?.physicalStk).toBe(expected.physical);
      expect(row?.incoming).toMatchObject({ ok: true, value: expected.pOrdQty });
      expect(row?.latestCost?.ok).toBe(true);
      if (row?.latestCost?.ok) {
        expect(Number(row.latestCost.value)).toBeCloseTo(Number(expected.latestCost), 4);
      }
    }
    const both = parsed.rows.find((r) => r.sku === "140087");
    expect(both?.avail).toMatchObject({ ok: true, value: 9 });
    expect(both?.incoming).toMatchObject({ ok: true, value: 15 });
    const ryr = Number(both?.usage?.ryr ?? "0");
    expect(ryr).not.toBe(15);
    expect(ryr).toBeGreaterThan(0);
  });

  it("does not add Incoming into customer stock bands", () => {
    expect(publicAvailabilityFromQty(8)).toBe("low");
    expect(publicAvailabilityFromQty(8 + 240)).toBe("in");
  });

  it("still deducts corrected Incoming from suggested purchase and incoming-covers", () => {
    const purchase = suggestedPurchaseQty({
      availableQty: 100,
      incomingQty: 240,
      recommendedWeekly: 50,
      targetCoverWeeks: 10,
      safetyStockQty: 0,
      minimumOrderQty: null,
      orderMultiple: null,
    });
    expect(purchase.suggestedQty).toBe(160);
    const status = resolvePurchasingStatus({
      availableQty: 100,
      incomingQty: 240,
      weeksCover: 0.5,
      suggestedQty: 0,
      reorderPoint: 220,
      settings: DEFAULT_PURCHASING_SETTINGS,
      recommendedWeekly: 40,
      stockStale: false,
      estimatedStockoutDate: "2026-10-06",
      today: "2026-10-05",
    });
    expect(status.status).toBe("INCOMING_COVERS_REQUIREMENT");
  });
});

describe("Incoming cell parsing", () => {
  it("parses positive, zero and blank without inventing zero from malformed", () => {
    expect(parseIncomingCell("240")).toEqual({ ok: true, value: 240, raw: "240" });
    expect(parseIncomingCell("240.0000")).toEqual({ ok: true, value: 240, raw: "240.0000" });
    expect(parseIncomingCell("0")).toEqual({ ok: true, value: 0, raw: "0" });
    expect(parseIncomingCell("")).toMatchObject({ ok: false, reason: "blank" });
    expect(parseIncomingCell("n/a")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseIncomingCell("-4")).toMatchObject({ ok: false, reason: "negative" });
  });
});
