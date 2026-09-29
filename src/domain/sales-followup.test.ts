import { describe, expect, it } from "vitest";
import {
  defaultFollowupSubject,
  formatFollowupDescription,
  resolveFollowupDueDate,
  siFollowupReasonLabel,
  siFollowupSourceLabel,
  type SiFollowupSnapshot,
} from "@/domain/sales-followup";

describe("sales-followup domain", () => {
  it("generates concise subjects", () => {
    expect(
      defaultFollowupSubject({
        reason: "STOPPED",
        productName: "Catalytic Converter Cleaner",
      }),
    ).toBe("Follow up — Catalytic Converter Cleaner");
    expect(
      defaultFollowupSubject({
        reason: "RANGE_GAP",
        productName: "Brake Cleaner 500ml",
      }),
    ).toBe("Range opportunity — Brake Cleaner 500ml");
    expect(
      defaultFollowupSubject({
        reason: "CUSTOMER",
        companyName: "York Motor Factors",
      }),
    ).toBe("Follow up — York Motor Factors");
  });

  it("resolves due-date presets on London date-only", () => {
    expect(resolveFollowupDueDate({ preset: "TODAY", today: "2026-09-29" })).toBe("2026-09-29");
    expect(resolveFollowupDueDate({ preset: "TOMORROW", today: "2026-09-29" })).toBe("2026-09-30");
    expect(resolveFollowupDueDate({ preset: "IN_3_DAYS", today: "2026-09-29" })).toBe("2026-10-02");
    expect(resolveFollowupDueDate({ preset: "IN_1_WEEK", today: "2026-09-29" })).toBe("2026-10-06");
    expect(
      resolveFollowupDueDate({
        preset: "CUSTOM",
        customDate: "2026-10-15",
        today: "2026-09-29",
      }),
    ).toBe("2026-10-15");
  });

  it("labels sources and reasons", () => {
    expect(siFollowupSourceLabel("GAP_ANALYSIS")).toBe("Gap Analysis");
    expect(siFollowupReasonLabel("STOPPED")).toBe("Stopped Buying");
    expect(siFollowupReasonLabel("NET_SPEND_REVIEW")).toBe("Net Spend Review");
  });

  it("formats description without dumping huge payloads", () => {
    const snapshot: SiFollowupSnapshot = {
      sourceModule: "GAP_ANALYSIS",
      sourceReason: "STOPPED",
      companyId: "c1",
      companyName: "York Motor Factors",
      autopartCustomerCode: "YORKMOTO",
      productId: null,
      sku: "CAT-CLEAN",
      productName: "Catalytic Converter Cleaner",
      brandName: null,
      categoryName: null,
      historicOnly: false,
      selectedPeriod: { from: "2026-08-31", to: "2026-09-29", label: "2026-08-31 → 2026-09-29" },
      comparisonPeriod: {
        from: "2025-08-31",
        to: "2025-09-29",
        label: "2025-08-31 → 2025-09-29",
      },
      metrics: {
        "Comparison qty": 12,
        "Comparison net sales": "89.52",
        "Selected qty": 0,
        "Selected net sales": "0.00",
      },
      deepLinkPath: "/sales/sales-intelligence/gaps",
      capturedAt: "2026-09-29T12:00:00.000Z",
    };
    const text = formatFollowupDescription(snapshot, "Call Karen");
    expect(text).toContain("Gap Analysis");
    expect(text).toContain("Stopped Buying");
    expect(text).toContain("Call Karen");
    expect(text.length).toBeLessThan(1200);
  });
});
