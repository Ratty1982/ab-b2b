import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAutopart561l, parseInvAndLn } from "@/domain/autopart-561l";

const fixtureDir = resolve(import.meta.dirname, "fixtures");
const sampleCsv = readFileSync(resolve(fixtureDir, "autopart-561l-sample.csv"), "utf8");
const sampleTxt = readFileSync(resolve(fixtureDir, "autopart-561l-sample.txt"), "utf8");
const negativesCsv = readFileSync(resolve(fixtureDir, "autopart-561l-negatives.csv"), "utf8");

describe("parseInvAndLn", () => {
  it("normalises invoice and credit identities", () => {
    expect(parseInvAndLn("I/SS306008/1")).toMatchObject({
      documentType: "INVOICE",
      documentReference: "SS306008",
      sourceLineNumber: 1,
      ok: true,
    });
    expect(parseInvAndLn("C/SS100900/2")).toMatchObject({
      documentType: "CREDIT",
      documentReference: "SS100900",
      sourceLineNumber: 2,
      ok: true,
    });
    expect(parseInvAndLn("I/BADLINE").ok).toBe(false);
    expect(parseInvAndLn("").ok).toBe(false);
  });
});

describe("parseAutopart561l", () => {
  it("parses invoice/credit lines and skips malformed identities", () => {
    const result = parseAutopart561l(sampleCsv);
    expect(result.headerFound).toBe(true);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.invoiceLines).toBe(3);
    expect(result.creditLines).toBe(1);
    expect(result.malformedRows).toBeGreaterThanOrEqual(1);

    const first = result.lines.find(
      (l) => l.documentReference === "SS306008" && l.sourceLineNumber === 1,
    );
    expect(first).toMatchObject({
      partNumber: "SS",
      units: 24,
      salesNet: "622.80",
      documentType: "INVOICE",
    });

    const credit = result.lines.find((l) => l.documentType === "CREDIT");
    expect(credit?.units).toBe(-2);
    expect(credit?.salesNet).toBe("-51.90");
  });

  it("parses equivalent .txt report text without relying on extension", () => {
    const result = parseAutopart561l(sampleTxt);
    expect(result.headerFound).toBe(true);
    expect(result.layout).toBe("NATIVE_FIXED");
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.invoiceLines).toBe(3);
    expect(result.creditLines).toBe(4);
    expect(result.accountFieldWidth).toBe(7);
    expect(result.lines.some((l) => l.documentReference === "SS306009")).toBe(true);
  });

  it("never treats negative units/sales as account codes", () => {
    const result = parseAutopart561l(negativesCsv);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.detectedAccounts).not.toContain("-1");
    expect(result.detectedAccounts).not.toContain("-104.38");
    expect(result.detectedAccounts).not.toContain("-119.95");
    expect(result.detectedAccounts).not.toContain("-16.38");
    expect(result.lines.some((l) => l.salesNet === "-104.38")).toBe(true);
    expect(result.lines.some((l) => l.units === -1)).toBe(true);
  });

  it("txt and csv negatives produce the same account set", () => {
    const fromTxt = parseAutopart561l(sampleTxt);
    const fromCsv = parseAutopart561l(negativesCsv);
    expect(fromTxt.detectedAccounts).toEqual(["YORKMOT"]);
    expect(fromCsv.detectedAccounts).toEqual(["YORKMOT"]);
  });

  it("tolerates blank rows, CRLF, and quoted CSV", () => {
    const crlf = sampleCsv.replace(/\n/g, "\r\n") + "\r\n\r\n";
    const result = parseAutopart561l(crlf);
    expect(result.lines.length).toBeGreaterThanOrEqual(4);
    expect(result.blankRows).toBeGreaterThan(0);
  });

  it("does not invent fields for negative-only edge rows", () => {
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
YORKMOT,I/SS1/1,SKU,Item,-3,"-£12.00"
`;
    const result = parseAutopart561l(text);
    expect(result.lines[0]).toMatchObject({ units: -3, salesNet: "-12.00" });
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
  });
});
