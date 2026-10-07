import { describe, expect, it } from "vitest";
import { parseAutopart231Po3New } from "@/domain/stock-parse";
import {
  buildNative231Po3New,
  type Native231Po3NewRow,
} from "@/server/stock/fixtures/native-231po3new";
import { REAL_231PO3NEW_PORD_EXCERPT } from "@/server/stock/fixtures/real-231po3new-pord-excerpt";

function parsedOrThrow(text: string) {
  const parsed = parseAutopart231Po3New(text);
  if ("code" in parsed) throw new Error(parsed.message);
  return parsed;
}

const base: Native231Po3NewRow = {
  sku: "GC5000",
  description: "GLASS CLEANER 5L",
  stk: "93.0000",
  avail: "36.0000",
  pick: "0.0000",
  physical: "93.0000",
  cost: "1.41",
  incoming: "240.0000",
  ryr: "111",
  curr: "9",
  mth1: "14",
};

function rowFor(condition?: string): Native231Po3NewRow {
  return condition == null ? { ...base } : { ...base, condition };
}

describe("231PO3NEW C column condition", () => {
  it("parses a blank C column as no condition without shifting Description, cost, Avail, or P/Ord Qty", () => {
    const blank = parsedOrThrow(buildNative231Po3New([rowFor()]));
    const marked = parsedOrThrow(buildNative231Po3New([rowFor("O")]));
    const blankLine = buildNative231Po3New([rowFor()]).split("\n").at(-1)!;
    const markedLine = buildNative231Po3New([rowFor("O")]).split("\n").at(-1)!;
    expect(blankLine.length).toBe(markedLine.length);
    expect([...blankLine].filter((ch, i) => ch !== markedLine[i])).toEqual([" "]);

    const row = blank.rows[0]!;
    expect(row.conditionAuthoritative).toBe(true);
    expect(row.conditionCode).toBeNull();
    expect(row.description).toBe("GLASS CLEANER 5L");
    expect(row.latestCost?.ok && Number(row.latestCost.value)).toBeCloseTo(1.41, 2);
    expect(row.avail).toMatchObject({ ok: true, value: 36 });
    expect(row.incoming).toMatchObject({ ok: true, value: 240 });
    expect(row.usage?.physicalStk).toBe("93.0000");

    const obsolete = marked.rows[0]!;
    expect(obsolete.conditionCode).toBe("O");
    expect(obsolete.description).toBe(row.description);
    expect(obsolete.latestCost).toEqual(row.latestCost);
    expect(obsolete.avail).toEqual(row.avail);
    expect(obsolete.incoming).toEqual(row.incoming);
  });

  it.each(["S", "N", "O", "W", "D", "M"] as const)("parses %s from the C column", (code) => {
    const parsed = parsedOrThrow(buildNative231Po3New([rowFor(code)]));
    expect(parsed.rows[0]?.conditionCode).toBe(code);
    expect(parsed.rows[0]?.description).toBe("GLASS CLEANER 5L");
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 36 });
    expect(parsed.rows[0]?.incoming).toMatchObject({ ok: true, value: 240 });
    expect(parsed.rows[0]?.latestCost).toMatchObject({ ok: true });
  });

  it("does not infer a condition from the description", () => {
    const parsed = parsedOrThrow(
      buildNative231Po3New([
        {
          ...base,
          sku: "SUP123",
          description: "SUPERSEDED BLADE",
        },
      ]),
    );
    expect(parsed.rows[0]?.description).toBe("SUPERSEDED BLADE");
    expect(parsed.rows[0]?.conditionCode).toBeNull();
  });

  it("keeps a genuine 05 Oct 2026 excerpt blank and does not move Avail or P/Ord Qty when C is set", () => {
    const parsed = parsedOrThrow(REAL_231PO3NEW_PORD_EXCERPT);
    const awc = parsed.rows.find((row) => row.sku === "AWC5000");
    expect(awc?.conditionCode).toBeNull();
    expect(awc?.description).toContain("5 Litre");
    expect(awc?.avail).toMatchObject({ ok: true, value: 2 });
    expect(awc?.incoming).toMatchObject({ ok: true, value: 0 });
    expect(awc?.latestCost).toMatchObject({ ok: true });

    const lines = REAL_231PO3NEW_PORD_EXCERPT.split("\n");
    const header = lines.find((line) => /Part\s*Number/i.test(line) && /\bAvail\b/.test(line))!;
    const partStart = header.indexOf("Part Number");
    const descStart = header.indexOf("Description");
    const between = header.slice(partStart, descStart);
    const cMatch = /\sC\s/.exec(between)!;
    const column = partStart + cMatch.index + cMatch[0].indexOf("C");
    const dataIndex = lines.findIndex((line) => line.includes("AWC5000"));
    const original = lines[dataIndex]!;
    expect(original.charAt(column)).toBe(" ");
    const chars = original.split("");
    chars[column] = "O";
    lines[dataIndex] = chars.join("");
    const spliced = parsedOrThrow(lines.join("\n"));
    const updated = spliced.rows.find((row) => row.sku === "AWC5000");
    expect(updated?.conditionCode).toBe("O");
    expect(updated?.description).toBe(awc?.description);
    expect(updated?.avail).toEqual(awc?.avail);
    expect(updated?.incoming).toEqual(awc?.incoming);
    expect(updated?.latestCost).toEqual(awc?.latestCost);
    const untouched = spliced.rows.find((row) => row.sku === "140087");
    expect(untouched?.conditionCode).toBeNull();
    expect(untouched?.incoming).toMatchObject({ ok: true, value: 15 });
    expect(untouched?.avail).toMatchObject({ ok: true, value: 9 });
  });

  it("does not invent a condition when the header has no C column", () => {
    const text = buildNative231Po3New([rowFor("S")]);
    const lines = text.split("\n");
    const headerIndex = lines.findIndex((line) => line.includes("Part Number"));
    lines[headerIndex] = lines[headerIndex]!.replace(" C ", "   ");
    const parsed = parsedOrThrow(lines.join("\n"));
    expect(parsed.rows[0]?.conditionAuthoritative).toBe(false);
    expect(parsed.rows[0]?.conditionCode).toBeNull();
    expect(parsed.rows[0]?.description).toBe("GLASS CLEANER 5L");
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 36 });
    expect(parsed.rows[0]?.incoming).toMatchObject({ ok: true, value: 240 });
  });
});
