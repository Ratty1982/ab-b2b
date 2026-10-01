import { describe, expect, it } from "vitest";
import {
  activityStatus,
  formatLondonBriefDate,
  isNewCustomerToday,
  isReturnedCustomerFromCadence,
  pickNeedsAttention,
  previousLondonCivilDay,
  toAttentionItem,
} from "@/domain/sales-daily-brief";
import type { PortfolioCustomerRow } from "@/domain/sales-portfolio";

function row(partial: Partial<PortfolioCustomerRow> & Pick<PortfolioCustomerRow, "companyId" | "companyName">): PortfolioCustomerRow {
  return {
    customerGroupId: null,
    customerGroupName: null,
    mamAccount: null,
    salesRepId: null,
    salesRepName: null,
    currentNetSales: "100",
    previousNetSales: "100",
    movement: "0",
    movementPercent: 0,
    declining: false,
    growing: false,
    lastPurchaseDate: null,
    typicalIntervalDays: null,
    daysSinceLastPurchase: null,
    cadenceSummary: "",
    cadenceIntervalLabel: "",
    cadenceLastPurchaseLabel: "",
    productsPurchased: 0,
    stoppedProductCount: 0,
    significantStoppedBuying: false,
    opportunityCount: 0,
    openFollowUpCount: 0,
    attentionReasons: [],
    needsAttention: false,
    dormant: false,
    opportunities: [],
    ...partial,
  };
}

describe("sales-daily-brief domain", () => {
  it("formats Europe/London long brief date", () => {
    expect(formatLondonBriefDate("2026-10-01")).toBe("Thursday, 1 October 2026");
  });

  it("previous London civil day is yesterday", () => {
    expect(previousLondonCivilDay("2026-10-01")).toBe("2026-09-30");
  });

  it("detects returned customer after dormant gap, not normal cadence", () => {
    // ~28 day cadence, last buy 90+ days before today → dormant → returned
    const today = "2026-10-01";
    const dormantDates = [
      "2025-12-01",
      "2025-12-29",
      "2026-01-26",
      "2026-02-23",
      "2026-06-01", // last before long gap
      today,
    ];
    const returned = isReturnedCustomerFromCadence({
      invoicePurchaseDates: dormantDates,
      today,
    });
    expect(returned.returned).toBe(true);
    expect(returned.daysInactive).toBeGreaterThan(45);

    // Normal ~7 day cadence, bought today after 8 days — purchase gap possible but not dormant
    const normal = isReturnedCustomerFromCadence({
      invoicePurchaseDates: [
        "2026-08-01",
        "2026-08-08",
        "2026-08-15",
        "2026-08-22",
        "2026-08-29",
        "2026-09-05",
        "2026-09-12",
        "2026-09-19",
        "2026-09-23",
        today,
      ],
      today,
    });
    expect(normal.returned).toBe(false);
  });

  it("credit-only / no today invoice is not returned", () => {
    const r = isReturnedCustomerFromCadence({
      invoicePurchaseDates: ["2026-01-01", "2026-02-01", "2026-03-01"],
      today: "2026-10-01",
    });
    expect(r.returned).toBe(false);
  });

  it("new today requires first invoice date = today", () => {
    expect(isNewCustomerToday(["2026-10-01"], "2026-10-01")).toBe(true);
    expect(isNewCustomerToday(["2026-09-01", "2026-10-01"], "2026-10-01")).toBe(false);
  });

  it("activity status priority: new > returned > growing > normal", () => {
    expect(activityStatus({ newToday: true, returned: true, growing: true })).toBe("NEW_TODAY");
    expect(activityStatus({ newToday: false, returned: true, growing: true })).toBe("RETURNED");
    expect(activityStatus({ newToday: false, returned: false, growing: true })).toBe("GROWING");
    expect(activityStatus({ newToday: false, returned: false, growing: false })).toBe(
      "NORMAL_ACTIVITY",
    );
  });

  it("pickNeedsAttention excludes opportunity-only and sorts by attention priority", () => {
    const oppOnly = row({
      companyId: "o",
      companyName: "Opp Only",
      needsAttention: false,
      opportunityCount: 3,
    });
    const dormant = row({
      companyId: "d",
      companyName: "Dormant Co",
      needsAttention: true,
      attentionReasons: [
        { code: "DORMANT", label: "Dormant", explanation: "dormant" },
      ],
      currentNetSales: "50",
    });
    const decline = row({
      companyId: "c",
      companyName: "Decline Co",
      needsAttention: true,
      attentionReasons: [
        { code: "DECLINING", label: "Declining", explanation: "decline" },
      ],
      currentNetSales: "500",
    });
    const picked = pickNeedsAttention([oppOnly, decline, dormant], 5);
    expect(picked.map((r) => r.companyId)).toEqual(["d", "c"]);
    expect(toAttentionItem(picked[0]!).attentionReasons[0]!.code).toBe("DORMANT");
  });
});
