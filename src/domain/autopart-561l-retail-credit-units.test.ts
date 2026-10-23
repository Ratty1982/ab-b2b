import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartMoney, parseAutopartQuantity } from "@/domain/autopart-report-money";
import { moneyToString } from "@/domain/money";

const fixture = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-561l-retail-credit-units.csv"),
  "utf8",
);

describe("parseAutopartQuantity", () => {
  it("accepts Autopart credit unit forms without inventing blank values", () => {
    expect(parseAutopartQuantity("-1")).toBe(-1);
    expect(parseAutopartQuantity("(1)")).toBe(-1);
    expect(parseAutopartQuantity("1CR")).toBe(-1);
    expect(parseAutopartQuantity("2DR")).toBe(2);
    expect(parseAutopartQuantity("\u22121")).toBe(-1);
    expect(parseAutopartQuantity("1,234")).toBe(1234);
    expect(parseAutopartQuantity("")).toBeNull();
    expect(parseAutopartQuantity("   ")).toBeNull();
    expect(parseAutopartQuantity("abc")).toBeNull();
    expect(parseAutopartMoney("\u221231.24")).not.toBeNull();
    expect(moneyToString(parseAutopartMoney("\u221231.24")!, 2)).toBe("-31.24");
  });
});

describe("Retail Amazon-style 561L credit Units", () => {
  it("imports representative credit rows and keeps blank units rejected with the original value", () => {
    const result = parseAutopart561l(fixture);
    expect(result.layout).toBe("CSV");
    expect(result.malformedRows).toBe(1);
    expect(result.lines).toHaveLength(4);

    const invoice = result.lines.find((row) => row.documentReference === "SS303694");
    expect(invoice).toMatchObject({
      documentType: "INVOICE",
      units: 2,
      salesNet: "62.48",
      classification: "LINE",
    });

    const paren = result.lines.find((row) => row.documentReference === "SC501695");
    expect(paren).toMatchObject({
      documentType: "CREDIT",
      partNumber: "SSAMZ",
      units: -1,
      salesNet: "-31.24",
      classification: "LINE",
      issue: null,
    });

    const crSuffix = result.lines.find((row) => row.documentReference === "SC501698");
    expect(crSuffix).toMatchObject({
      documentType: "CREDIT",
      partNumber: "SSAMZ-1",
      units: -1,
      salesNet: "-37.49",
      classification: "LINE",
    });

    const unicodeMinus = result.lines.find((row) => row.documentReference === "SC503053");
    expect(unicodeMinus).toMatchObject({
      documentType: "CREDIT",
      units: -1,
      salesNet: "-12.00",
      classification: "LINE",
    });

    const blank = result.rows.find((row) => row.documentReference === "SC503099");
    expect(blank).toMatchObject({
      documentType: "CREDIT",
      classification: "MALFORMED",
      units: null,
      salesNet: "-5.00",
      issue: "Invalid units: (blank)",
    });
  });

  it("keeps existing ASCII negative units working and never invents quantities", () => {
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
RETAILA,C/SC500093/1,27113,Red Threadlocker,-1,-8.98
RETAILA,C/SC509999/1,27113,Missing qty,,-8.98
`;
    const result = parseAutopart561l(text);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ units: -1, salesNet: "-8.98", documentType: "CREDIT" });
    expect(result.rows.find((row) => row.documentReference === "SC509999")?.issue).toBe(
      "Invalid units: (blank)",
    );
  });
});
