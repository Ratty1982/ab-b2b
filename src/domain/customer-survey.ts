/**
 * Automotive Brands customer satisfaction survey.
 * Question wording and scales follow the WordPress survey this replaces.
 */
import { z } from "zod";

export const PRIZE_DRAW_OPENS_LONDON = "20261101000100";
export const PRIZE_DRAW_CLOSES_LONDON = "20270131235959";
export const PRIZE_DRAW_OPEN_LABEL = "00:01 on 01/11/2026";
export const PRIZE_DRAW_CLOSE_LABEL = "23:59 on 31/01/2027";

export const SURVEY_TEXT_MAX = 4000;
export const SURVEY_NAME_MAX = 255;
export const SURVEY_EMAIL_MAX = 255;
export const SURVEY_PHONE_MAX = 100;
export const SURVEY_TOKEN_LOCK_MS = 30 * 24 * 60 * 60 * 1000;
export const SURVEY_IP_WINDOW_MS = 60 * 60 * 1000;
export const SURVEY_IP_MAX_PER_WINDOW = 8;

export const SALES_HELP_OPTIONS = [
  { value: "counter_top_displays", label: "Counter-top displays" },
  { value: "shelf_edge_wobblers", label: "Shelf-edge wobblers or shelf talkers" },
  { value: "promotional_floor_displays", label: "Promotional or floor-standing displays" },
  { value: "product_demo_videos", label: "Product demonstration videos to play in-store" },
  { value: "product_info_leaflets", label: "Product information leaflets or display cards" },
  { value: "special_offers_campaigns", label: "Special offers and promotional campaigns" },
  { value: "social_media_posts", label: "Ready-made social media posts and images" },
  {
    value: "better_product_photos",
    label: "Better product photos and descriptions for my website",
  },
  { value: "product_training", label: "Product training or demonstrations for staff" },
  { value: "samples_giveaways", label: "Samples or consumer giveaways" },
  { value: "other", label: "Other" },
  { value: "none", label: "None of these at present" },
] as const;

export const SALES_HELP_VALUES = SALES_HELP_OPTIONS.map((option) => option.value);
export type SalesHelpValue = (typeof SALES_HELP_VALUES)[number];

const SATISFACTION_LABELS: Record<number, string> = {
  5: "Very satisfied",
  4: "Satisfied",
  3: "Neither satisfied nor dissatisfied",
  2: "Dissatisfied",
  1: "Very dissatisfied",
};

const USEFULNESS_LABELS: Record<number, string> = {
  5: "Very useful",
  4: "Useful",
  3: "Somewhat useful",
  2: "Slightly useful",
  1: "Not useful",
};

const IMPORTANCE_LABELS: Record<number, string> = {
  5: "Very important",
  4: "Important",
  3: "Neither important nor unimportant",
  2: "Slightly important",
  1: "Not important",
};

export const RATING_FIELDS = [
  "overallSatisfaction",
  "recommendationScore",
  "productQuality",
  "productConsistency",
  "productRange",
  "productShelfAppearance",
  "customerService",
  "marketingSupport",
  "marketingChannelWebsite",
  "marketingChannelSocial",
  "marketingChannelPos",
  "marketingChannelCampaigns",
  "marketingChannelMedia",
  "communication",
  "responseTime",
  "complaintHandling",
  "orderingDelivery",
  "orderAccuracy",
  "packagingCondition",
  "speedDelivery",
  "documentation",
  "environmentalImportance",
  "environmentalRating",
] as const;

export type RatingField = (typeof RATING_FIELDS)[number];

export type SurveyRatingQuestion = {
  kind: "rating";
  number: number;
  field: RatingField;
  section: string;
  prompt: string;
  help?: string;
  min: number;
  max: number;
  /** 0 is stored for N/A and is excluded from averages. */
  allowNa: boolean;
  naLabel?: string;
  labels: Record<number, string>;
};

export type SurveyQuestion =
  | SurveyRatingQuestion
  | {
      kind: "salesHelp";
      number: number;
      section: string;
      prompt: string;
      help: string;
    }
  | {
      kind: "text";
      number: number;
      section: string;
      field: "doWell" | "couldImprove" | "productRequests" | "additionalComments";
      prompt: string;
      placeholder: string;
    }
  | {
      kind: "yesNo";
      number: number;
      section: string;
      field: "contactPermission" | "prizeDrawEntry";
      prompt: string;
      help?: string;
      yesLabel: string;
      noLabel: string;
    };

