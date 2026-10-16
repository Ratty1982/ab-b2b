import { describe, expect, it } from "vitest";
import {
  describeOngoingImportAttention,
  importRunNeedsAttention,
  ONGOING_IMPORT_ATTENTION_REASON,
} from "@/domain/autopart-ongoing-import-attention";
import { describeSafetyReportCoverage } from "@/domain/autopart-ongoing-safety-report";

describe("ongoing import attention", () => {
  it("marks a committed run with skipped conflicts as needing attention", () => {
    const attention = describeOngoingImportAttention([
      { documentReference: "INV1", documentType: "INVOICE", detail: "Document INV1 was skipped." },
    ]);
    expect(attention.attentionRequired).toBe(true);
    expect(attention.attentionReason).toBe(ONGOING_IMPORT_ATTENTION_REASON);
    expect(importRunNeedsAttention({ attentionRequired: true }, { conflicts: [{ documentReference: "INV1" }] })).toBe(
      true,
    );
  });

  it("leaves a clean committed run unmarked", () => {
    expect(describeOngoingImportAttention([])).toEqual({ attentionRequired: false, attentionReason: null });
    expect(importRunNeedsAttention({}, {})).toBe(false);
  });
});

describe("safety report coverage", () => {
  it("states when the order sample is incomplete", () => {
    const coverage = describeSafetyReportCoverage({
      collisionTotal: 140,
      collisionShown: 100,
      attentionTotal: 8,
      attentionShown: 8,
      candidateOrders: 900,
      inspectedOrders: 200,
      blockingInSample: 40,
      blockingShown: 20,
      documentsTruncated: true,
      invoicesTruncated: false,
    });
    expect(coverage.inspectedEveryCandidate).toBe(false);
    expect(coverage.note).toContain("Showing 100 of 140");
    expect(coverage.note).toContain("20 of 40");
    expect(coverage.note).toContain("has not classified every candidate order");
  });

  it("states when every candidate order was inspected", () => {
    const coverage = describeSafetyReportCoverage({
      collisionTotal: 1,
      collisionShown: 1,
      attentionTotal: 0,
      attentionShown: 0,
      candidateOrders: 2,
      inspectedOrders: 2,
      blockingInSample: 1,
      blockingShown: 1,
      documentsTruncated: false,
      invoicesTruncated: false,
    });
    expect(coverage.inspectedEveryCandidate).toBe(true);
    expect(coverage.note).toContain("Every candidate order");
  });
});