import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapSlrbDocumentType, parseAutopartSlrb } from "@/domain/autopart-slrb";

const fixtureDir = resolve(import.meta.dirname, "fixtures");
const sampleCsv = readFileSync(resolve(fixtureDir, "autopart-slrb-sample.csv"), "utf8");
const sampleTxt = readFileSync(resolve(fixtureDir, "autopart-slrb-sample.txt"), "utf8");
const negativesCsv = readFileSync(resolve(fixtureDir, "autopart-slrb-negatives.csv"), "utf8");

describe("mapSlrbDocumentType", () => {
  it("maps known types only", () => {
    expect(mapSlrbDocumentType("INV")).toBe("INVOICE");
    expect(mapSlrbDocumentType("CRN")).toBe("CREDIT");
    expect(mapSlrbDocumentType("PAY")).toBe("PAYMENT");
    expect(mapSlrbDocumentType("XYZ")).toBe("UNKNOWN");
  });
});

describe("parseAutopartSlrb", () => {
  it("parses invoices, credits, payments and dates", () => {
    const result = parseAutopartSlrb(sampleCsv);
    expect(result.headerFound).toBe(true);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.invoiceDocuments).toBe(3);
    expect(result.creditDocuments).toBe(1);
    expect(result.ledgerRecords).toBe(1);

    const doc = result.documents.find((d) => d.documentReference === "SS306008");
    expect(doc).toMatchObject({
      documentType: "INVOICE",
      documentDate: "2014-10-06",
      goodsNet: "683.28",
      vat: "136.66",
      grossTotal: "819.94",
    });
  });

  it("parses equivalent .txt report text", () => {
    const result = parseAutopartSlrb(sampleTxt);
    expect(result.headerFound).toBe(true);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.invoiceDocuments).toBeGreaterThanOrEqual(3);
    expect(result.creditDocuments).toBeGreaterThanOrEqual(1);
    expect(result.accountFieldWidth).toBe(7);
  });

  it("never treats run-balance / totals as account codes", () => {
    const result = parseAutopartSlrb(negativesCsv);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    for (const bad of ["-1", "-104.38", "-119.95", "-16.38", "819.94", "0.00"]) {
      expect(result.detectedAccounts).not.toContain(bad);
    }
    expect(result.documents.some((d) => d.grossTotal === "-125.26")).toBe(true);
  });
});