const satisfaction = (
  number: number,
  section: string,
  field: RatingField,
  prompt: string,
  extra?: { help?: string; naLabel?: string },
): SurveyRatingQuestion => {
  const question: SurveyRatingQuestion = {
    kind: "rating",
    number,
    section,
    field,
    prompt,
    min: 0,
    max: 5,
    allowNa: true,
    naLabel: extra?.naLabel ?? "Not applicable",
    labels: SATISFACTION_LABELS,
  };
  if (extra?.help) question.help = extra.help;
  return question;
};

export const MARKETING_CHANNELS: Array<{ field: RatingField; label: string }> = [
  { field: "marketingChannelWebsite", label: "Automotive Brands website and product information" },
  { field: "marketingChannelSocial", label: "Automotive Brands social media content" },
  { field: "marketingChannelPos", label: "In-store point-of-sale materials" },
  { field: "marketingChannelCampaigns", label: "Promotional campaigns and offers" },
  { field: "marketingChannelMedia", label: "Product photos, videos and demonstrations" },
];

export const SURVEY_SECTIONS = [
  "Customer satisfaction and recommendation",
  "Products",
  "Customer service",
  "Marketing support",
  "Communication and response",
  "Ordering and delivery",
  "Information and documentation",
  "Environmental responsibility",
  "Written feedback",
  "Contact permission and prize draw",
] as const;

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  satisfaction(
    1,
    "Customer satisfaction and recommendation",
    "overallSatisfaction",
    "1. Overall how satisfied are you with the products and services you receive from Automotive Brands?",
  ),
  {
    kind: "rating",
    number: 2,
    section: "Customer satisfaction and recommendation",
    field: "recommendationScore",
    prompt: "2. How likely are you to recommend Automotive Brands to another business or customer?",
    help: "0 = Not at all likely    10 = Extremely likely",
    min: 0,
    max: 10,
    allowNa: false,
    labels: Object.fromEntries(Array.from({ length: 11 }, (_, score) => [score, String(score)])),
  },
  satisfaction(
    3,
    "Products",
    "productQuality",
    "3. How satisfied are you with the quality and performance of our products?",
  ),
  satisfaction(
    4,
    "Products",
    "productConsistency",
    "4. How satisfied are you with the consistency and reliability of our products?",
  ),
  satisfaction(
    5,
    "Products",
    "productRange",
    "5. How satisfied are you with our product range and availability?",
  ),
  satisfaction(
    6,
    "Products",
    "productShelfAppearance",
    "6. How satisfied are you with the look of our products on your shelf?",
  ),
  satisfaction(
    7,
    "Customer service",
    "customerService",
    "7. How satisfied are you with the service you receive from Automotive Brands?",
  ),
  satisfaction(
    8,
    "Marketing support",
    "marketingSupport",
    "8. Overall marketing support — How satisfied are you with the level of marketing support you receive from Automotive Brands?",
  ),
  ...MARKETING_CHANNELS.map((channel, index): SurveyRatingQuestion => {
    const question: SurveyRatingQuestion = {
      kind: "rating",
      number: 9,
      section: "Marketing support",
      field: channel.field,
      prompt: channel.label,
      min: 0,
      max: 5,
      allowNa: true,
      naLabel: "Haven't seen or used this",
      labels: USEFULNESS_LABELS,
    };
    if (index === 0) {
      question.help =
        "9. Our marketing channels — How useful are the following Automotive Brands marketing channels to your business? For each channel, select a usefulness rating or “Haven't seen or used this”.";
    }
    return question;
  }),
  {
    kind: "salesHelp",
    number: 10,
    section: "Marketing support",
    prompt:
      "10. What would help you sell more? — Which of the following would be most beneficial to increasing sales at your business? Select up to three.",
    help: "None of these at present cannot be combined with other choices.",
  },
  satisfaction(
    11,
    "Communication and response",
    "communication",
    "11. How satisfied are you with our communication?",
  ),
  satisfaction(
    12,
    "Communication and response",
    "responseTime",
    "12. How satisfied are you with the speed of our responses to enquiries or requests?",
  ),
  satisfaction(
    13,
    "Communication and response",
    "complaintHandling",
    "13. How satisfied are you with the way we handle problems, complaints or issues when they arise?",
  ),
  satisfaction(
    14,
    "Ordering and delivery",
    "orderingDelivery",
    "14. How satisfied are you with our ordering system and service?",
  ),
  satisfaction(
    15,
    "Ordering and delivery",
    "orderAccuracy",
    "15. How satisfied are you with the accuracy and completeness of your orders?",
  ),
  satisfaction(
    16,
    "Ordering and delivery",
    "packagingCondition",
    "16. How satisfied are you with our packaging and the condition of goods on arrival?",
  ),
  satisfaction(
    17,
    "Ordering and delivery",
    "speedDelivery",
    "17. How satisfied are you with the speed at which your orders are delivered?",
  ),
  satisfaction(
    18,
    "Information and documentation",
    "documentation",
    "18. How satisfied are you with the information and documentation we provide?",
  ),
  {
    kind: "rating",
    number: 19,
    section: "Environmental responsibility",
    field: "environmentalImportance",
    prompt:
      "19. How important is it to you that Automotive Brands actively manages and reduces the environmental impact of its operations?",
    min: 1,
    max: 5,
    allowNa: false,
    labels: IMPORTANCE_LABELS,
  },
  satisfaction(
    20,
    "Environmental responsibility",
    "environmentalRating",
    "20. How would you rate Automotive Brands’s environmental responsibility?",
    {
      help: "Please select “Not enough information” if you do not feel able to assess this.",
      naLabel: "Not enough information",
    },
  ),
  {
    kind: "text",
    number: 21,
    section: "Written feedback",
    field: "doWell",
    prompt: "21. What do you think Automotive Brands does particularly well?",
    placeholder: "Tell us what you value about Automotive Brands...",
  },
  {
    kind: "text",
    number: 22,
    section: "Written feedback",
    field: "couldImprove",
    prompt: "22. What is the one thing you think Automotive Brands could do better?",
    placeholder: "Your honest feedback is appreciated...",
  },
  {
    kind: "text",
    number: 23,
    section: "Written feedback",
    field: "productRequests",
    prompt: "23. Are there any products or services you would like us to introduce or improve?",
    placeholder: "Tell us what you would like to see...",
  },
  {
    kind: "text",
    number: 24,
    section: "Written feedback",
    field: "additionalComments",
    prompt: "24. Is there anything else you would like to tell us?",
    placeholder: "Any other comments or feedback...",
  },
  {
    kind: "yesNo",
    number: 25,
    section: "Contact permission and prize draw",
    field: "contactPermission",
    prompt:
      "25. Would you be happy for a member of the Automotive Brands team to contact you regarding your feedback?",
    yesLabel: "Yes",
    noLabel: "No",
  },
  {
    kind: "yesNo",
    number: 26,
    section: "Contact permission and prize draw",
    field: "prizeDrawEntry",
    prompt: "26. Would you like to enter our free prize draw?",
    help: "Entry is optional. If you choose to enter, we will use the contact details you provide for the purpose of administering the prize draw.",
    yesLabel: "Yes, enter me",
    noLabel: "No, thank you",
  },
];

