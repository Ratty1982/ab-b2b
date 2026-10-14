/**
 * Editable customer survey definition.
 * Published versions are immutable. Answers keep the wording and scale from the version
 * they were submitted against.
 */
import { z } from "zod";
import {
  RATING_FIELDS,
  SALES_HELP_OPTIONS,
  SURVEY_EMAIL_MAX,
  SURVEY_NAME_MAX,
  SURVEY_PHONE_MAX,
  SURVEY_QUESTIONS,
  SURVEY_SECTIONS,
  SURVEY_TEXT_MAX,
  customerSurveySubmissionSchema,
  type CustomerSurveySubmission,
  type RatingField,
} from "@/domain/customer-survey";

export const SURVEY_QUESTION_KINDS = [
  "rating",
  "multiple_choice",
  "checkbox",
  "yes_no",
  "text",
] as const;

export type SurveyQuestionKind = (typeof SURVEY_QUESTION_KINDS)[number];
export type SurveyChoice = { value: string; label: string };

export type SurveyQuestionDefinition = {
  id: string;
  number: number;
  kind: SurveyQuestionKind;
  sectionId: string;
  prompt: string;
  description: string;
  required: boolean;
  enabled: boolean;
  sortOrder: number;
  min: number;
  max: number;
  allowNa: boolean;
  naLabel: string;
  labels: Record<string, string>;
  options: SurveyChoice[];
  maxSelections: number;
  exclusiveValues: string[];
  yesLabel: string;
  noLabel: string;
  placeholder: string;
  maxLength: number;
  groupId: string;
  groupPrompt: string;
  groupDescription: string;
  lockedRole: "" | "contact_permission" | "prize_draw";
};

export type SurveySectionDefinition = {
  id: string;
  heading: string;
  description: string;
  sortOrder: number;
};

export type SurveyDocument = {
  title: string;
  introduction: string[];
  durationLabel: string;
  thankYouTitle: string;
  thankYouParagraphs: string[];
  enabled: boolean;
  notifyOnSubmission: boolean;
  notificationRecipients: string[];
  sections: SurveySectionDefinition[];
  questions: SurveyQuestionDefinition[];
};

export type SurveyAnswerSnapshot = {
  questionId: string;
  number: number;
  kind: SurveyQuestionKind;
  prompt: string;
  description: string;
  sectionHeading: string;
  scale: {
    min: number;
    max: number;
    allowNa: boolean;
    naLabel: string;
    labels: Record<string, string>;
  } | null;
  options: SurveyChoice[] | null;
  value: number | string | string[] | null;
};

export const SURVEY_PRIVACY_PARAGRAPHS = [
  "Your feedback will be used by Automotive Brands Ltd for customer satisfaction monitoring, business improvement and our quality and environmental management systems.",
  "You do not need to provide your contact details unless you would like us to contact you about your feedback.",
] as const;

const LOCKED_ROLES = ["contact_permission", "prize_draw"] as const;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sectionIdForHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function labelsFrom(record: Record<number, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [String(key), value]));
}

function blankQuestion(
  partial: Partial<SurveyQuestionDefinition> &
    Pick<SurveyQuestionDefinition, "id" | "kind" | "prompt" | "sectionId" | "number" | "sortOrder">,
): SurveyQuestionDefinition {
  return {
    description: "",
    required: false,
    enabled: true,
    min: 1,
    max: 5,
    allowNa: false,
    naLabel: "Not applicable",
    labels: {},
    options: [],
    maxSelections: 1,
    exclusiveValues: [],
    yesLabel: "Yes",
    noLabel: "No",
    placeholder: "",
    maxLength: SURVEY_TEXT_MAX,
    groupId: "",
    groupPrompt: "",
    groupDescription: "",
    lockedRole: "",
    ...partial,
  };
}

