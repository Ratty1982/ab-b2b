import { describe, expect, it } from "vitest";
import {
  autopartAccountsEqual,
  parseAutopartDateOnly,
  parseAutopartMoney,
  parseAutopartQuantity,
  splitCsvLine,
} from "@/domain/autopart-report-money";
import { moneyToString } from "@/domain/money";

describe("parseAutopartMoney", () => {
  it("parses currency decoration and commas", () => {
    expect(moneyToString(parseAutopartMoney("£3,494.75")!, 2)).toBe("3494.75");
    expect(moneyToString(parseAutopartMoney("(51.90)")!, 2)).toBe("-51.90");
    expect(moneyToString(parseAutopartMoney("10.00CR")!, 2)).toBe("-10.00");
    expect(moneyToString(parseAutopartMoney("\u221231.24")!, 2)).toBe("-31.24");
  });
});

describe("parseAutopartQuantity", () => {
  it("parses Autopart credit unit forms and rejects blank cells", () => {
    expect(parseAutopartQuantity("(1)")).toBe(-1);
    expect(parseAutopartQuantity("1CR")).toBe(-1);
    expect(parseAutopartQuantity("-1")).toBe(-1);
    expect(parseAutopartQuantity("")).toBeNull();
  });
});

describe("parseAutopartDateOnly", () => {
  it("parses DD Mon YY without timezone shift", () => {
    expect(parseAutopartDateOnly("06 Oct 14")).toBe("2014-10-06");
    expect(parseAutopartDateOnly("08 Oct 14")).toBe("2014-10-08");
    expect(parseAutopartDateOnly("2014-10-06")).toBe("2014-10-06");
    expect(parseAutopartDateOnly("06/10/2014")).toBe("2014-10-06");
    expect(parseAutopartDateOnly("not-a-date")).toBeNull();
  });
});

describe("autopartAccountsEqual", () => {
  it("is case-insensitive exact and never prefix-fuzzy", () => {
    expect(autopartAccountsEqual("YORKMOT", "yorkmot")).toBe(true);
    expect(autopartAccountsEqual("YORKMOT", "YORKMOTO")).toBe(false);
    expect(autopartAccountsEqual("YORKMOT", "YORK")).toBe(false);
  });
});

describe("splitCsvLine", () => {
  it("respects quotes and CRLF-safe cells", () => {
    expect(splitCsvLine('A,"£1,234.56",B')).toEqual(["A", "£1,234.56", "B"]);
  });

  it("keeps Autopart unescaped inch marks inside quoted descriptions", () => {
    expect(
      splitCsvLine(
        `"RETAIL","C/SC501695/1","SWUX68","14" Lightning White Glos","-1","-16.66"`,
      ),
    ).toEqual([
      "RETAIL",
      "C/SC501695/1",
      "SWUX68",
      '14" Lightning White Glos',
      "-1",
      "-16.66",
    ]);
    expect(
      splitCsvLine(`"RETAIL","C/SC503053/1","COVERXL","CAR COVER "XL" 530x175x1","-1","0.00"`),
    ).toEqual([
      "RETAIL",
      "C/SC503053/1",
      "COVERXL",
      'CAR COVER "XL" 530x175x1',
      "-1",
      "0.00",
    ]);
    expect(
      splitCsvLine(`"RETAIL","C/SC503115/1","GTXCARBON16","GTX Carbon 16"","-1","0.00"`),
    ).toEqual([
      "RETAIL",
      "C/SC503115/1",
      "GTXCARBON16",
      'GTX Carbon 16"',
      "-1",
      "0.00",
    ]);
    expect(splitCsvLine('A,"foo ""bar"" baz",B')).toEqual(["A", 'foo "bar" baz', "B"]);
  });
});
