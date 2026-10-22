import { describe, expect, it } from "vitest";
import { salesEnquiryInvestigationRequested, salesEnquirySectionLoads } from "@/domain/sales-enquiry-dashboard";
import {
  compareDocumentLines,
  describeSourceTotalDifference,
  goodsAgainstLinesDifference,
  investigationLineDifference,
  lineMatchesComparisonView,
  reconciliationActionForReason,
  reconciliationActions,
  sourceSpread,
} from "@/domain/sales-reconciliation";

function line(
  lineId: string,
  source: string,
  sku: string,
  qty: string,
  net: string,
  reason = "CONFLICTING_OVERLAP",
) {
  return { lineId, source, sku, qty, net, reason };
}

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

  it("keeps identical product lines as separate occurrences and hides matches from the default view", () => {
    const sources = [
      { source: "HISTORICAL_561L", sourceLabel: "561L history (undated)", lineCount: 3, net: "30.00" },
      { source: "COMPANY_561L_SLRB", sourceLabel: "561L + SLRB import", lineCount: 2, net: "25.00" },
    ];
    const lines = [
      line("h1", "HISTORICAL_561L", "BOLT", "1", "10.00"),
      line("h2", "HISTORICAL_561L", "BOLT", "1", "10.00"),
      line("h3", "HISTORICAL_561L", "BOLT", "1", "10.00"),
      line("c1", "COMPANY_561L_SLRB", "BOLT", "1", "10.00"),
      line("c2", "COMPANY_561L_SLRB", "BOLT", "1", "10.00"),
      line("c3", "COMPANY_561L_SLRB", "WASHER", "1", "5.00"),
    ];
    const compared = compareDocumentLines({ lines, sources });
    expect(compared.matching).toBe(2);
    expect(compared.rows.filter((row) => row.kind === "MATCH").map((row) => row.occurrence)).toEqual([1, 2]);
    expect(compared.missing).toBe(2);
    expect(compared.totalDifference).toBe("5.00");
    expect(compared.totalDifferenceSummary).toContain("not certified sales");
    const differences = compared.rows.filter((row) => lineMatchesComparisonView(row.kind, "DIFFERENCES"));
    expect(differences.every((row) => row.kind !== "MATCH")).toBe(true);
    expect(differences.map((row) => row.sku).sort()).toEqual(["BOLT", "WASHER"]);
    expect(lineMatchesComparisonView("MATCH", "MATCHING")).toBe(true);
    expect(lineMatchesComparisonView("REPEATED", "DUPLICATES")).toBe(true);
    expect(lineMatchesComparisonView("MATCH", "ALL")).toBe(true);
  });

  it("reports a quantity and signed-net change without treating the line as two missing rows", () => {
    const compared = compareDocumentLines({
      sources: [
        { source: "HISTORICAL_561L", sourceLabel: "561L history (undated)", lineCount: 936, net: "27227.96" },
        { source: "COMPANY_561L_SLRB", sourceLabel: "561L + SLRB import", lineCount: 963, net: "27825.77" },
      ],
      lines: [
        line("h", "HISTORICAL_561L", "PAD", "1", "10.00"),
        line("c", "COMPANY_561L_SLRB", "PAD", "2", "12.50"),
      ],
    });
    expect(compared.rows).toHaveLength(1);
    expect(compared.rows[0]?.kind).toBe("QTY_AND_NET_CHANGED");
    expect(compared.rows[0]?.qtyDifference).toBe("-1.000");
    expect(compared.rows[0]?.netDifference).toBe("-2.50");
    expect(compared.quantityChanged).toBe(1);
    expect(compared.netChanged).toBe(1);
    expect(describeSourceTotalDifference(compared.rows.length ? [
      { source: "HISTORICAL_561L", sourceLabel: "561L history (undated)", lineCount: 936, net: "27227.96" },
      { source: "COMPANY_561L_SLRB", sourceLabel: "561L + SLRB import", lineCount: 963, net: "27825.77" },
    ] : []).totalDifference).toBe("597.81");
  });

  it("does not let a repeated import row take the place of a genuine second product line", () => {
    const compared = compareDocumentLines({
      sources: [
        { source: "HISTORICAL_561L", sourceLabel: "561L history (undated)", lineCount: 2, net: "8.00" },
        { source: "COMPANY_561L_SLRB", sourceLabel: "561L + SLRB import", lineCount: 1, net: "4.00" },
      ],
      lines: [
        line("h1", "HISTORICAL_561L", "BELT", "1", "4.00"),
        line("h2", "HISTORICAL_561L", "BELT", "1", "4.00", "REPEATED_SOURCE_ROW"),
        line("c1", "COMPANY_561L_SLRB", "BELT", "1", "4.00"),
      ],
    });
    expect(compared.matching).toBe(1);
    expect(compared.repeated).toBe(1);
    expect(compared.missing).toBe(0);
    expect(compared.rows.find((row) => row.kind === "REPEATED")?.netDifference).toBe("4.00");
  });

  it("stays closed when the dashboard or historical summary opens", () => {
    expect(salesEnquirySectionLoads("overview").investigation).toBe(false);
    expect(salesEnquirySectionLoads("history").investigation).toBe(false);
    expect(salesEnquiryInvestigationRequested(false)).toBe(false);
  });
});
