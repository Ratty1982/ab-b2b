import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "@/domain/role-permissions";
import {
  acceptsLegacyPayload,
  defaultSurveyDocument,
  displayStoredAnswer,
  dynamicRatingReports,
  interpretSurveySubmission,
  legacyRatingValue,
  newSurveyQuestion,
  numberedQuestionCount,
  usesLegacySurveyForm,
  validateSurveyDocument,
  type SurveyAnswerSnapshot,
  type SurveyDocument,
} from "@/domain/survey-definition";

const legacyPayload = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  submissionToken: "browser-token-0001",
  website: "",
  overallSatisfaction: 4,
  recommendationScore: 9,
  productQuality: 5,
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
  responseTime: 3,
  complaintHandling: 0,
  orderingDelivery: 5,
  orderAccuracy: 5,
  packagingCondition: 4,
  speedDelivery: 4,
  documentation: 3,
  environmentalImportance: 5,
  environmentalRating: 0,
  doWell: "",
  couldImprove: "",
  productRequests: "",
  additionalComments: "",
  contactPermission: "no",
  prizeDrawEntry: "no",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  businessName: "",
  ukResidentAdultConfirmed: false,
  notConnectedConfirmed: false,
  termsAccepted: false,
};

function optionalRating(document: SurveyDocument, required = false): SurveyDocument {
  const sectionId = document.sections[0]!.id;
  const number = Math.max(...document.questions.map((question) => question.number)) + 1;
  const extra = {
    ...newSurveyQuestion("rating", sectionId, number, document.questions.length),
    prompt: "How clear was the new product labelling?",
    required,
    min: 1,
    max: 10,
    allowNa: false,
  };
  return { ...document, questions: [...document.questions, extra] };
}

