import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignStableTrm21qcLineNumbers,
  detectAutopartTrm21qcFilename,
  isAutopartTrm21qcReport,
  normaliseTrmDescription,
  parseAutopartTrm21qcReport,
  parseLeadingCsvFields,
  peelTrailingFinancialFields,
  parseTrm21qcSignedDecimal,
  resolveTrm21qcRowCells,
  trm21qcMalformedToReasonCode,
} from "@/domain/autopart-trm21qc";
import { classifyOngoingSalesAttachment } from "@/server/companies/autopart-ongoing-sales-poll";

const SAMPLE = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
AB001,TRADE,SS100001,29/09/2026,SKU-A,Cleaner A,2,200.00,100.00,100.00,50.0
AB001,TRADE,SS100001,29/09/2026,SKU-B,Cleaner B,1,103.00,50.00,53.00,51.5
AB001,TRADE,SC100002,29/09/2026,SKU-A,Cleaner A credit,-1,-33.33,-10.00,-23.33,0
AB001,TRADE,SS100001,29/09/2026,SKU-A,Cleaner A again,1,50.00,25.00,25.00,50.0
`;

const RETAIL_FIXTURE = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-trm21qc-retail-parse-cases.csv"),
  "utf8",
);

const HEADER_MAP = {
  cust: 0,
  group: 1,
  document: 2,
  date: 3,
  part: 4,
  description: 5,
  qty: 6,
  sales: 7,
  cost: 8,
  margin: 9,
  perc: 10,
};

/** Exact production Autopart lines (unescaped inch mark in Description). */
const PROD_SS306120 =
  `"RETAIL","WT","SS306120","01 Oct 26","SWUX101","14" Phoenix Premium Boxed Whee","1","24.99","9.99","15.00","60.02"`;
const PROD_SC506090 =
  `"RETAIL","WT","SC506090","01 Oct 26","SWUX101","14" Phoenix Premium Boxed Whee","-1","-24.99","-9.99","-15.00","60.02"`;

