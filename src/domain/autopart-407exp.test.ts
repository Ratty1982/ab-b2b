import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXP407_NAME_END,
  EXP407_NAME_START,
  classifyAutopartAccount,
  parse407Exp,
  preserveAccountCode,
} from "@/domain/autopart-407exp";

const fixture = readFileSync(
  new URL("./fixtures/autopart-407exp-sample.txt", import.meta.url),
  "utf8",
);

describe("407EXP fixed-width customer list", () => {
  it("keeps leading zeroes and punctuation in the account field", () => {
    expect(preserveAccountCode("00012     ")).toBe("00012");
    expect(preserveAccountCode("A&B       ")).toBe("A&B");
    const parsed = parse407Exp(fixture);
    expect(parsed.rows.map((row) => row.accountCode)).toContain("00012");
    expect(parsed.rows.map((row) => row.accountCode)).toContain("A&B");
  });

  it("skips page banners and repeated headings", () => {
    const parsed = parse407Exp(fixture);
    expect(parsed.summary.pageBanners).toBeGreaterThan(0);
    expect(parsed.summary.repeatedHeaders).toBe(2);
    expect(parsed.rows.some((row) => row.accountCode === "Account")).toBe(false);
    expect(parsed.rows.some((row) => row.originalName.includes("AUTOPART"))).toBe(false);
  });

  it("flags a full name field as truncated and keeps blank area or rep", () => {
    const parsed = parse407Exp(fixture);
    const truncated = parsed.rows.find((row) => row.accountCode === "LONGNAME01");
    expect(truncated?.nameTruncated).toBe(true);
    expect(truncated?.originalName).toHaveLength(EXP407_NAME_END - EXP407_NAME_START);
    const blankArea = parsed.rows.find((row) => row.accountCode === "BLANKAREA");
    expect(blankArea?.areaCode).toBeNull();
    expect(blankArea?.repCode).toBe("9");
    const cash = parsed.rows.find((row) => row.accountCode === "CASH");
    expect(cash?.areaCode).toBeNull();
    expect(cash?.repCode).toBeNull();
  });

  it("classifies special accounts and does not treat them as approved trade customers", () => {
    const parsed = parse407Exp(fixture);
    const byCode = Object.fromEntries(
      parsed.rows.map((row) => [row.accountCode, row.classification]),
    );
    expect(byCode["CASH"]).toBe("CASH");
    expect(byCode["CASHSALE"]).toBe("CASH");
    expect(byCode["DONOTUSE1"]).toBe("DO_NOT_USE");
    expect(byCode["STAFF01"]).toBe("STAFF");
    expect(byCode["ABDEMO"]).toBe("INTERNAL");
    expect(byCode["00012"]).toBe("TRADE_CANDIDATE");
    expect(classifyAutopartAccount("FBA1", "Amazon FBA stock")).toEqual({
      classification: "INTERNAL",
      note: "Internal, Amazon, or FBA account",
    });
  });

  it("keeps the first copy of a repeated account and records the duplicate", () => {
    const parsed = parse407Exp(fixture);
    const repeats = parsed.rows.filter((row) => row.accountCode === "REPEAT1");
    expect(repeats).toHaveLength(1);
    expect(repeats[0]?.originalName).toBe("First Appearance");
    expect(parsed.summary.duplicateAccounts).toBe(1);
    expect(parsed.issues.some((issue) => issue.issueType === "DUPLICATE_ACCOUNT")).toBe(true);
    expect(parsed.summary.distinctAccounts).toBe(parsed.rows.length);
  });
});
