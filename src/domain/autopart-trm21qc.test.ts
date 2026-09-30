import { describe, expect, it } from "vitest";
import {
  assignStableTrm21qcLineNumbers,
  detectAutopartTrm21qcFilename,
  isAutopartTrm21qcReport,
  parseAutopartTrm21qcReport,
} from "@/domain/autopart-trm21qc";
import { classifyOngoingSalesAttachment } from "@/server/companies/autopart-ongoing-sales-poll";

const SAMPLE = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
AB001,TRADE,SS100001,29/09/2026,SKU-A,Cleaner A,2,200.00,100.00,100.00,50.0
AB001,TRADE,SS100001,29/09/2026,SKU-B,Cleaner B,1,103.00,50.00,53.00,51.5
AB001,TRADE,SC100002,29/09/2026,SKU-A,Cleaner A credit,-1,-33.33,-10.00,-23.33,0
AB001,TRADE,SS100001,29/09/2026,SKU-A,Cleaner A again,1,50.00,25.00,25.00,50.0
`;

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
});
