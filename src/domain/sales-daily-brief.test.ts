import { describe, expect, it } from "vitest";
import {
  activityStatus,
  formatLondonBriefDate,
  formatPurchaseDateLabel,
  humanComparisonPhrase,
  humanPriorityLabel,
  isDeclineOnlyAttention,
  isEarlyCalendarPeriod,
  isNewCustomerToday,
  isReturnedCustomerFromCadence,
  londonDayGreeting,
  personalisedGreetingLine,
  pickDailyBriefPriorities,
  pickNeedsAttention,
  presentOpportunityLine,
  previousLondonCivilDay,
  toAttentionItem,
} from "@/domain/sales-daily-brief";
import type { PortfolioCustomerRow, PortfolioOpportunity } from "@/domain/sales-portfolio";

function row(
  partial: Partial<PortfolioCustomerRow> & Pick<PortfolioCustomerRow, "companyId" | "companyName">,
): PortfolioCustomerRow {
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

  it("formats UK relative purchase dates", () => {
    expect(formatPurchaseDateLabel("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(formatPurchaseDateLabel("2026-10-01", "2026-10-01")).toBe("Today");
    expect(formatPurchaseDateLabel("2026-09-15", "2026-10-01")).toBe("15/09/2026");
  });

  it("human comparison labels for calendar periods", () => {
    expect(humanComparisonPhrase("THIS_MONTH")).toBe("same point last month");
    expect(humanComparisonPhrase("THIS_QUARTER")).toBe("same point last quarter");
    expect(humanComparisonPhrase("THIS_YEAR")).toBe("same point last year");
    expect(humanComparisonPhrase("LAST_30")).toBe("previous 30 days");
  });

  it("detects early calendar period for THIS_* within 3 days", () => {
    expect(isEarlyCalendarPeriod({ periodKey: "THIS_MONTH", elapsedDays: 1 })).toBe(true);
    expect(isEarlyCalendarPeriod({ periodKey: "THIS_MONTH", elapsedDays: 3 })).toBe(true);
    expect(isEarlyCalendarPeriod({ periodKey: "THIS_MONTH", elapsedDays: 4 })).toBe(false);
    expect(isEarlyCalendarPeriod({ periodKey: "LAST_30", elapsedDays: 1 })).toBe(false);
  });

  it("suppresses decline-only priorities in early period; keeps dormant/gap/stopped", () => {
    const declineOnly = row({
      companyId: "dec",
      companyName: "Decline Only",
      needsAttention: true,
      declining: true,
      attentionReasons: [
        { code: "DECLINING", label: "Declining", explanation: "Material sales decline…" },
      ],
      currentNetSales: "16.66",
    });
    const dormant = row({
      companyId: "dorm",
      companyName: "Dormant Co",
      needsAttention: true,
      dormant: true,
      attentionReasons: [{ code: "DORMANT", label: "Dormant", explanation: "dormant" }],
    });
    const gap = row({
      companyId: "gap",
      companyName: "Gap Co",
      needsAttention: true,
      attentionReasons: [
        { code: "PURCHASE_GAP", label: "Purchase gap", explanation: "gap" },
      ],
    });
    const stopped = row({
      companyId: "stop",
      companyName: "Stopped Co",
      needsAttention: true,
      significantStoppedBuying: true,
      attentionReasons: [
        { code: "STOPPED_BUYING", label: "Stopped buying", explanation: "stopped" },
      ],
    });
    const declinePlusGap = row({
      companyId: "both",
      companyName: "Both Co",
      needsAttention: true,
      attentionReasons: [
        { code: "PURCHASE_GAP", label: "Purchase gap", explanation: "gap" },
        { code: "DECLINING", label: "Declining", explanation: "decline" },
      ],
    });

    expect(isDeclineOnlyAttention(declineOnly.attentionReasons)).toBe(true);

    const early = pickDailyBriefPriorities(
      [declineOnly, dormant, gap, stopped, declinePlusGap],
      { earlyPeriod: true, limit: 10 },
    );
    expect(early.map((r) => r.companyId).sort()).toEqual(["both", "dorm", "gap", "stop"]);

    const late = pickDailyBriefPriorities([declineOnly, dormant], {
      earlyPeriod: false,
      limit: 10,
    });
    expect(late.map((r) => r.companyId)).toContain("dec");
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
      attentionReasons: [{ code: "DORMANT", label: "Dormant", explanation: "dormant" }],
      currentNetSales: "50",
    });
    const decline = row({
      companyId: "c",
      companyName: "Decline Co",
      needsAttention: true,
      attentionReasons: [{ code: "DECLINING", label: "Declining", explanation: "decline" }],
      currentNetSales: "500",
    });
    const picked = pickNeedsAttention([oppOnly, decline, dormant], 5);
    expect(picked.map((r) => r.companyId)).toEqual(["d", "c"]);
    expect(toAttentionItem(picked[0]!, {
      purchasedToday: false,
      todayNetSales: null,
      todayUnits: null,
      todayProducts: null,
      comparisonPhrase: "same point last month",
      periodShortLabel: "this month",
    }).attentionReasons[0]!.code).toBe("DORMANT");
  });

  it("human priority labels avoid analyst jargon", () => {
    expect(humanPriorityLabel("DORMANT")).toBe("Customer gone quiet");
    expect(humanPriorityLabel("PURCHASE_GAP")).toBe("Purchase gap");
    expect(humanPriorityLabel("DECLINING")).toBe("Sales lower than usual");
    expect(humanPriorityLabel("STOPPED_BUYING")).toBe("Products worth checking");
  });

  it("presents cross-sell with product name primary and soft evidence", () => {
    const opp: PortfolioOpportunity = {
      type: "CROSS_SELL",
      title: "Cross-sell — PMCUS500",
      explanation: "8 of 8 comparable customers who bought TFR5000 also bought PMCUS500 (100%).",
      sku: "PMCUS500",
      seedSku: "TFR5000",
      evidenceNumerator: 8,
      evidenceDenominator: 8,
    };
    const line = presentOpportunityLine(opp, {
      productName: "Power Maxed Citrus Wash 500ml",
      seedLabel: "TFR5000",
      earlyPeriod: false,
    });
    expect(line.productLabel).toBe("Power Maxed Citrus Wash 500ml");
    expect(line.primaryText).toMatch(/Often bought by customers who also buy TFR5000/);
    expect(line.secondaryText).toMatch(/8 of 8 customers in this comparison group/);
    expect(line.sku).toBe("PMCUS500");
  });

  it("softens not-bought-this-period language in early period", () => {
    const opp: PortfolioOpportunity = {
      type: "STOPPED_PRODUCT",
      title: "8 not bought this period",
      explanation: "SKU(s) bought in the comparable period have no invoice purchase yet…",
    };
    const line = presentOpportunityLine(opp, { earlyPeriod: true });
    expect(line.productLabel.toLowerCase()).toMatch(/keep an eye on/);
    expect(line.primaryText.toLowerCase()).not.toMatch(/≥/);
  });

  it("falls back to SKU when no catalogue product name", () => {
    const opp: PortfolioOpportunity = {
      type: "CROSS_SELL",
      title: "Cross-sell — HISTSKU",
      explanation: "…",
      sku: "HISTSKU",
      seedSku: "SEED1",
      evidenceNumerator: 8,
      evidenceDenominator: 8,
    };
    const line = presentOpportunityLine(opp, { productName: null, earlyPeriod: false });
    expect(line.productLabel).toBe("HISTSKU");
  });

  it("priority summary leads with ordered today when purchased today", () => {
    const item = toAttentionItem(
      row({
        companyId: "x",
        companyName: "Street Rhino",
        needsAttention: true,
        typicalIntervalDays: 1,
        daysSinceLastPurchase: 0,
        currentNetSales: "266.99",
        movement: "-400.13",
        movementPercent: -60,
        attentionReasons: [
          { code: "DECLINING", label: "Declining", explanation: "Material sales decline (≥ £100…)" },
        ],
      }),
      {
        purchasedToday: true,
        todayNetSales: "266.99",
        todayUnits: 14,
        todayProducts: 8,
        comparisonPhrase: "same point last month",
        periodShortLabel: "this month",
      },
    );
    expect(item.summaryLines[0]).toMatch(/Ordered today/);
    expect(item.summaryLines.join(" ")).not.toMatch(/≥/);
    expect(item.summaryLines.join(" ").toLowerCase()).not.toMatch(/comparable period/);
  });

  it("detects returned customer after dormant gap, not normal cadence", () => {
    const today = "2026-10-01";
    const dormantDates = [
      "2025-12-01",
      "2025-12-29",
      "2026-01-26",
      "2026-02-23",
      "2026-06-01",
      today,
    ];
    const returned = isReturnedCustomerFromCadence({
      invoicePurchaseDates: dormantDates,
      today,
    });
    expect(returned.returned).toBe(true);
    expect(returned.daysInactive).toBeGreaterThan(45);

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

  it("personalised greeting uses first name", () => {
    expect(personalisedGreetingLine("Luke Radford")).toMatch(/, Luke$/);
    expect(["Good morning", "Good afternoon", "Good evening"]).toContain(londonDayGreeting());
  });
});