/** Numbered questions 1–26. Marketing channels are sub-parts of question 9. */
export const SURVEY_QUESTION_NUMBERS = [
  ...new Set(SURVEY_QUESTIONS.map((question) => question.number)),
];

export const AVERAGE_GROUPS: Array<{
  id: string;
  label: string;
  fields: RatingField[];
  excludeNa: boolean;
}> = [
  {
    id: "overall",
    label: "Overall satisfaction",
    fields: ["overallSatisfaction"],
    excludeNa: true,
  },
  {
    id: "products",
    label: "Products",
    fields: ["productQuality", "productConsistency", "productRange", "productShelfAppearance"],
    excludeNa: true,
  },
  { id: "service", label: "Customer service", fields: ["customerService"], excludeNa: true },
  {
    id: "marketing",
    label: "Marketing support",
    fields: [
      "marketingSupport",
      "marketingChannelWebsite",
      "marketingChannelSocial",
      "marketingChannelPos",
      "marketingChannelCampaigns",
      "marketingChannelMedia",
    ],
    excludeNa: true,
  },
  {
    id: "communication",
    label: "Communication and response",
    fields: ["communication", "responseTime", "complaintHandling"],
    excludeNa: true,
  },
  {
    id: "ordering",
    label: "Ordering and delivery",
    fields: ["orderingDelivery", "orderAccuracy", "packagingCondition", "speedDelivery"],
    excludeNa: true,
  },
  {
    id: "documentation",
    label: "Information and documentation",
    fields: ["documentation"],
    excludeNa: true,
  },
  {
    id: "environment",
    label: "Environmental responsibility",
    fields: ["environmentalImportance", "environmentalRating"],
    excludeNa: true,
  },
];

