import { describe, expect, it } from "vitest";
import { salesEnquiryInvestigationRequested, salesEnquirySectionLoads } from "@/domain/sales-enquiry-dashboard";
import {
  goodsAgainstLinesDifference,
  investigationLineDifference,
  reconciliationActionForReason,
  reconciliationActions,
  sourceSpread,
} from "@/domain/sales-reconciliation";

describe("sales reconciliation investigation rules", () => {
  it("points each discrepancy at source data, account mapping, or import processing", () => {
    expect(reconciliationActionForReason("CONFLICTING_OVERLAP")).toBe("AUTOPART_SOURCE");
    expect(reconciliationActionForReason("DOCUMENT_GOODS_MISMATCH")).toBe("AUTOPART_SOURCE");
    expect(reconciliationActionForReason("NO_DOCUMENT_REFERENCE")).toBe("AUTOPART_SOURCE");
    expect(reconciliationActionForReason("UNKNOWN_DOCUMENT_TYPE")).toBe("AUTOPART_SOURCE");
    expect(reconciliationActionForReason("AMBIGUOUS_ACCOUNT")).toBe("ACCOUNT_MAPPING");
    expect(reconciliationActionForReason("REPEATED_SOURCE_ROW")).toBe("IMPORT_PROCESSING");
    expect(reconciliationActions(["CONFLICTING_OVERLAP", "REPEATED_SOURCE_ROW"])).toEqual([
      "IMPORT_PROCESSING",
      "AUTOPART_SOURCE",
    ]);
  });

  it("compares a 504 goods total with product lines and with the other source", () => {
    expect(goodsAgainstLinesDifference("99.00", "10.00")).toBe("89.00");
    expect(goodsAgainstLinesDifference("10.00", "25.50")).toBe("-15.50");
    expect(goodsAgainstLinesDifference(null, "10.00")).toBeNull();
    expect(sourceSpread(["10.00", "30.00"])).toBe("20.00");
    expect(sourceSpread(["10.00"])).toBeNull();
    expect(
      investigationLineDifference({
        reason: "DOCUMENT_GOODS_MISMATCH",
        net: "10.00",
        sku: "PAD",
        source: "COMPANY_561L_SLRB",
        documentDifference: "89.00",
        peers: [],
      }),
    ).toBe("89.00");
    expect(
      investigationLineDifference({
        reason: "CONFLICTING_OVERLAP",
        net: "30.00",
        sku: "PAD",
        source: "TRM21QC_FEED",
        documentDifference: null,
        peers: [
          { sku: "PAD", source: "TRM21QC_FEED", net: "30.00" },
          { sku: "PAD", source: "HISTORICAL_561L", net: "10.00" },
        ],
      }),
    ).toBe("20.00");
    expect(
      investigationLineDifference({
        reason: "REPEATED_SOURCE_ROW",
        net: "4.00",
        sku: "OIL",
        source: "HISTORICAL_561L",
        documentDifference: null,
        peers: [],
      }),
    ).toBe("4.00");
  });

  it("stays closed when the dashboard or historical summary opens", () => {
    expect(salesEnquirySectionLoads("overview").investigation).toBe(false);
    expect(salesEnquirySectionLoads("history").investigation).toBe(false);
    expect(salesEnquiryInvestigationRequested(false)).toBe(false);
  });
});