export function defaultSurveyDocument(
  extras?: Partial<Pick<SurveyDocument, "notificationRecipients" | "notifyOnSubmission">>,
): SurveyDocument {
  const sections: SurveySectionDefinition[] = SURVEY_SECTIONS.map((heading, index) => ({
    id: sectionIdForHeading(heading),
    heading,
    description: "",
    sortOrder: index,
  }));
  const questions: SurveyQuestionDefinition[] = SURVEY_QUESTIONS.map((question, index) => {
    const sectionId = sectionIdForHeading(question.section);
    if (question.kind === "rating") {
      const group = question.field.startsWith("marketingChannel");
      return blankQuestion({
        id: question.field,
        number: question.number,
        kind: "rating",
        sectionId,
        prompt: question.prompt,
        description: group ? "" : (question.help ?? ""),
        required: true,
        enabled: true,
        sortOrder: index,
        min: question.min,
        max: question.max,
        allowNa: question.allowNa,
        naLabel: question.naLabel ?? "Not applicable",
        labels: labelsFrom(question.labels),
        groupId: group ? "marketing-channels" : "",
        groupPrompt: group
          ? "9. Our marketing channels — How useful are the following Automotive Brands marketing channels to your business?"
          : "",
        groupDescription: group
          ? "For each channel, select a usefulness rating or “Haven't seen or used this”."
          : "",
      });
    }
    if (question.kind === "salesHelp") {
      return blankQuestion({
        id: "salesHelpOptions",
        number: question.number,
        kind: "checkbox",
        sectionId,
        prompt: question.prompt,
        description: question.help,
        required: false,
        sortOrder: index,
        options: SALES_HELP_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
        maxSelections: 3,
        exclusiveValues: ["none"],
      });
    }
    if (question.kind === "text") {
      return blankQuestion({
        id: question.field,
        number: question.number,
        kind: "text",
        sectionId,
        prompt: question.prompt,
        required: false,
        sortOrder: index,
        placeholder: question.placeholder,
        maxLength: SURVEY_TEXT_MAX,
      });
    }
    return blankQuestion({
      id: question.field,
      number: question.number,
      kind: "yes_no",
      sectionId,
      prompt: question.prompt,
      description: question.help ?? "",
      required: true,
      sortOrder: index,
      yesLabel: question.yesLabel,
      noLabel: question.noLabel,
      lockedRole: question.field === "prizeDrawEntry" ? "prize_draw" : "contact_permission",
    });
  });

  return {
    title: "Customer Satisfaction Survey",
    introduction: [
      "At Automotive Brands, we are continually looking for ways to improve our products, service and the way we work with our customers.",
      "We would really appreciate a few minutes of your time to tell us how we are doing.",
    ],
    durationLabel: "Approximately 2–3 minutes",
    thankYouTitle: "Thank you for your feedback",
    thankYouParagraphs: [
      "We really appreciate you taking the time to share your experience with Automotive Brands.",
      "Your feedback helps us understand what we are doing well and where we can continue to improve.",
    ],
    enabled: true,
    notifyOnSubmission: extras?.notifyOnSubmission ?? true,
    notificationRecipients: extras?.notificationRecipients ?? [],
    sections,
    questions,
  };
}

interface LooseRecord {
  title?: unknown;
  introduction?: unknown;
  thankYouTitle?: unknown;
  thankYouParagraphs?: unknown;
  notificationRecipients?: unknown;
  durationLabel?: unknown;
  enabled?: unknown;
  notifyOnSubmission?: unknown;
  sections?: unknown;
  questions?: unknown;
  id?: unknown;
  heading?: unknown;
  description?: unknown;
  sortOrder?: unknown;
  kind?: unknown;
  prompt?: unknown;
  sectionId?: unknown;
  number?: unknown;
  required?: unknown;
  min?: unknown;
  max?: unknown;
  allowNa?: unknown;
  naLabel?: unknown;
  labels?: unknown;
  options?: unknown;
  maxSelections?: unknown;
  exclusiveValues?: unknown;
  yesLabel?: unknown;
  noLabel?: unknown;
  placeholder?: unknown;
  maxLength?: unknown;
  groupId?: unknown;
  groupPrompt?: unknown;
  groupDescription?: unknown;
  lockedRole?: unknown;
  value?: unknown;
  label?: unknown;
  answers?: unknown;
}

function asRecord(value: unknown): LooseRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as LooseRecord;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function choiceList(value: unknown): SurveyChoice[] {
  if (!Array.isArray(value)) return [];
  const choices: SurveyChoice[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const choiceValue = text(row.value, 80);
    const label = text(row.label, 300);
    if (!choiceValue || !label) continue;
    if (choices.some((choice) => choice.value === choiceValue)) continue;
    choices.push({ value: choiceValue, label });
  }
  return choices.slice(0, 30);
}

function stringMap(value: unknown): Record<string, string> {
  const row = asRecord(value);
  if (!row) return {};
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(row)) {
    if (!/^\d+$/.test(key)) continue;
    const cleaned = text(label, 200);
    if (cleaned) labels[key] = cleaned;
  }
  return labels;
}