const optionalText = z.string().trim().max(SURVEY_TEXT_MAX).default("");

export const customerSurveySubmissionSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    submissionToken: z.string().trim().min(16).max(80),
    website: z.string().max(200).optional().default(""),
    overallSatisfaction: z.number().int().min(0).max(5),
    recommendationScore: z.number().int().min(0).max(10),
    productQuality: z.number().int().min(0).max(5),
    productConsistency: z.number().int().min(0).max(5),
    productRange: z.number().int().min(0).max(5),
    productShelfAppearance: z.number().int().min(0).max(5),
    customerService: z.number().int().min(0).max(5),
    marketingSupport: z.number().int().min(0).max(5),
    marketingChannelWebsite: z.number().int().min(0).max(5),
    marketingChannelSocial: z.number().int().min(0).max(5),
    marketingChannelPos: z.number().int().min(0).max(5),
    marketingChannelCampaigns: z.number().int().min(0).max(5),
    marketingChannelMedia: z.number().int().min(0).max(5),
    salesHelpOptions: z
      .array(z.enum(SALES_HELP_VALUES as [SalesHelpValue, ...SalesHelpValue[]]))
      .max(12)
      .default([]),
    communication: z.number().int().min(0).max(5),
    responseTime: z.number().int().min(0).max(5),
    complaintHandling: z.number().int().min(0).max(5),
    orderingDelivery: z.number().int().min(0).max(5),
    orderAccuracy: z.number().int().min(0).max(5),
    packagingCondition: z.number().int().min(0).max(5),
    speedDelivery: z.number().int().min(0).max(5),
    documentation: z.number().int().min(0).max(5),
    environmentalImportance: z.number().int().min(1).max(5),
    environmentalRating: z.number().int().min(0).max(5),
    doWell: optionalText,
    couldImprove: optionalText,
    productRequests: optionalText,
    additionalComments: optionalText,
    contactPermission: z.enum(["yes", "no"]),
    prizeDrawEntry: z.enum(["yes", "no"]),
    customerName: z.string().trim().max(SURVEY_NAME_MAX).default(""),
    customerEmail: z.string().trim().max(SURVEY_EMAIL_MAX).default(""),
    customerPhone: z.string().trim().max(SURVEY_PHONE_MAX).default(""),
    businessName: z.string().trim().max(SURVEY_NAME_MAX).default(""),
    ukResidentAdultConfirmed: z.boolean().default(false),
    notConnectedConfirmed: z.boolean().default(false),
    termsAccepted: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    const options = [...new Set(input.salesHelpOptions)];
    if (options.includes("none") && options.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["salesHelpOptions"],
        message: "None of these at present cannot be combined with other choices.",
      });
    }
    if (!options.includes("none") && options.length > 3) {
      ctx.addIssue({
        code: "custom",
        path: ["salesHelpOptions"],
        message: "Select up to three choices.",
      });
    }
    const needsContact = input.contactPermission === "yes";
    if (needsContact) {
      if (!input.customerName) {
        ctx.addIssue({
          code: "custom",
          path: ["customerName"],
          message: "Please provide your name so that we can contact you.",
        });
      }
      if (!isSurveyEmail(input.customerEmail)) {
        ctx.addIssue({
          code: "custom",
          path: ["customerEmail"],
          message: "Please provide a valid email address.",
        });
      }
    } else if (input.customerEmail && !isSurveyEmail(input.customerEmail)) {
      ctx.addIssue({
        code: "custom",
        path: ["customerEmail"],
        message: "Please provide a valid email address.",
      });
    }
  });

export type CustomerSurveySubmission = z.infer<typeof customerSurveySubmissionSchema>;

export function isSurveyEmail(value: string): boolean {
  return z.string().trim().email().max(SURVEY_EMAIL_MAX).safeParse(value).success;
}

export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function londonTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return `${read("year")}${read("month")}${read("day")}${hour}${read("minute")}${read("second")}`;
}

