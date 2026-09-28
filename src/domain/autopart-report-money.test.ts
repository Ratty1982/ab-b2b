import { describe, expect, it } from "vitest";
import {
  autopartAccountsEqual,
  availableCreditFromExposure,
  parseAutopartDateOnly,
  parseAutopartMoney,
  splitCsvLine,
} from "@/domain/autopart-report-money";
import { moneyToString, parseMoney } from "@/domain/money";

describe("parseAutopartMoney", () => {
  it("parses currency decoration and commas", () => {
    expect(moneyToString(parseAutopartMoney("£3,494.75")!, 2)).toBe("3494.75");
    expect(moneyToString(parseAutopartMoney("(51.90)")!, 2)).toBe("-51.90");
    expect(moneyToString(parseAutopartMoney("10.00CR")!, 2)).toBe("-10.00");
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

describe("availableCreditFromExposure", () => {
  it("matches £5,000 − £3,494.75 = £1,505.25", () => {
    const r = availableCreditFromExposure({
      creditLimit: parseMoney("5000.00")!,
      totalExposure: parseMoney("3494.75")!,
    });
    expect(moneyToString(r.availableCreditRaw, 2)).toBe("1505.25");
    expect(r.availableCreditDisplay).toBe("1505.25");
    expect(r.overLimitBy).toBeNull();
  });

  it("preserves over-limit raw negative", () => {
    const r = availableCreditFromExposure({
      creditLimit: parseMoney("5000.00")!,
      totalExposure: parseMoney("5400.00")!,
    });
    expect(moneyToString(r.availableCreditRaw, 2)).toBe("-400.00");
    expect(r.availableCreditDisplay).toBe("0.00");
    expect(moneyToString(r.overLimitBy!, 2)).toBe("400.00");
  });
});

describe("splitCsvLine", () => {
  it("respects quotes and CRLF-safe cells", () => {
    expect(splitCsvLine('A,"£1,234.56",B')).toEqual(["A", "£1,234.56", "B"]);
  });
});