export function numberedQuestionCount(document: SurveyDocument): number {
  return new Set(document.questions.filter((question) => question.enabled).map((question) => question.number)).size;
}

export function validateSurveyDocument(
  raw: unknown,
): { ok: true; document: SurveyDocument } | { ok: false; errors: string[] } {
  const row = asRecord(raw);
  if (!row) return { ok: false, errors: ["Survey settings are missing."] };
  const errors: string[] = [];
  const title = text(row.title, 160);
  if (!title) errors.push("Enter a survey title.");
  const introduction = Array.isArray(row.introduction)
    ? row.introduction.map((paragraph) => text(paragraph, 1000)).filter(Boolean).slice(0, 8)
    : [];
  if (introduction.length === 0) errors.push("Enter an introduction.");
  const thankYouTitle = text(row.thankYouTitle, 160);
  const thankYouParagraphs = Array.isArray(row.thankYouParagraphs)
    ? row.thankYouParagraphs.map((paragraph) => text(paragraph, 1000)).filter(Boolean).slice(0, 8)
    : [];
  if (!thankYouTitle) errors.push("Enter a thank-you heading.");
  if (thankYouParagraphs.length === 0) errors.push("Enter a thank-you message.");
  const recipients = Array.isArray(row.notificationRecipients)
    ? row.notificationRecipients.map((value) => text(value, 255).toLowerCase()).filter(Boolean)
    : [];
  for (const recipient of recipients) {
    if (!EMAIL_PATTERN.test(recipient)) errors.push(`Notification recipient ${recipient} is not an email address.`);
  }
  if (recipients.length > 20) errors.push("Use at most 20 notification recipients.");

  const sectionRows = Array.isArray(row.sections) ? row.sections : [];
  const sections: SurveySectionDefinition[] = [];
  sectionRows.forEach((entry, index) => {
    const section = asRecord(entry);
    if (!section) return;
    const id = text(section.id, 80);
    const heading = text(section.heading, 200);
    if (!ID_PATTERN.test(id)) {
      errors.push("Each section needs a valid id.");
      return;
    }
    if (!heading) errors.push("Each section needs a heading.");
    if (sections.some((item) => item.id === id)) errors.push(`Section ${id} is duplicated.`);
    sections.push({
      id,
      heading,
      description: text(section.description, 1000),
      sortOrder: int(section.sortOrder, index),
    });
  });
  if (sections.length === 0) errors.push("Add at least one section.");
  sections.sort((a, b) => a.sortOrder - b.sortOrder);
  sections.forEach((section, index) => {
    section.sortOrder = index;
  });

  const questionRows = Array.isArray(row.questions) ? row.questions : [];
  if (questionRows.length > 80) errors.push("A survey can contain at most 80 questions.");
  const questions: SurveyQuestionDefinition[] = [];
  questionRows.forEach((entry, index) => {
    const question = asRecord(entry);
    if (!question) return;
    const id = text(question.id, 64);
    const kind = text(question.kind, 40);
    if (!ID_PATTERN.test(id)) {
      errors.push("Each question needs a valid id.");
      return;
    }
    if (!(SURVEY_QUESTION_KINDS as readonly string[]).includes(kind)) {
      errors.push(`Question ${id} has an unsupported type.`);
      return;
    }
    const prompt = text(question.prompt, 1000);
    if (!prompt) errors.push(`Question ${id} needs wording.`);
    const sectionId = text(question.sectionId, 80);
    if (!sections.some((section) => section.id === sectionId)) {
      errors.push(`Question ${id} is not in a section.`);
    }
    const built = blankQuestion({
      id,
      number: int(question.number, index + 1),
      kind: kind as SurveyQuestionKind,
      sectionId,
      prompt,
      description: text(question.description, 1000),
      required: bool(question.required, false),
      enabled: bool(question.enabled, true),
      sortOrder: int(question.sortOrder, index),
      min: int(question.min, 1),
      max: int(question.max, 5),
      allowNa: bool(question.allowNa, false),
      naLabel: text(question.naLabel, 120) || "Not applicable",
      labels: stringMap(question.labels),
      options: choiceList(question.options),
      maxSelections: int(question.maxSelections, 1),
      exclusiveValues: Array.isArray(question.exclusiveValues)
        ? question.exclusiveValues.map((value) => text(value, 80)).filter(Boolean).slice(0, 5)
        : [],
      yesLabel: text(question.yesLabel, 80) || "Yes",
      noLabel: text(question.noLabel, 80) || "No",
      placeholder: text(question.placeholder, 200),
      maxLength: Math.min(SURVEY_TEXT_MAX, Math.max(1, int(question.maxLength, SURVEY_TEXT_MAX))),
      groupId: text(question.groupId, 80),
      groupPrompt: text(question.groupPrompt, 1000),
      groupDescription: text(question.groupDescription, 1000),
      lockedRole:
        question.lockedRole === "contact_permission" || question.lockedRole === "prize_draw"
          ? question.lockedRole
          : "",
    });
    if (questions.some((item) => item.id === id)) errors.push(`Question ${id} is duplicated.`);
    if (built.kind === "rating" && (built.min < 0 || built.max > 10 || built.min >= built.max)) {
      errors.push(`Question ${id} needs a rating scale between 0 and 10.`);
    }
    if ((built.kind === "multiple_choice" || built.kind === "checkbox") && built.options.length < 2) {
      errors.push(`Question ${id} needs at least two choices.`);
    }
    if (
      built.kind === "checkbox" &&
      (built.maxSelections < 1 || built.maxSelections > built.options.length)
    ) {
      errors.push(`Question ${id} has an invalid selection limit.`);
    }
    questions.push(built);
  });
  questions.sort((a, b) => a.sortOrder - b.sortOrder);
  questions.forEach((question, index) => {
    question.sortOrder = index;
  });

  for (const role of LOCKED_ROLES) {
    const matches = questions.filter((question) => question.lockedRole === role);
    if (matches.length !== 1) {
      errors.push(
        role === "prize_draw"
          ? "The prize draw question cannot be removed."
          : "The contact permission question cannot be removed.",
      );
      continue;
    }
    const question = matches[0]!;
    if (!question.enabled || question.kind !== "yes_no" || !question.required) {
      errors.push(
        role === "prize_draw"
          ? "The prize draw question must stay required. Prize-draw terms and eligibility declarations cannot be edited here."
          : "The contact permission question must stay required.",
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    document: {
      title,
      introduction,
      durationLabel: text(row.durationLabel, 80) || "Approximately 2–3 minutes",
      thankYouTitle,
      thankYouParagraphs,
      enabled: bool(row.enabled, true),
      notifyOnSubmission: bool(row.notifyOnSubmission, true),
      notificationRecipients: [...new Set(recipients)],
      sections,
      questions,
    },
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

export function usesLegacySurveyForm(document: SurveyDocument): boolean {
  const baseline = defaultSurveyDocument();
  return (
    JSON.stringify(stable({ sections: document.sections, questions: document.questions })) ===
    JSON.stringify(stable({ sections: baseline.sections, questions: baseline.questions }))
  );
}

export function acceptsLegacyPayload(document: SurveyDocument): boolean {
  if (!document.enabled) return false;
  const baseline = defaultSurveyDocument();
  for (const question of baseline.questions) {
    const current = document.questions.find((item) => item.id === question.id);
    if (!current?.enabled || current.kind !== question.kind || current.required !== question.required) {
      return false;
    }
    if (
      question.kind === "rating" &&
      (current.min !== question.min || current.max !== question.max || current.allowNa !== question.allowNa)
    ) {
      return false;
    }
    if (question.kind === "checkbox" || question.kind === "multiple_choice") {
      if (
        current.options.map((option) => option.value).join("|") !==
          question.options.map((option) => option.value).join("|") ||
        current.maxSelections !== question.maxSelections
      ) {
        return false;
      }
    }
  }
  return document.questions.every((question) => {
    if (!question.enabled || !question.required) return true;
    return baseline.questions.some((item) => item.id === question.id);
  });
}

function sectionHeading(document: SurveyDocument, sectionId: string): string {
  return document.sections.find((section) => section.id === sectionId)?.heading ?? "";
}

function snapshotFor(
  document: SurveyDocument,
  question: SurveyQuestionDefinition,
  value: number | string | string[] | null,
): SurveyAnswerSnapshot {
  return {
    questionId: question.id,
    number: question.number,
    kind: question.kind,
    prompt: question.prompt,
    description: question.description,
    sectionHeading: sectionHeading(document, question.sectionId),
    scale:
      question.kind === "rating"
        ? {
            min: question.min,
            max: question.max,
            allowNa: question.allowNa,
            naLabel: question.naLabel,
            labels: question.labels,
          }
        : null,
    options: question.kind === "multiple_choice" || question.kind === "checkbox" ? question.options : null,
    value,
  };
}

function originalRange(questionId: string): { min: number; max: number; allowNa: boolean } | null {
  const question = defaultSurveyDocument().questions.find((item) => item.id === questionId);
  if (!question || question.kind !== "rating") return null;
  return { min: question.min, max: question.max, allowNa: question.allowNa };
}

export function legacyRatingValue(answer: SurveyAnswerSnapshot): number | null {
  if (typeof answer.value !== "number") return null;
  if (!(RATING_FIELDS as readonly string[]).includes(answer.questionId)) return null;
  const original = originalRange(answer.questionId);
  if (!original || !answer.scale) return null;
  if (
    answer.scale.min !== original.min ||
    answer.scale.max !== original.max ||
    answer.scale.allowNa !== original.allowNa
  ) {
    return null;
  }
  return answer.value >= 0 && answer.value <= original.max ? answer.value : null;
}

export function displayStoredAnswer(answer: SurveyAnswerSnapshot): string {
  if (answer.value == null || answer.value === "") return "—";
  if (answer.kind === "rating" && typeof answer.value === "number") {
    if (answer.value === 0 && answer.scale?.allowNa) return answer.scale.naLabel || "N/A";
    const label = answer.scale?.labels[String(answer.value)];
    const max = answer.scale?.max;
    if (label && label !== String(answer.value)) return `${answer.value}/${max ?? ""} ${label}`.trim();
    return max == null ? String(answer.value) : `${answer.value}/${max}`;
  }
  if (Array.isArray(answer.value)) {
    return answer.value
      .map((value) => answer.options?.find((option) => option.value === value)?.label ?? value)
      .join(", ");
  }
  if (answer.kind === "yes_no") return answer.value === "yes" ? "Yes" : "No";
  if (typeof answer.value === "string") {
    return answer.options?.find((option) => option.value === answer.value)?.label ?? answer.value;
  }
  return String(answer.value);
}

function ratingAccepts(question: SurveyQuestionDefinition, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  if (question.allowNa && value === 0) return true;
  const low = question.allowNa ? Math.max(question.min, 1) : question.min;
  return value >= low && value <= question.max;
}

function answerValue(raw: unknown): number | string | string[] | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) return raw;
  return null;
}

export type InterpretedSurveySubmission = {
  idempotencyKey: string;
  submissionToken: string;
  website: string;
  snapshots: SurveyAnswerSnapshot[];
  ratings: Record<RatingField, number | null>;
  salesHelpOptions: string[];
  doWell: string;
  couldImprove: string;
  productRequests: string;
  additionalComments: string;
  contactPermission: "yes" | "no";
  prizeDrawEntry: "yes" | "no";
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  businessName: string;
  ukResidentAdultConfirmed: boolean;
  notConnectedConfirmed: boolean;
  termsAccepted: boolean;
};

function emptyRatings(): Record<RatingField, number | null> {
  return Object.fromEntries(RATING_FIELDS.map((field) => [field, null])) as Record<RatingField, number | null>;
}

function packSnapshots(
  contact: {
    idempotencyKey: string;
    submissionToken: string;
    website: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    businessName: string;
    ukResidentAdultConfirmed: boolean;
    notConnectedConfirmed: boolean;
    termsAccepted: boolean;
  },
  snapshots: SurveyAnswerSnapshot[],
): InterpretedSurveySubmission {
  const ratings = emptyRatings();
  for (const answer of snapshots) {
    const column = legacyRatingValue(answer);
    if (column != null) ratings[answer.questionId as RatingField] = column;
  }
  const readText = (id: string) => {
    const answer = snapshots.find((item) => item.questionId === id);
    return typeof answer?.value === "string" ? answer.value : "";
  };
  const sales = snapshots.find((item) => item.questionId === "salesHelpOptions");
  const contactAnswer = snapshots.find((item) => item.questionId === "contactPermission");
  const prizeAnswer = snapshots.find((item) => item.questionId === "prizeDrawEntry");
  return {
    idempotencyKey: contact.idempotencyKey,
    submissionToken: contact.submissionToken,
    website: contact.website,
    snapshots,
    ratings,
    salesHelpOptions: Array.isArray(sales?.value) ? sales.value : [],
    doWell: readText("doWell"),
    couldImprove: readText("couldImprove"),
    productRequests: readText("productRequests"),
    additionalComments: readText("additionalComments"),
    contactPermission: contactAnswer?.value === "yes" ? "yes" : "no",
    prizeDrawEntry: prizeAnswer?.value === "yes" ? "yes" : "no",
    customerName: contact.customerName,
    customerEmail: contact.customerEmail,
    customerPhone: contact.customerPhone,
    businessName: contact.businessName,
    ukResidentAdultConfirmed: contact.ukResidentAdultConfirmed,
    notConnectedConfirmed: contact.notConnectedConfirmed,
    termsAccepted: contact.termsAccepted,
  };
}

const dynamicSchema = z.object({
  idempotencyKey: z.string().uuid(),
  submissionToken: z.string().trim().min(16).max(80),
  website: z.string().max(200).optional().default(""),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(80),
        value: z.union([z.number(), z.string(), z.array(z.string()), z.null()]).optional(),
      }),
    )
    .max(100)
    .default([]),
  customerName: z.string().trim().max(SURVEY_NAME_MAX).default(""),
  customerEmail: z.string().trim().max(SURVEY_EMAIL_MAX).default(""),
  customerPhone: z.string().trim().max(SURVEY_PHONE_MAX).default(""),
  businessName: z.string().trim().max(SURVEY_NAME_MAX).default(""),
  ukResidentAdultConfirmed: z.boolean().default(false),
  notConnectedConfirmed: z.boolean().default(false),
  termsAccepted: z.boolean().default(false),
});

