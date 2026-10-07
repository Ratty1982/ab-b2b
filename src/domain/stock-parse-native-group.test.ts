import { describe, expect, it } from "vitest";
import { parseNative231Po3New } from "@/domain/stock-parse-native";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";

describe("231PO3NEW Group column", () => {
  it("reads Group and ignores Sub Grp, the later GROUP field, SKU, and description", () => {
    const parsed = parseNative231Po3New(
      buildNative231Po3New([
        {
          sku: "SX-WIDGET-1",
          description: "Saxon brake shoe",
          group: "ST",
          subGrp: "ZZ",
          trailerGroup: "YY",
          stk: "5.0000",
          avail: "4.0000",
          pick: "0.0000",
          physical: "5.0000",
          cost: "3.25",
          incoming: "8.0000",
          condition: "O",
        },
      ]),
    );
    if ("code" in parsed) throw new Error(parsed.message);
    const row = parsed.rows[0];
    expect(row?.groupCode).toBe("ST");
    expect(row?.sku).toBe("SX-WIDGET-1");
    expect(row?.description).toContain("Saxon");
    expect(row?.groupCode).not.toBe("ZZ");
    expect(row?.groupCode).not.toBe("YY");
    expect(row?.groupCode).not.toBe("SX");
    expect(row?.avail).toMatchObject({ ok: true, value: 4 });
    expect(row?.incoming).toMatchObject({ ok: true, value: 8 });
    expect(row?.latestCost?.ok && Number(row.latestCost.value)).toBeCloseTo(3.25, 4);
    expect(row?.conditionCode).toBe("O");
  });

  it("stores a blank Group as null and does not invent one from the SKU prefix", () => {
    const parsed = parseNative231Po3New(
      buildNative231Po3New([
        {
          sku: "SXONLY",
          description: "No group",
          group: " ",
          stk: "1.0000",
          avail: "1.0000",
          pick: "0.0000",
          physical: "1.0000",
        },
      ]),
    );
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows[0]?.groupAuthoritative).toBe(true);
    expect(parsed.rows[0]?.groupCode).toBeNull();
  });
});
