import { describe, expect, it } from "vitest";
import {
  classifyAutopart504Kind,
  detectAutopart504Filename,
  isAutopart504Report,
  parseAutopart504Report,
} from "@/domain/autopart-504";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import { classifyOngoingSalesAttachment } from "@/server/companies/autopart-ongoing-sales-poll";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";

const SAMPLE_504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,SS100001,29/09/2026,13:05,EXAMPLE MOTOR FACTORS,303.00,60.60,363.60,WR,AB-001234
ACCOUNT,SC100002,29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,AB-001234
ACCOUNT,SS100003,29/09/2026,15:00,AMAZON EU SARL,22.00,4.40,26.40,AZ,026-1234567-8901234
CONSOL,SS100004,29/09/2026,16:00,WEB ORDER,10.00,2.00,12.00,WB,WEB-99
`;

describe("Autopart 504 parser", () => {
  it("parses invoices, credits, AB and non-AB rows", () => {
    expect(isAutopart504Report(SAMPLE_504)).toBe(true);
    const parsed = parseAutopart504Report(SAMPLE_504);
    expect(parsed.headerFound).toBe(true);
    expect(parsed.invoiceRows).toHaveLength(3);
    expect(parsed.creditRows).toHaveLength(1);
    expect(parsed.abInvoiceRows).toHaveLength(1);
    expect(parsed.abCreditRows).toHaveLength(1);
    expect(parsed.nonAbRows).toBe(2);
    expect(parsed.abInvoiceRows[0]?.goods).toBe("303.00");
    expect(parsed.abCreditRows[0]?.goods).toBe("-33.33");
  });

  it("rejects 504C fixed-width content and filenames", () => {
    const c = `LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n${AUTOPART_504C_HEADER}\n`;
    expect(isAutopart504Report(c)).toBe(false);
    expect(detectAutopart504Filename("504C.CSV")).toBe(false);
    expect(detectAutopart504Filename("504.CSV")).toBe(true);
    expect(detectAutopart504Filename("504.TXT")).toBe(true);
    expect(detectAutopart504Filename("504.txt")).toBe(true);
    expect(classifyOngoingSalesAttachment("504C.CSV", c)).toBe("504C");
    expect(classifyOngoingSalesAttachment("504.CSV", SAMPLE_504)).toBe("504");
    expect(classifyOngoingSalesAttachment("504.TXT", SAMPLE_504)).toBe("504");
  });

  it("classifies credits by SC prefix and signed values", () => {
    expect(classifyAutopart504Kind("SC1", "10.00", "12.00")).toBe("CREDIT");
    expect(classifyAutopart504Kind("SS1", "-10.00", "-12.00")).toBe("CREDIT");
    expect(classifyAutopart504Kind("SS1", "10.00", "12.00")).toBe("INVOICE");
  });
});

describe("504 ↔ TRM21QC reconciliation", () => {
  it("matches net goods to sum of line sales within 1p", () => {
    const ok = reconcile504GoodsToTrmSales({
      goods504: "303.00",
      trmSalesNets: ["200.00", "103.00"],
      has504: true,
      hasTrm21qc: true,
    });
    expect(ok.status).toBe("MATCHED");
  });

  it("reconciles credits", () => {
    const ok = reconcile504GoodsToTrmSales({
      goods504: "-33.33",
      trmSalesNets: ["-33.33"],
      has504: true,
      hasTrm21qc: true,
    });
    expect(ok.status).toBe("MATCHED");
  });

  it("awaits companion report without failing", () => {
    expect(
      reconcile504GoodsToTrmSales({
        goods504: "10.00",
        trmSalesNets: [],
        has504: true,
        hasTrm21qc: false,
      }).status,
    ).toBe("AWAITING_LINES");
    expect(
      reconcile504GoodsToTrmSales({
        goods504: null,
        trmSalesNets: ["10.00"],
        has504: false,
        hasTrm21qc: true,
      }).status,
    ).toBe("AWAITING_504");
  });

  it("flags genuine mismatch", () => {
    const bad = reconcile504GoodsToTrmSales({
      goods504: "100.00",
      trmSalesNets: ["40.00"],
      has504: true,
      hasTrm21qc: true,
    });
    expect(bad.status).toBe("VALUE_MISMATCH");
  });
});
