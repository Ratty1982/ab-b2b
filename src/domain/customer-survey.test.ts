import { describe, expect, it } from "vitest";
import {
  SURVEY_QUESTION_NUMBERS,
  customerSurveySubmissionSchema,
  csvCell,
  isPrizeDrawOpen,
  londonDateTime,
  netPromoterScore,
  averageExcludingNa,
  averageRecommendation,
  normaliseSalesHelp,
  parseWordpressSurveyCsv,
  prizeDrawCustomerMessage,
  decidePrizeDrawEntry,
  surveyLayout,
  surveyProgress,
  requiredSurveyFieldCount,
} from "@/domain/customer-survey";

const base = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  submissionToken: "browser-token-0001",
  website: "",
  overallSatisfaction: 5,
  recommendationScore: 9,
  productQuality: 4,
  productConsistency: 4,
  productRange: 0,
  productShelfAppearance: 3,
  customerService: 5,
  marketingSupport: 4,
  marketingChannelWebsite: 5,
  marketingChannelSocial: 0,
  marketingChannelPos: 3,
  marketingChannelCampaigns: 2,
  marketingChannelMedia: 1,
  salesHelpOptions: ["counter_top_displays"],
  communication: 4,
  responseTime: 4,
  complaintHandling: 0,
  orderingDelivery: 5,
  orderAccuracy: 5,
  packagingCondition: 4,
  speedDelivery: 4,
  documentation: 3,
  environmentalImportance: 4,
  environmentalRating: 0,
  doWell: "",
  couldImprove: "",
  productRequests: "",
  additionalComments: "",
  contactPermission: "no" as const,
  prizeDrawEntry: "no" as const,
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  businessName: "",
  ukResidentAdultConfirmed: false,
  notConnectedConfirmed: false,
  termsAccepted: false,
};

describe("customer survey domain", () => {
  it("keeps all 26 numbered questions", () => {
    expect(SURVEY_QUESTION_NUMBERS).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
    expect(requiredSurveyFieldCount()).toBe(25);
  });

  it("accepts an anonymous response and rejects a missing rating", () => {
    expect(customerSurveySubmissionSchema.safeParse(base).success).toBe(true);
    const missing = customerSurveySubmissionSchema.safeParse({
      ...base,
      overallSatisfaction: undefined,
    });
    expect(missing.success).toBe(false);
  });

  it("requires contact details only when contact is requested", () => {
    const missing = customerSurveySubmissionSchema.safeParse({ ...base, contactPermission: "yes" });
    expect(missing.success).toBe(false);
    const present = customerSurveySubmissionSchema.safeParse({
      ...base,
      contactPermission: "yes",
      customerName: "Alex Customer",
      customerEmail: "alex@example.invalid",
    });
    expect(present.success).toBe(true);
  });

  it("keeps None of these exclusive and caps sales support at three", () => {
    expect(normaliseSalesHelp(["none", "other"])).toEqual(["none"]);
    expect(
      normaliseSalesHelp(["other", "product_training", "samples_giveaways", "social_media_posts"]),
    ).toHaveLength(3);
    const mixed = customerSurveySubmissionSchema.safeParse({
      ...base,
      salesHelpOptions: ["none", "other"],
    });
    expect(mixed.success).toBe(false);
  });

  it("opens the prize draw only inside the published UK window", () => {
    expect(isPrizeDrawOpen(londonDateTime("2026-10-13", "12:00:00"))).toBe(false);
    expect(isPrizeDrawOpen(londonDateTime("2026-11-01", "00:00:59"))).toBe(false);
    expect(isPrizeDrawOpen(londonDateTime("2026-11-01", "00:01:00"))).toBe(true);
    expect(isPrizeDrawOpen(londonDateTime("2027-01-31", "23:59:59"))).toBe(true);
    expect(isPrizeDrawOpen(londonDateTime("2027-02-01", "00:00:00"))).toBe(false);
  });

  it("rejects a closed prize draw without blocking the survey decision path", () => {
    const decision = decidePrizeDrawEntry(
      { ...base, prizeDrawEntry: "yes" },
      londonDateTime("2026-10-13", "09:00:00"),
    );
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("OUTSIDE_WINDOW");
    expect(prizeDrawCustomerMessage(decision)).toContain("not accepted");
  });

  it("requires eligibility declarations while the draw is open", () => {
    const at = londonDateTime("2026-11-15", "10:00:00");
    const incomplete = decidePrizeDrawEntry(
      {
        ...base,
        prizeDrawEntry: "yes",
        customerName: "Alex",
        customerEmail: "alex@example.invalid",
      },
      at,
    );
    expect(incomplete.reason).toBe("MISSING_ELIGIBILITY");
    const complete = decidePrizeDrawEntry(
      {
        ...base,
        prizeDrawEntry: "yes",
        customerName: "Alex",
        customerEmail: "alex@example.invalid",
        businessName: "Alex Motors",
        ukResidentAdultConfirmed: true,
        notConnectedConfirmed: true,
        termsAccepted: true,
      },
      at,
    );
    expect(complete.accepted).toBe(true);
  });

  it("calculates NPS separately from the average and ignores N/A ratings", () => {
    expect(netPromoterScore([10, 9, 7, 0])).toBe(25);
    expect(averageRecommendation([10, 0])).toBe(5);
    expect(averageExcludingNa([5, 0, 3])).toBe(4);
    expect(averageExcludingNa([0, 0])).toBeNull();
  });

  it("protects CSV cells from formula injection and parses a WordPress export", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("safe")).toBe("safe");
    const parsed = parseWordpressSurveyCsv(
      "id,submitted_at,overall_satisfaction\n12,2026-10-01 09:00:00,5\n",
    );
    expect(parsed.rows[0]?.["id"]).toBe("12");
    expect(parsed.rows[0]?.["overall_satisfaction"]).toBe("5");
  });

  it("uses a single-column touch-sized layout", () => {
    expect(surveyLayout.ratingGroup).toContain("grid-cols-1");
    expect(surveyLayout.control).toContain("min-h-11");
    expect(surveyLayout.page).toContain("px-4");
    expect(surveyLayout.page).toContain("sm:px-6");
    expect(surveyProgress(5, 10)).toBe(50);
  });
});