export function isPrizeDrawOpen(at: Date): boolean {
  const stamp = londonTimestamp(at);
  return stamp >= PRIZE_DRAW_OPENS_LONDON && stamp <= PRIZE_DRAW_CLOSES_LONDON;
}

/** Interpret a calendar date and clock time as Europe/London. */
export function londonDateTime(isoDate: string, time: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  let utc = Date.UTC(year!, (month ?? 1) - 1, day, hour, minute, second ?? 0);
  const want = `${isoDate.replaceAll("-", "")}${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}${String(second ?? 0).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stamp = londonTimestamp(new Date(utc));
    if (stamp === want) return new Date(utc);
    const got = Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(8, 10)),
      Number(stamp.slice(10, 12)),
      Number(stamp.slice(12, 14)),
    );
    const target = Date.UTC(year!, (month ?? 1) - 1, day, hour, minute, second ?? 0);
    utc += target - got;
  }
  return new Date(utc);
}

export function londonDayBounds(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const bounds: { gte?: Date; lte?: Date } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) bounds.gte = londonDateTime(from, "00:00:00");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) bounds.lte = londonDateTime(to, "23:59:59");
  return bounds;
}

export type PrizeDrawDecision = {
  requested: boolean;
  accepted: boolean;
  reason:
    | null
    | "OUTSIDE_WINDOW"
    | "MISSING_CONTACT"
    | "MISSING_ELIGIBILITY"
    | "DUPLICATE_EMAIL"
    | "DUPLICATE_BUSINESS";
};

export function decidePrizeDrawEntry(
  input: Pick<
    CustomerSurveySubmission,
    | "prizeDrawEntry"
    | "customerName"
    | "customerEmail"
    | "businessName"
    | "ukResidentAdultConfirmed"
    | "notConnectedConfirmed"
    | "termsAccepted"
  >,
  at: Date,
): PrizeDrawDecision {
  if (input.prizeDrawEntry !== "yes") return { requested: false, accepted: false, reason: null };
  if (!isPrizeDrawOpen(at)) return { requested: true, accepted: false, reason: "OUTSIDE_WINDOW" };
  if (!input.customerName.trim() || !isSurveyEmail(input.customerEmail)) {
    return { requested: true, accepted: false, reason: "MISSING_CONTACT" };
  }
  if (
    !input.businessName.trim() ||
    !input.ukResidentAdultConfirmed ||
    !input.notConnectedConfirmed ||
    !input.termsAccepted
  ) {
    return { requested: true, accepted: false, reason: "MISSING_ELIGIBILITY" };
  }
  return { requested: true, accepted: true, reason: null };
}

export function prizeDrawCustomerMessage(decision: PrizeDrawDecision): string | null {
  if (!decision.requested) return null;
  if (decision.accepted) return "Your free prize draw entry has been accepted.";
  if (decision.reason === "OUTSIDE_WINDOW") {
    return `The free prize draw is only open from ${PRIZE_DRAW_OPEN_LABEL} to ${PRIZE_DRAW_CLOSE_LABEL} UK time. Your survey response has been saved, and this prize draw entry was not accepted.`;
  }
  if (decision.reason === "DUPLICATE_EMAIL" || decision.reason === "DUPLICATE_BUSINESS") {
    return "Your survey response has been saved. This prize draw entry was not accepted because an entry already exists for this person or business.";
  }
  if (decision.reason === "MISSING_CONTACT") {
    return "Please provide your name and email address so that we can administer the prize draw.";
  }
  return "Please confirm the prize draw eligibility statements, accept the terms, and provide your business name.";
}

/**
 * Net Promoter Score: promoters (9–10) minus detractors (0–6), as a percentage
 * of scored responses. This is not the average recommendation score.
 * Returns null when there are no scores. Rounded to one decimal place.
 */
export function netPromoterScore(scores: number[]): number | null {
  const valid = scores.filter((score) => Number.isInteger(score) && score >= 0 && score <= 10);
  if (valid.length === 0) return null;
  const promoters = valid.filter((score) => score >= 9).length;
  const detractors = valid.filter((score) => score <= 6).length;
  return Math.round(((promoters - detractors) / valid.length) * 100 * 10) / 10;
}

export function averageExcludingNa(values: number[]): number | null {
  const scored = values.filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, value) => sum + value, 0);
  return Math.round((total / scored.length) * 100) / 100;
}

export function averageRecommendation(scores: number[]): number | null {
  const valid = scores.filter((score) => Number.isInteger(score) && score >= 0 && score <= 10);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, value) => sum + value, 0);
  return Math.round((total / valid.length) * 10) / 10;
}

export function formatStoredRating(field: RatingField, value: number): string {
  if (field === "recommendationScore") return `${value}/10`;
  if (field === "environmentalImportance") return `${value}/5`;
  if (value === 0) {
    if (field === "environmentalRating") return "Not enough information";
    if (field.startsWith("marketingChannel")) return "Haven't seen or used this";
    return "N/A";
  }
  return `${value}/5`;
}

export function salesHelpLabel(value: string): string {
  return SALES_HELP_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function normaliseSalesHelp(values: string[]): SalesHelpValue[] {
  const allowed = new Set<string>(SALES_HELP_VALUES);
  const unique = [...new Set(values.filter((value) => allowed.has(value)))] as SalesHelpValue[];
  if (unique.includes("none")) return ["none"];
  return unique.slice(0, 3);
}

/** Touch-friendly public survey layout. Single column below the sm breakpoint. */
export const surveyLayout = {
  page: "mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12",
  section: "mt-8 border border-border bg-card p-4 sm:p-6",
  ratingGroup: "mt-3 grid grid-cols-1 gap-2",
  control:
    "flex min-h-11 w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm",
  textArea:
    "mt-2 min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-base",
} as const;

export function surveyProgress(answered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((answered / total) * 100)));
}

export function requiredSurveyFieldCount(): number {
  return SURVEY_QUESTIONS.filter(
    (question) => question.kind === "rating" || question.kind === "yesNo",
  ).length;
}

/** Prefix spreadsheet formulas so Excel does not execute exported cells. */
export function csvFormulaSafe(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}

export function csvCell(value: string | number | null | undefined): string {
  const safe = csvFormulaSafe(value);
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function buildSurveyCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export type WordpressSurveyCsvRow = Record<string, string>;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

export function parseWordpressSurveyCsv(text: string): {
  headers: string[];
  rows: WordpressSurveyCsvRow[];
} {
  const table = parseCsv(text);
  const headers = (table[0] ?? []).map((header) => header.trim());
  const rows = table.slice(1).map((cells) => {
    const record: WordpressSurveyCsvRow = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
  return { headers, rows };
}

const WP_RATING_COLUMNS: Record<string, RatingField> = {
  overall_satisfaction: "overallSatisfaction",
  recommendation_score: "recommendationScore",
  product_quality: "productQuality",
  product_consistency: "productConsistency",
  product_range: "productRange",
  product_shelf_appearance: "productShelfAppearance",
  customer_service: "customerService",
  marketing_support: "marketingSupport",
  marketing_channel_website: "marketingChannelWebsite",
  marketing_channel_social: "marketingChannelSocial",
  marketing_channel_pos: "marketingChannelPos",
  marketing_channel_campaigns: "marketingChannelCampaigns",
  marketing_channel_media: "marketingChannelMedia",
  communication: "communication",
  response_time: "responseTime",
  complaint_handling: "complaintHandling",
  ordering_delivery: "orderingDelivery",
  order_accuracy: "orderAccuracy",
  packaging_condition: "packagingCondition",
  speed_delivery: "speedDelivery",
  documentation: "documentation",
  environmental_importance: "environmentalImportance",
  environmental_rating: "environmentalRating",
};

export const WORDPRESS_EXPORT_HEADERS = [
  "id",
  "submitted_at",
  ...Object.keys(WP_RATING_COLUMNS),
  "sales_help_options",
  "do_well",
  "could_improve",
  "product_requests",
  "additional_comments",
  "contact_permission",
  "customer_name",
  "customer_email",
  "customer_phone",
  "prize_draw_entry",
  "ack_email_sent",
  "ack_email_sent_at",
];

export function wordpressRating(column: string, raw: string | undefined): number | null {
  const field = WP_RATING_COLUMNS[column];
  if (!field) return null;
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (field === "recommendationScore") return value >= 0 && value <= 10 ? value : null;
  if (field === "environmentalImportance") return value >= 1 && value <= 5 ? value : null;
  return value >= 0 && value <= 5 ? value : null;
}

export { WP_RATING_COLUMNS };