function interpretDynamic(
  document: SurveyDocument,
  raw: unknown,
):
  | { ok: true; submission: InterpretedSurveySubmission }
  | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const parsed = dynamicSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please complete all required questions before submitting the survey.",
      fieldErrors: {},
    };
  }
  const input = parsed.data;
  const provided = new Map(input.answers.map((answer) => [answer.questionId, answer.value ?? null]));
  const fieldErrors: Record<string, string> = {};
  const snapshots: SurveyAnswerSnapshot[] = [];
  for (const question of document.questions.filter((item) => item.enabled)) {
    const value = answerValue(provided.get(question.id));
    if (question.kind === "rating") {
      if (typeof value !== "number" || !ratingAccepts(question, value)) {
        if (question.required) fieldErrors[question.id] = "Please choose a rating.";
        continue;
      }
      snapshots.push(snapshotFor(document, question, value));
      continue;
    }
    if (question.kind === "yes_no") {
      if (value !== "yes" && value !== "no") {
        if (question.required) fieldErrors[question.id] = "Please choose yes or no.";
        continue;
      }
      snapshots.push(snapshotFor(document, question, value));
      continue;
    }
    if (question.kind === "text") {
      const textValue = typeof value === "string" ? value.trim().slice(0, question.maxLength) : "";
      if (question.required && !textValue) fieldErrors[question.id] = "Please complete this question.";
      snapshots.push(snapshotFor(document, question, textValue));
      continue;
    }
    if (question.kind === "multiple_choice") {
      const selected = typeof value === "string" ? value : "";
      if (!question.options.some((option) => option.value === selected)) {
        if (question.required) fieldErrors[question.id] = "Please choose an answer.";
        continue;
      }
      snapshots.push(snapshotFor(document, question, selected));
      continue;
    }
    const selected = Array.isArray(value) ? [...new Set(value)] : [];
    const allowed = new Set(question.options.map((option) => option.value));
    if (selected.some((item) => !allowed.has(item))) {
      fieldErrors[question.id] = "One of those choices is no longer available.";
      continue;
    }
    const exclusive = selected.find((item) => question.exclusiveValues.includes(item));
    if (exclusive && selected.length > 1) {
      fieldErrors[question.id] = "That choice cannot be combined with other choices.";
      continue;
    }
    if (!exclusive && selected.length > question.maxSelections) {
      fieldErrors[question.id] = `Select up to ${question.maxSelections} choices.`;
      continue;
    }
    if (question.required && selected.length === 0) fieldErrors[question.id] = "Please choose at least one answer.";
    snapshots.push(snapshotFor(document, question, selected));
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: "Please complete all required questions before submitting the survey.",
      fieldErrors,
    };
  }
  return { ok: true, submission: packSnapshots(input, snapshots) };
}

