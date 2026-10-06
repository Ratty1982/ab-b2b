import { describe, expect, it } from "vitest";
import {
  classifyAutopart504Kind,
  describeAutopart504Malformed,
  detectAutopart504Filename,
  detectAutopart504FixedWidthLayout,
  isAutopart504ImportableRow,
  isAutopart504Report,
  parseAutopart504Report,
  parseAutopart504UkDate,
} from "@/domain/autopart-504";
import {
  AUTOPART_504_DAYEND_HEADER,
  AUTOPART_504_DAYEND_SAMPLE_OIN_ROW,
  AUTOPART_504_DAYEND_TITLE,
  buildAutopart504DayEndFixture,
} from "@/domain/autopart-504-dayend-fixture";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import { classifyOngoingSalesAttachment } from "@/server/companies/autopart-ongoing-sales-poll";
import { reconcile504GoodsToTrmSales } from "@/domain/autopart-504-trm21qc-reconcile";
import { detectOngoingSalesAttachmentType } from "@/domain/autopart-ongoing-sales-attachment";

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

describe("Autopart 504 production day-end TXT", () => {
  const fixture = buildAutopart504DayEndFixture();
  const withCredit = buildAutopart504DayEndFixture({ includeCredit: true });
  const withMalformed = buildAutopart504DayEndFixture({ malformed: true });

  it("recognises the real 504 heading as ONGOING_504", () => {
    expect(isAutopart504Report(fixture)).toBe(true);
    expect(isAutopart504Report(AUTOPART_504_DAYEND_TITLE)).toBe(true);
    expect(detectOngoingSalesAttachmentType("504.txt", fixture)).toBe("ONGOING_504");
  });

  it("detects 504.txt plus real content as ONGOING_504", () => {
    expect(detectOngoingSalesAttachmentType("504.txt", fixture)).toBe("ONGOING_504");
    expect(classifyOngoingSalesAttachment("504.txt", fixture)).toBe("504");
  });

  it("still detects the same content with an unusual filename", () => {
    expect(detectOngoingSalesAttachmentType("DayEnd_weird_name.TXT", fixture)).toBe("ONGOING_504");
    expect(detectOngoingSalesAttachmentType("invoice-listing.txt", fixture)).toBe("ONGOING_504");
  });

  it("keeps genuine legacy 504C as LEGACY_504C and out of the 504 parser", () => {
    const c = `LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n${AUTOPART_504C_HEADER}\n`;
    expect(isAutopart504Report(c)).toBe(false);
    expect(detectOngoingSalesAttachmentType("504.txt", c)).toBe("LEGACY_504C");
    expect(detectOngoingSalesAttachmentType("504C_20261005.txt", c)).toBe("LEGACY_504C");
    expect(classifyOngoingSalesAttachment("504C_20261005.txt", c)).toBe("504C");
  });

  it("derives fixed-width boundaries from header label starts", () => {
    const layout = detectAutopart504FixedWidthLayout(AUTOPART_504_DAYEND_HEADER);
    expect(layout).not.toBeNull();
    const byKey = Object.fromEntries((layout ?? []).map((c) => [c.key, c]));
    expect(byKey.type?.start).toBe(0);
    expect(byKey.document?.start).toBe(10);
    expect(byKey.document?.end).toBe(19);
    expect(byKey.date?.start).toBe(19);
    expect(byKey.time?.start).toBe(29);
    expect(byKey.customer?.start).toBe(35);
    expect(byKey.goods?.start).toBe(71);
    expect(byKey.vat?.start).toBe(82);
    expect(byKey.value?.start).toBe(92);
    expect(byKey.inits?.start).toBe(98);
    expect(byKey.orderNumber?.start).toBe(105);
  });

  it("parses OIN document/date boundary from the production example row", () => {
    const text = [AUTOPART_504_DAYEND_TITLE, AUTOPART_504_DAYEND_HEADER, AUTOPART_504_DAYEND_SAMPLE_OIN_ROW].join(
      "\n",
    );
    const parsed = parseAutopart504Report(text);
    const row = parsed.rows.find((r) => r.documentNumber === "OIN025730");
    expect(row).toBeTruthy();
    expect(row?.documentNumber).toBe("OIN025730");
    expect(row?.documentNumber).not.toBe("OIN02573006");
    expect(row?.reportType).toBe("ACCOUNT");
    expect(row?.documentDate).toBe("2026-10-06");
    expect(row?.documentTime).toBe("10:54");
    expect(row?.customerName).toBe("Retail Amazon");
    expect(row?.goods).toBe("49.99");
    expect(row?.vat).toBe("10.00");
    expect(row?.value).toBe("59.99");
    expect(row?.initials).toBe("WR");
    expect(row?.customerOrderNumber).toBe("206-1152538-1059517");
    expect(row?.kind).toBe("INVOICE");
  });

  it("parses ACCOUNT and CONSOL rows with SS document boundaries", () => {
    const parsed = parseAutopart504Report(fixture);
    expect(parsed.layoutMode).toBe("fixed-width");
    expect(parsed.headerFound).toBe(true);

    const pitStop = parsed.rows.find((r) => r.documentNumber === "SS306229");
    expect(pitStop?.reportType).toBe("ACCOUNT");
    expect(pitStop?.documentDate).toBe("2026-10-06");
    expect(pitStop?.documentTime).toBe("08:06");
    expect(pitStop?.customerName).toBe("Car Shop Pit Stop Ltd");
    expect(pitStop?.goods).toBe("416.74");
    expect(pitStop?.vat).toBe("83.35");
    expect(pitStop?.value).toBe("500.09");
    expect(pitStop?.initials).toBe("RS");
    expect(pitStop?.customerOrderNumber).toBe("KEITH051026");

    const leisure = parsed.rows.find((r) => r.documentNumber === "SS306251");
    expect(leisure?.reportType).toBe("ACCOUNT");
    expect(leisure?.customerName).toBe("RR Leisureways (Two) Ltd");
    expect(leisure?.goods).toBe("579.38");
    expect(leisure?.vat).toBe("115.88");
    expect(leisure?.value).toBe("695.26");
    expect(leisure?.customerOrderNumber).toBe("RPO0086648");

    const consol = parsed.rows.find((r) => r.documentNumber === "SS306238");
    expect(consol?.reportType).toBe("CONSOL");
    expect(consol?.kind).toBe("INVOICE");
    expect(consol?.customerName).toBe("VERTU Motors");
    expect(consol?.goods).toBe("116.40");
    expect(consol?.vat).toBe("23.28");
    expect(consol?.value).toBe("139.68");
    expect(consol?.initials).toBe("RS");
    expect(consol?.customerOrderNumber).toBe("157286-9176672");
    expect(isAutopart504ImportableRow(consol!)).toBe(true);

    const vertuPage2 = parsed.rows.find((r) => r.documentNumber === "SS306246");
    expect(vertuPage2?.reportType).toBe("CONSOL");
    expect(vertuPage2?.customerName).toBe("Vertu Motors");
  });

  it("parses UK dates from month-name rows and slash headers", () => {
    expect(parseAutopart504UkDate("06 Oct 26")).toBe("2026-10-06");
    expect(parseAutopart504UkDate("06/10/2026")).toBe("2026-10-06");
    expect(parseAutopart504UkDate("10/06/2026")).toBe("2026-06-10");
  });

  it("ignores repeated page headings, separators, subtotals, and the grand total", () => {
    const parsed = parseAutopart504Report(fixture);
    const importable = parsed.rows.filter(isAutopart504ImportableRow);
    expect(importable.map((r) => r.documentNumber).sort()).toEqual(
      ["OIN025730", "SS306229", "SS306238", "SS306239", "SS306244", "SS306246", "SS306251"].sort(),
    );
    expect(parsed.rows.some((r) => r.classification === "HEADER")).toBe(true);
    expect(parsed.rows.some((r) => r.classification === "PAGE")).toBe(true);
    expect(parsed.rows.some((r) => r.classification === "SUBTOTAL")).toBe(true);
    expect(parsed.rows.some((r) => r.classification === "TOTAL")).toBe(true);
    expect(parsed.grandTotal).toEqual({ goods: "7779.09", vat: "1555.85", value: "9334.94" });
    expect(importable.some((r) => r.goods === "7779.09")).toBe(false);
    expect(importable.some((r) => r.documentNumber.includes("LISTING"))).toBe(false);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("keeps signed credit rows correct on the fixed-width path", () => {
    const parsed = parseAutopart504Report(withCredit);
    const credit = parsed.rows.find((r) => r.documentNumber === "SC100099");
    expect(credit?.kind).toBe("CREDIT");
    expect(credit?.goods).toBe("-10.00");
    expect(credit?.vat).toBe("-2.00");
    expect(credit?.value).toBe("-12.00");
    expect(parsed.creditRows.some((r) => r.documentNumber === "SC100099")).toBe(true);
  });

  it("emits bounded malformed diagnostics with line and document candidate", () => {
    const parsed = parseAutopart504Report(withMalformed);
    const bad = parsed.rows.find((r) => r.documentNumber === "SS306999");
    expect(bad?.classification).toBe("MALFORMED");
    expect(bad?.malformedReason).toContain("missing goods/value");
    const detail = describeAutopart504Malformed(bad!);
    expect(detail).toContain("Line ");
    expect(detail).toContain("SS306999");
    expect(detail).toMatch(/missing goods\/value/i);
    expect(parsed.errors.some((e) => e.includes("SS306999") && e.includes("Line "))).toBe(true);
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