describe("survey definition", () => {
  it("seeds the current 26-question survey and keeps the legacy form", () => {
    const document = defaultSurveyDocument();
    const parsed = validateSurveyDocument(document);
    expect(parsed.ok).toBe(true);
    expect(numberedQuestionCount(document)).toBe(26);
    expect(usesLegacySurveyForm(document)).toBe(true);
    expect(acceptsLegacyPayload(document)).toBe(true);
  });

  it("rejects edits that remove, disable, or retype locked questions", () => {
    const document = defaultSurveyDocument();
    const removed = validateSurveyDocument({
      ...document,
      questions: document.questions.filter((question) => question.lockedRole !== "prize_draw"),
    });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.errors.join(" ")).toContain("prize draw question cannot be removed");

    const disabled = validateSurveyDocument({
      ...document,
      questions: document.questions.map((question) =>
        question.lockedRole === "contact_permission" ? { ...question, enabled: false } : question,
      ),
    });
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.errors.join(" ")).toContain("contact permission question must stay required");

    const retyped = validateSurveyDocument({
      ...document,
      questions: document.questions.map((question) =>
        question.lockedRole === "prize_draw" ? { ...question, kind: "text", required: true } : question,
      ),
    });
    expect(retyped.ok).toBe(false);
    if (!retyped.ok) expect(retyped.errors.join(" ")).toContain("Prize-draw terms");
  });

  it("validates settings and keeps an optional new question compatible with existing submissions", () => {
    const document = defaultSurveyDocument();
    const missingIntro = validateSurveyDocument({ ...document, introduction: [] });
    expect(missingIntro.ok).toBe(false);
    const badEmail = validateSurveyDocument({
      ...document,
      notificationRecipients: ["not-an-email"],
    });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.errors.join(" ")).toContain("not an email address");

    const optional = optionalRating(document, false);
    expect(validateSurveyDocument(optional).ok).toBe(true);
    expect(acceptsLegacyPayload(optional)).toBe(true);
    expect(usesLegacySurveyForm(optional)).toBe(false);

    const required = optionalRating(document, true);
    expect(acceptsLegacyPayload(required)).toBe(false);
    const rejected = interpretSurveySubmission(required, legacyPayload);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe("VALIDATION");
  });

  it("keeps stored wording and scales when a later question changes", () => {
    const original: SurveyAnswerSnapshot = {
      questionId: "overallSatisfaction",
      number: 1,
      kind: "rating",
      prompt: "Overall, how satisfied are you?",
      description: "",
      sectionHeading: "Overall",
      scale: { min: 0, max: 5, allowNa: true, naLabel: "N/A", labels: { "4": "Satisfied" } },
      options: null,
      value: 4,
    };
    const laterScale: SurveyAnswerSnapshot = {
      ...original,
      prompt: "Overall satisfaction on a new scale",
      scale: { min: 1, max: 10, allowNa: false, naLabel: "", labels: { "4": "Low" } },
      value: 4,
    };
    expect(displayStoredAnswer(original)).toBe("4/5 Satisfied");
    expect(displayStoredAnswer(laterScale)).toBe("4/10 Low");
    expect(legacyRatingValue(original)).toBe(4);
    expect(legacyRatingValue(laterScale)).toBeNull();
    expect(dynamicRatingReports([[original, laterScale]])).toEqual([
      {
        questionId: "overallSatisfaction",
        prompt: "Overall satisfaction on a new scale",
        scale: "1–10",
        average: 4,
        responses: 1,
      },
    ]);
  });

  it("closes a disabled survey and still accepts the original payload", () => {
    const closed = interpretSurveySubmission({ ...defaultSurveyDocument(), enabled: false }, legacyPayload);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe("CLOSED");

    const accepted = interpretSurveySubmission(defaultSurveyDocument(), legacyPayload);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.submission.ratings.overallSatisfaction).toBe(4);
      expect(accepted.submission.snapshots.some((answer) => answer.questionId === "prizeDrawEntry")).toBe(true);
    }

    const document = optionalRating(defaultSurveyDocument(), false);
    const extra = document.questions.find((question) => question.prompt.startsWith("How clear"))!;
    const dynamic = interpretSurveySubmission(document, {
      idempotencyKey: legacyPayload.idempotencyKey,
      submissionToken: legacyPayload.submissionToken,
      website: "",
      answers: document.questions
        .filter((question) => question.enabled)
        .map((question) => ({
          questionId: question.id,
          value:
            question.id === extra.id
              ? 8
              : question.id === "overallSatisfaction"
                ? 5
                : question.kind === "rating"
                  ? question.allowNa
                    ? 0
                    : question.min
                  : question.kind === "yes_no"
                    ? "no"
                    : question.kind === "checkbox"
                      ? ["none"]
                      : "",
        })),
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      businessName: "",
      ukResidentAdultConfirmed: false,
      notConnectedConfirmed: false,
      termsAccepted: false,
    });
    expect(dynamic.ok).toBe(true);
    if (dynamic.ok) {
      expect(dynamic.submission.ratings.overallSatisfaction).toBe(5);
      expect(dynamic.submission.snapshots.find((answer) => answer.questionId === extra.id)?.value).toBe(8);
    }
  });

  it("limits survey editing to Management and Super Admin", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.MANAGEMENT).toContain("surveys.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.SUPER_ADMIN).toContain("surveys.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.CUSTOMER_SERVICE).toContain("surveys.view");
    expect(SYSTEM_ROLE_PERMISSIONS.CUSTOMER_SERVICE).toContain("surveys.export");
    expect(SYSTEM_ROLE_PERMISSIONS.MARKETING).toContain("surveys.view");
    expect(SYSTEM_ROLE_PERMISSIONS.CUSTOMER_SERVICE.includes("surveys.manage")).toBe(false);
    expect(SYSTEM_ROLE_PERMISSIONS.MARKETING.includes("surveys.manage")).toBe(false);
    expect(SYSTEM_ROLE_PERMISSIONS.SALES_REPRESENTATIVE.includes("surveys.manage")).toBe(false);
  });
});
