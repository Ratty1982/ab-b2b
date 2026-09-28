import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapSlrbDocumentType, parseAutopartSlrb } from "@/domain/autopart-slrb";

const sample = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-slrb-sample.csv"),
  "utf8",
);

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
    const result = parseAutopartSlrb(sample);
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
});