export function interpretSurveySubmission(
  document: SurveyDocument,
  raw: unknown,
):
  | { ok: true; submission: InterpretedSurveySubmission }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> } {
  if (!document.enabled) {
    return { ok: false, error: "This survey is not open at the moment.", code: "CLOSED" };
  }
  if (acceptsLegacyPayload(document)) {
    const parsed = customerSurveySubmissionSchema.safeParse(raw);
    if (parsed.success) {
      const known = new Set(defaultSurveyDocument().questions.map((question) => question.id));
      const snapshots = document.questions
        .filter((question) => question.enabled && known.has(question.id))
        .map((question) => {
          let value: number | string | string[] | null = null;
          if (question.kind === "rating") value = parsed.data[question.id as RatingField];
          else if (question.id === "salesHelpOptions") value = parsed.data.salesHelpOptions;
          else if (question.kind === "text") value = parsed.data[question.id as "doWell"];
          else if (question.lockedRole === "contact_permission") value = parsed.data.contactPermission;
          else if (question.lockedRole === "prize_draw") value = parsed.data.prizeDrawEntry;
          return snapshotFor(document, question, value);
        });
      const dynamic = interpretDynamic(document, raw);
      if (dynamic.ok) {
        snapshots.push(...dynamic.submission.snapshots.filter((answer) => !known.has(answer.questionId)));
      }
      return { ok: true, submission: packSnapshots(parsed.data, snapshots) };
    }
    if (!Array.isArray(asRecord(raw)?.answers)) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return {
        ok: false,
        error: "Please complete all required questions before submitting the survey.",
        code: "VALIDATION",
        fieldErrors,
      };
    }
  }
  const dynamic = interpretDynamic(document, raw);
  if (!dynamic.ok) return { ok: false, error: dynamic.error, code: "VALIDATION", fieldErrors: dynamic.fieldErrors };
  return { ok: true, submission: dynamic.submission };
}

