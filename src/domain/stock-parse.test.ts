import { describe, expect, it } from "vitest";
import { classifyStockRows, parseAutopart231Po3New, parseAvailCell } from "@/domain/stock-parse";

const HEADER = "SKU,Description,Avail";

describe("231PO3NEW parser", () => {
  it("reads SKU and Avail with quoted fields", () => {
    const parsed = parseAutopart231Po3New(`${HEADER}\n"GC5000","Cleaner, 5L",36`);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows[0]?.sku).toBe("GC5000");
    expect(parsed.rows[0]?.avail).toEqual({ ok: true, value: 36, raw: "36" });
  });

  it("fails when Avail header is missing", () => {
    const parsed = parseAutopart231Po3New("SKU,Description\nGC5000,x");
    expect("code" in parsed && parsed.code).toBe("MISSING_AVAIL_HEADER");
  });

  it("fails when SKU header is missing", () => {
    const parsed = parseAutopart231Po3New("Name,Avail\nThing,1");
    expect("code" in parsed && parsed.code).toBe("MISSING_SKU_HEADER");
  });

  it("trims SKU whitespace without rewriting the identifier", () => {
    const parsed = parseAutopart231Po3New(`${HEADER}\n  GC5000  ,Glass,8`);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows[0]?.sku).toBe("GC5000");
  });
});

describe("Avail parsing", () => {
  it("accepts integers including zero and negatives", () => {
    expect(parseAvailCell("100")).toMatchObject({ ok: true, value: 100 });
    expect(parseAvailCell("0")).toMatchObject({ ok: true, value: 0 });
    expect(parseAvailCell("-3")).toMatchObject({ ok: true, value: -3 });
    expect(parseAvailCell("21.0")).toMatchObject({ ok: true, value: 21 });
  });

  it("rejects blank and non-numeric Avail", () => {
    expect(parseAvailCell("")).toMatchObject({ ok: false });
    expect(parseAvailCell("n/a")).toMatchObject({ ok: false });
    expect(parseAvailCell("1.5")).toMatchObject({ ok: false });
  });
});

describe("duplicate SKU policy", () => {
  it("flags every duplicate instance and does not last-wins", () => {
    const parsed = parseAutopart231Po3New(`${HEADER}\nAA,a,10\nAA,b,99\nBB,c,1`);
    if ("code" in parsed) throw new Error(parsed.message);
    const classified = classifyStockRows(parsed.rows);
    const aa = classified.filter((row) => row.row.sku === "AA");
    expect(aa.every((row) => row.kind === "duplicate")).toBe(true);
    expect(classified.find((row) => row.row.sku === "BB")?.kind).toBe("valid");
  });

  it("classifies blank Avail and missing SKU without inventing stock", () => {
    const parsed = parseAutopart231Po3New(`${HEADER}\n,blank sku,1\nOK,ok,5\nBAD,bad,`);
    if ("code" in parsed) throw new Error(parsed.message);
    const classified = classifyStockRows(parsed.rows);
    expect(classified[0]?.kind).toBe("missing_sku");
    expect(classified[1]?.kind).toBe("valid");
    expect(classified[2]?.kind).toBe("invalid");
  });
});
