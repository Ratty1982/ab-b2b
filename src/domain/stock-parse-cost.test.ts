import { describe, expect, it } from "vitest";
import { parseLatestCostCell } from "@/domain/stock-parse-cost";
import { parseAutopart231Po3New } from "@/domain/stock-parse";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import { londonBusinessDate, londonCivilTime } from "@/domain/stock-schedule";

describe("parseLatestCostCell", () => {
  it("parses decimal costs at 4dp without float drift", () => {
    expect(parseLatestCostCell("2.5")).toEqual({ ok: true, value: "2.5000", raw: "2.5" });
    expect(parseLatestCostCell("2.60")).toEqual({ ok: true, value: "2.6000", raw: "2.60" });
    expect(parseLatestCostCell("0.00")).toEqual({ ok: true, value: "0.0000", raw: "0.00" });
    expect(parseLatestCostCell("£1.2345")).toEqual({
      ok: true,
      value: "1.2345",
      raw: "£1.2345",
    });
  });

  it("rejects missing, invalid and negative costs", () => {
    expect(parseLatestCostCell("")).toMatchObject({ ok: false, reason: "missing" });
    expect(parseLatestCostCell("   ")).toMatchObject({ ok: false, reason: "missing" });
    expect(parseLatestCostCell("n/a")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseLatestCostCell("xx.yy")).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseLatestCostCell("-1.00")).toMatchObject({ ok: false, reason: "negative" });
  });
});

describe("native 231PO3NEW Latest Cost extraction", () => {
  it("exposes Latest Cost alongside Avail and stock columns", () => {
    const text = buildNative231Po3New([
      {
        sku: "GC5000",
        description: "GLASS CLEANER 5L",
        stk: "93.0000",
        avail: "36.0000",
        pick: "0.0000",
        physical: "93.0000",
        cost: "2.50",
      },
    ]);
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    const row = parsed.rows.find((r) => r.sku === "GC5000");
    expect(row?.avail).toMatchObject({ ok: true, value: 36 });
    expect(row?.latestCost).toEqual({ ok: true, value: "2.5000", raw: "2.50" });
    expect(row?.usage?.stk).toBe("93.0000");
    expect(row?.usage?.pickQty).toBe("0.0000");
    expect(row?.usage?.physicalStk).toBe("93.0000");
  });

  it("keeps Avail authority when Latest Cost cell is malformed", () => {
    // Layout detection needs several clean numeric samples; only BADCOST is corrupted.
    const text = buildNative231Po3New([
      {
        sku: "OK1",
        description: "OK ONE",
        stk: "10.0000",
        avail: "8.0000",
        pick: "0.0000",
        physical: "10.0000",
        cost: "1.41",
      },
      {
        sku: "OK2",
        description: "OK TWO",
        stk: "11.0000",
        avail: "9.0000",
        pick: "0.0000",
        physical: "11.0000",
        cost: "1.42",
      },
      {
        sku: "OK3",
        description: "OK THREE",
        stk: "12.0000",
        avail: "10.0000",
        pick: "0.0000",
        physical: "12.0000",
        cost: "1.43",
      },
      {
        sku: "BADCOST",
        description: "BAD COST ITEM",
        stk: "10.0000",
        avail: "7.0000",
        pick: "0.0000",
        physical: "10.0000",
        cost: "9.99",
      },
    ]);
    // Corrupt only the BADCOST Latest Cost token (same width) so Avail columns stay aligned.
    const patched = text.replace(
      /(BAD COST ITEM\s+)9\.99/,
      "$1xxxx",
    );
    const parsed = parseAutopart231Po3New(patched);
    if ("code" in parsed) throw new Error(parsed.message);
    const row = parsed.rows.find((r) => r.sku === "BADCOST");
    expect(row?.avail).toMatchObject({ ok: true, value: 7 });
    expect(row?.latestCost).toMatchObject({ ok: false, reason: "invalid" });
    expect(parsed.rows.find((r) => r.sku === "OK1")?.latestCost).toMatchObject({ ok: true });
  });

  it("preserves genuine zero Latest Cost as a valid source value", () => {
    const text = buildNative231Po3New([
      {
        sku: "ZEROCOST",
        description: "ZERO COST",
        stk: "1.0000",
        avail: "1.0000",
        pick: "0.0000",
        physical: "1.0000",
        cost: "0.00",
      },
    ]);
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows[0]?.latestCost).toEqual({ ok: true, value: "0.0000", raw: "0.00" });
  });
});

describe("Europe/London business date for cost snapshots", () => {
  it("labels civil London date without timezone-shifting the YYYY-MM-DD", () => {
    // 2026-09-29 23:30 UTC = 2026-09-30 00:30 BST → London business date 30/09/2026
    const lateUtc = new Date("2026-09-29T23:30:00.000Z");
    expect(londonBusinessDate(londonCivilTime(lateUtc))).toBe("2026-09-30");

    // 2026-09-29 08:00 UTC = 2026-09-29 09:00 BST → still 29/09/2026
    const morning = new Date("2026-09-29T08:00:00.000Z");
    expect(londonBusinessDate(londonCivilTime(morning))).toBe("2026-09-29");
  });
});