export function dynamicRatingReports(snapshots: SurveyAnswerSnapshot[][]): Array<{
  questionId: string;
  prompt: string;
  scale: string;
  average: number | null;
  responses: number;
}> {
  const groups = new Map<string, { questionId: string; prompt: string; scale: string; values: number[] }>();
  for (const answers of snapshots) {
    for (const answer of answers) {
      if (answer.kind !== "rating" || typeof answer.value !== "number" || !answer.scale) continue;
      if (legacyRatingValue(answer) != null) continue;
      if (answer.value === 0 && answer.scale.allowNa) continue;
      const scale = `${answer.scale.min}–${answer.scale.max}`;
      const key = `${answer.questionId}|${answer.prompt}|${scale}`;
      const group = groups.get(key) ?? { questionId: answer.questionId, prompt: answer.prompt, scale, values: [] };
      group.values.push(answer.value);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    questionId: group.questionId,
    prompt: group.prompt,
    scale: group.scale,
    responses: group.values.length,
    average:
      group.values.length === 0
        ? null
        : Math.round((group.values.reduce((sum, value) => sum + value, 0) / group.values.length) * 100) / 100,
  }));
}

export function newSurveyQuestion(
  kind: SurveyQuestionKind,
  sectionId: string,
  number: number,
  sortOrder: number,
): SurveyQuestionDefinition {
  const id = `question${number}${kind === "yes_no" ? "YesNo" : kind === "multiple_choice" ? "Choice" : kind === "checkbox" ? "Checks" : kind === "rating" ? "Rating" : "Text"}`;
  if (kind === "rating") {
    return blankQuestion({
      id,
      number,
      kind,
      sectionId,
      prompt: "",
      required: true,
      sortOrder,
      min: 1,
      max: 5,
      allowNa: true,
      labels: {
        "5": "Very satisfied",
        "4": "Satisfied",
        "3": "Neither",
        "2": "Dissatisfied",
        "1": "Very dissatisfied",
      },
    });
  }
  if (kind === "multiple_choice" || kind === "checkbox") {
    return blankQuestion({
      id,
      number,
      kind,
      sectionId,
      prompt: "",
      required: kind === "multiple_choice",
      sortOrder,
      options: [
        { value: "option_a", label: "Option A" },
        { value: "option_b", label: "Option B" },
      ],
      maxSelections: kind === "checkbox" ? 2 : 1,
    });
  }
  if (kind === "yes_no") {
    return blankQuestion({ id, number, kind, sectionId, prompt: "", required: true, sortOrder });
  }
  return blankQuestion({ id, number, kind: "text", sectionId, prompt: "", required: false, sortOrder });
}