describe("Autopart TRM21QC parser", () => {
  it("parses invoice and credit lines with signed qty/sales", () => {
    expect(isAutopartTrm21qcReport(SAMPLE)).toBe(true);
    expect(detectAutopartTrm21qcFilename("TRM21QC_20260929.CSV")).toBe(true);
    const parsed = parseAutopartTrm21qcReport(SAMPLE);
    expect(parsed.headerFound).toBe(true);
    expect(parsed.invoiceLines.length).toBe(3);
    expect(parsed.creditLines.length).toBe(1);
    expect(parsed.documents).toContain("SS100001");
    expect(parsed.creditLines[0]?.salesNet).toBe("-33.33");
    expect(parsed.creditLines[0]?.qty).toBe("-1.000");
  });

  it("assigns stable line numbers when the same SKU repeats", () => {
    const parsed = parseAutopartTrm21qcReport(SAMPLE);
    const stable = assignStableTrm21qcLineNumbers(parsed.rows);
    const forDoc = stable.filter((r) => r.documentNumber === "SS100001");
    expect(forDoc).toHaveLength(3);
    expect(new Set(forDoc.map((r) => r.stableLineNumber)).size).toBe(3);
  });

  it("detects TRM21QC vs 504 attachments", () => {
    expect(classifyOngoingSalesAttachment("TRM21QC.CSV", SAMPLE)).toBe("TRM21QC");
  });

  it("accepts Autopart money tokens (£, CR, unicode minus, zero-width) without inventing blanks", () => {
    expect(parseTrm21qcSignedDecimal("£12.50", 2)).toBe("12.50");
    expect(parseTrm21qcSignedDecimal("12.50CR", 2)).toBe("-12.50");
    expect(parseTrm21qcSignedDecimal("\u22128.99", 2)).toBe("-8.99");
    expect(parseTrm21qcSignedDecimal(`10.00\u200B`, 2)).toBe("10.00");
    expect(parseTrm21qcSignedDecimal("", 2)).toBeNull();
    expect(parseTrm21qcSignedDecimal("-", 2)).toBeNull();
    expect(parseTrm21qcSignedDecimal("****", 2)).toBeNull();
  });

  it("recovers exact production SS306120 / SC506090 rows with unescaped inch marks", () => {
    const text = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%\n${PROD_SS306120}\n${PROD_SC506090}\n`;
    const parsed = parseAutopartTrm21qcReport(text);
    const ss = parsed.rows.find((r) => r.documentNumber === "SS306120");
    const sc = parsed.rows.find((r) => r.documentNumber === "SC506090");
    expect(ss).toMatchObject({
      customerAccount: "RETAIL",
      group: "WT",
      partNumber: "SWUX101",
      classification: "OK",
      kind: "INVOICE",
      qty: "1.000",
      salesNet: "24.99",
      documentDate: "2026-10-01",
      description: '14" Phoenix Premium Boxed Whee',
    });
    expect(sc).toMatchObject({
      customerAccount: "RETAIL",
      group: "WT",
      partNumber: "SWUX101",
      classification: "OK",
      kind: "CREDIT",
      qty: "-1.000",
      salesNet: "-24.99",
      documentDate: "2026-10-01",
      description: '14" Phoenix Premium Boxed Whee',
    });
    expect(parsed.documents).toContain("SS306120");
    expect(parsed.documents).toContain("SC506090");
    expect(ss?.malformedReason).toBeUndefined();
    expect(sc?.malformedReason).toBeUndefined();
  });

  it("recovers 14/15/16 inch descriptions and keeps normal / 500ml rows", () => {
    const parsed = parseAutopartTrm21qcReport(RETAIL_FIXTURE);
    expect(parsed.rows.find((r) => r.documentNumber === "SS306120")).toMatchObject({
      classification: "OK",
      salesNet: "24.99",
      description: '14" Phoenix Premium Boxed Whee',
    });
    expect(parsed.rows.find((r) => r.documentNumber === "SS306122")).toMatchObject({
      classification: "OK",
      salesNet: "10.00",
      description: '15" Alloy Wheel Cap',
    });
    expect(parsed.rows.find((r) => r.documentNumber === "SS306123")).toMatchObject({
      classification: "OK",
      salesNet: "8.50",
      description: '16" Spare Cover',
    });
    expect(parsed.rows.find((r) => r.documentNumber === "SS306124")).toMatchObject({
      classification: "OK",
      salesNet: "15.00",
      description: "500ml Interior Cleaner",
    });
    expect(parsed.rows.find((r) => r.documentNumber === "SS306125")).toMatchObject({
      classification: "OK",
      salesNet: "5.00",
      description: "Normal description without quotes",
    });
  });

  it("rejects genuinely corrupt rows as PARSE_ERROR not INVALID_NET_SALES", () => {
    const parsed = parseAutopartTrm21qcReport(RETAIL_FIXTURE);
    const corrupt = parsed.rows.find((r) => r.documentNumber === "SS306199");
    expect(corrupt).toMatchObject({
      classification: "MALFORMED",
      malformedReason: "ROW_STRUCTURE_INVALID",
    });
    expect(trm21qcMalformedToReasonCode(corrupt?.malformedReason)).toBe("PARSE_ERROR");
    expect(parsed.documents).not.toContain("SS306199");
  });

  it("classifies blank Sales (after confident recovery) as INVALID_NET_SALES", () => {
    const parsed = parseAutopartTrm21qcReport(RETAIL_FIXTURE);
    const ss = parsed.rows.find((r) => r.documentNumber === "SS306121");
    const sc = parsed.rows.find((r) => r.documentNumber === "SC506091");
    expect(ss).toMatchObject({
      customerAccount: "RETAIL",
      partNumber: "SWUX101",
      classification: "MALFORMED",
      malformedReason: "INVALID_NET_SALES",
      salesNet: null,
      qty: "1.000",
    });
    expect(sc).toMatchObject({
      customerAccount: "RETAIL",
      partNumber: "SWUX101",
      classification: "MALFORMED",
      malformedReason: "INVALID_NET_SALES",
      salesNet: null,
      qty: "-1.000",
    });
    expect(trm21qcMalformedToReasonCode(ss?.malformedReason)).toBe("INVALID_NET_SALES");
    expect(parsed.documents).not.toContain("SS306121");
    expect(parsed.documents).not.toContain("SC506091");
  });

  it("parses valid Autopart Sales variants that previously failed strict decimal checks", () => {
    const withZw = RETAIL_FIXTURE.replace(
      "Control Cleaner,2,20.00",
      `Control Cleaner,2,20.00\u200B`,
    );
    const parsed = parseAutopartTrm21qcReport(withZw);
    const pound = parsed.rows.find((r) => r.documentNumber === "SS100011");
    const cr = parsed.rows.find((r) => r.documentNumber === "SC100012");
    const uni = parsed.rows.find((r) => r.documentNumber === "SC100013");
    const control = parsed.rows.find((r) => r.documentNumber === "SS100010");
    expect(pound?.classification).toBe("OK");
    expect(pound?.salesNet).toBe("12.50");
    expect(cr?.classification).toBe("OK");
    expect(cr?.salesNet).toBe("-12.50");
    expect(cr?.kind).toBe("CREDIT");
    expect(uni?.classification).toBe("OK");
    expect(uni?.salesNet).toBe("-8.99");
    expect(control?.classification).toBe("OK");
    expect(control?.salesNet).toBe("20.00");
  });

  it("classifies TOTAL artefacts as UNRECOGNISED_ROW_TYPE", () => {
    const parsed = parseAutopartTrm21qcReport(RETAIL_FIXTURE);
    const total = parsed.rows.find((r) => r.partNumber === "TOTAL" || r.documentNumber === "TOTAL");
    expect(total?.classification).toBe("MALFORMED");
    expect(total?.malformedReason).toBe("UNRECOGNISED_ROW_TYPE");
    expect(trm21qcMalformedToReasonCode(total?.malformedReason)).toBe("UNRECOGNISED_ROW_TYPE");
  });

  it("keeps truncated rows with missing trailing financial fields out of financials", () => {
    const text = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
RETAIL,RETAIL,SS306120,29/09/2026,SWUX101,Power Maxed UX Cleaner,1
`;
    const parsed = parseAutopartTrm21qcReport(text);
    expect(parsed.rows[0]).toMatchObject({
      documentNumber: "SS306120",
      partNumber: "SWUX101",
      classification: "MALFORMED",
      malformedReason: "ROW_STRUCTURE_INVALID",
      salesRawPresent: false,
    });
    expect(trm21qcMalformedToReasonCode(parsed.rows[0]?.malformedReason)).toBe("PARSE_ERROR");
  });

  it("structural helpers peel leading/trailing fields without shifting money", () => {
    const leading = parseLeadingCsvFields(PROD_SS306120, ",", 5);
    expect(leading?.fields).toEqual(["RETAIL", "WT", "SS306120", "01 Oct 26", "SWUX101"]);
    const trailing = peelTrailingFinancialFields(leading!.rest, ",", 5);
    expect(trailing?.fields).toEqual(["1", "24.99", "9.99", "15.00", "60.02"]);
    expect(normaliseTrmDescription(trailing!.descriptionRaw)).toBe('14" Phoenix Premium Boxed Whee');
    const resolved = resolveTrm21qcRowCells(PROD_SS306120, ",", HEADER_MAP);
    expect(resolved?.resolution).toBe("structural");
    expect(resolved?.sales).toBe("24.99");
  });
});
