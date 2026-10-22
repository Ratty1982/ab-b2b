import { describe, expect, it } from "vitest";
import {
  isHistoricalOnlySalesDocument,
  isHistoricalOnlySalesLine,
  isOngoingSalesDocument,
} from "@/domain/ongoing-sales-scope";

describe("ongoing sales scope", () => {
  it("keeps a 561L document once 504 or TRM has accepted it", () => {
    expect(
      isOngoingSalesDocument({ source: "561L", has504: true, hasTrm21qc: false }),
    ).toBe(true);
    expect(
      isOngoingSalesDocument({ source: "SLRB", has504: false, hasTrm21qc: true }),
    ).toBe(true);
    expect(
      isHistoricalOnlySalesDocument({ source: "561L", has504: true, hasTrm21qc: false }),
    ).toBe(false);
  });

  it("treats an untouched 561L or SLRB document as historical only", () => {
    expect(
      isHistoricalOnlySalesDocument({ source: "SLRB", has504: false, hasTrm21qc: false }),
    ).toBe(true);
    expect(
      isOngoingSalesDocument({ source: "ONGOING_504", has504: false, hasTrm21qc: false }),
    ).toBe(true);
  });

  it("does not delete a 561L line that sits on a live 504 document", () => {
    expect(
      isHistoricalOnlySalesLine({
        source: "561L",
        document: { source: "561L", has504: true, hasTrm21qc: false },
      }),
    ).toBe(false);
  });

  it("marks a 561L line with no live document as historical only", () => {
    expect(
      isHistoricalOnlySalesLine({
        source: "561L",
        document: { source: "SLRB", has504: false, hasTrm21qc: false },
      }),
    ).toBe(true);
    expect(
      isHistoricalOnlySalesLine({
        source: "ONGOING_TRM21QC",
        document: { source: "ONGOING_TRM21QC", has504: false, hasTrm21qc: true },
      }),
    ).toBe(false);
    expect(
      isHistoricalOnlySalesLine({
        source: null,
        document: { source: "561L", has504: false, hasTrm21qc: false },
      }),
    ).toBe(false);
    expect(isHistoricalOnlySalesLine({ source: null, document: null })).toBe(false);
  });
});
