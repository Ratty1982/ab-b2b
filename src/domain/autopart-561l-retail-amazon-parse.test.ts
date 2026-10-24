import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAutopart561l } from "@/domain/autopart-561l";
import {
  EXACT_REPEATED_SOURCE_ROW_REASON,
  historicalProductLineIdentity,
  historicalProductLineLookupFingerprints,
} from "@/domain/customer-sales-history";

const fixture = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-561l-retail-amazon-quotes.csv"),
  "utf8",
);
const exactRepeatFixture = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-561l-exact-repeated-credits.csv"),
  "utf8",
);

const uploadedRetail561l = "/home/ubuntu/.cursor/projects/workspace/uploads/561L-RETAIL_9e6e.CSV";

describe("Retail Amazon 561L CSV quoting and line identity", () => {
  it("parses unescaped inch marks and keeps all SC503053 /1 SKUs distinct", () => {
    const result = parseAutopart561l(fixture);
    expect(result.layout).toBe("CSV");
    expect(result.malformedRows).toBe(0);
    expect(result.lines).toHaveLength(19);

    const lightning = result.lines.find((row) => row.partNumber === "SWUX68");
    expect(lightning).toMatchObject({
      documentType: "CREDIT",
      documentReference: "SC501695",
      units: -1,
      salesNet: "-16.66",
      description: '14" Lightning White Glos',
      classification: "LINE",
      issue: null,
    });

    const cover = result.lines.find((row) => row.partNumber === "COVERXL");
    expect(cover?.description).toBe('CAR COVER "XL" 530x175x1');
    expect(cover?.units).toBe(-1);

    const trailingInch = result.lines.find((row) => row.partNumber === "GTXCARBON16");
    expect(trailingInch).toMatchObject({
      description: 'GTX Carbon 16"',
      units: -1,
      salesNet: "0.00",
      classification: "LINE",
    });
    const master = result.lines.find((row) => row.partNumber === "MASTER14");
    expect(master).toMatchObject({
      description: 'Master Wheel Trims 14"',
      units: 1,
      salesNet: "16.66",
      classification: "LINE",
    });

    const sc503053 = result.lines.filter((row) => row.documentReference === "SC503053");
    expect(sc503053).toHaveLength(13);
    const onSourceLine1 = sc503053.filter((row) => row.sourceLineNumber === 1);
    expect(onSourceLine1).toHaveLength(11);
    const fingerprints = new Set(
      onSourceLine1.map((row) =>
        historicalProductLineIdentity({
          documentType: row.documentType,
          documentReference: row.documentReference!,
          sku: row.partNumber!,
          sourceLineNumber: row.sourceLineNumber,
          rawInvAndLn: row.rawInvAndLn,
          skuOrdinal: 1,
          units: String(row.units),
          salesNet: row.salesNet,
        }).fingerprint,
      ),
    );
    expect(fingerprints.size).toBe(11);
  });

  it("treats byte-identical source rows as the same fingerprint", () => {
    const a = historicalProductLineIdentity({
      documentType: "CREDIT",
      documentReference: "SC503509",
      sku: "SS5131",
      sourceLineNumber: 1,
      rawInvAndLn: "C/SC503509/1",
      skuOrdinal: 1,
      units: "-1.000",
      salesNet: "0.00",
    });
    const b = historicalProductLineIdentity({
      documentType: "CREDIT",
      documentReference: "SC503509",
      sku: "SS5131",
      sourceLineNumber: 1,
      rawInvAndLn: "C/SC503509/1",
      skuOrdinal: 2,
      units: "-1.000",
      salesNet: "0.00",
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(historicalProductLineLookupFingerprints(a.fingerprint)).toContain(
      "ln:CREDIT|SC503509|1",
    );
    expect(EXACT_REPEATED_SOURCE_ROW_REASON).toMatch(/does not distinguish a separate return/i);
  });

  it("parses committed exact-repeated zero-value credit rows without inventing identities", () => {
    const result = parseAutopart561l(exactRepeatFixture);
    expect(result.malformedRows).toBe(0);
    expect(result.lines).toHaveLength(7);
    const fingerprints = result.lines.map((row) =>
      historicalProductLineIdentity({
        documentType: row.documentType,
        documentReference: row.documentReference!,
        sku: row.partNumber!,
        sourceLineNumber: row.sourceLineNumber,
        rawInvAndLn: row.rawInvAndLn,
        skuOrdinal: 1,
        units: row.units == null ? null : String(row.units),
        salesNet: row.salesNet,
      }).fingerprint,
    );
    // 3× SWRB4 + 2× SS5131 collapse; SUM-002 and invoice remain distinct → 4 unique.
    expect(new Set(fingerprints).size).toBe(4);
    expect(result.lines.filter((row) => row.partNumber === "SWRB4")).toHaveLength(3);
    expect(result.lines.every((row) => row.documentType === "INVOICE" || Number(row.salesNet) === 0)).toBe(
      true,
    );
  });

  it("parses the uploaded Retail Amazon 561L file with zero blank-units rejections", () => {
    if (!existsSync(uploadedRetail561l)) return;
    const text = readFileSync(uploadedRetail561l, "utf8");
    const result = parseAutopart561l(text);
    expect(result.lines.length + result.malformedRows).toBe(74_626);
    expect(result.lines).toHaveLength(74_626);
    expect(result.malformedRows).toBe(0);
    expect(result.rows.every((row) => row.issue !== "Invalid units: (blank)")).toBe(true);
    expect(result.rows.every((row) => row.issue !== "Invalid sales value")).toBe(true);

    const sc503053 = result.lines.filter((row) => row.documentReference === "SC503053");
    expect(sc503053).toHaveLength(44);
    expect(sc503053.filter((row) => row.sourceLineNumber === 1)).toHaveLength(11);
    expect(sc503053.every((row) => row.units != null && row.units < 0)).toBe(true);

    const fingerprints = new Set(
      result.lines.map((row) =>
        historicalProductLineIdentity({
          documentType: row.documentType,
          documentReference: row.documentReference!,
          sku: row.partNumber!,
          sourceLineNumber: row.sourceLineNumber,
          rawInvAndLn: row.rawInvAndLn,
          skuOrdinal: 1,
          units: row.units == null ? null : String(row.units),
          salesNet: row.salesNet,
        }).fingerprint,
      ),
    );
    // 28 exact repeated raw copies collapse; every other physical line stays distinct.
    expect(fingerprints.size).toBe(74_626 - 28);
  });
});
