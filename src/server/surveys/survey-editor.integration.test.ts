import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  defaultSurveyDocument,
  newSurveyQuestion,
  type SurveyDocument,
} from "@/domain/survey-definition";
import type { EmailAdapter } from "@/infra/email/types";
import { AuthError } from "@/server/rbac/guards";
import {
  getPublicSurvey,
  getSurveyEditor,
  previewSurveyDocument,
  publishSurveyDraft,
  saveSurveyDraft,
} from "@/server/surveys/definition";
import { getCustomerSurveyResponse, submitCustomerSurvey } from "@/server/surveys/service";

const prisma = new PrismaClient();
const suffix = `editor-${Date.now()}`;
const adapter: EmailAdapter = {
  name: "survey-editor-test",
  send: async () => ({ ok: true, id: "survey-editor-test" }),
};

let adminId = "";
let managerId = "";
let serviceId = "";
let marketingId = "";
let repId = "";
let recipients: string[] = [];
let originalPrompt = "";
let responseAId = "";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    submissionToken: `token-${crypto.randomUUID()}`,
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
    salesHelpOptions: ["none"],
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
    additionalComments: suffix,
    contactPermission: "no",
    prizeDrawEntry: "no",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    businessName: "",
    ukResidentAdultConfirmed: false,
    notConnectedConfirmed: false,
    termsAccepted: false,
    ...overrides,
  };
}

function editedDocument(document: SurveyDocument): SurveyDocument {
  const sectionId = document.sections[0]!.id;
  const number = Math.max(...document.questions.map((question) => question.number)) + 1;
  const extra = {
    ...newSurveyQuestion("rating", sectionId, number, document.questions.length),
    prompt: "How clear was the new product labelling?",
    required: false,
    min: 1,
    max: 10,
    allowNa: false,
  };
  return {
    ...document,
    notificationRecipients: recipients,
    notifyOnSubmission: true,
    questions: document.questions
      .map((question) =>
        question.id === "overallSatisfaction"
          ? { ...question, prompt: "Overall satisfaction (updated wording)" }
          : question,
      )
      .concat(extra),
  };
}

async function internal(email: string, roleKey: string) {
  const user = await prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await internal(`survey.editor.admin.${suffix}@example.invalid`, "SUPER_ADMIN");
  managerId = await internal(`survey.editor.mgmt.${suffix}@example.invalid`, "MANAGEMENT");
  serviceId = await internal(`survey.editor.cs.${suffix}@example.invalid`, "CUSTOMER_SERVICE");
  marketingId = await internal(`survey.editor.mkt.${suffix}@example.invalid`, "MARKETING");
  repId = await internal(`survey.editor.rep.${suffix}@example.invalid`, "SALES_REPRESENTATIVE");
  const settings = await prisma.emailSettings.findUnique({ where: { id: "singleton" } });
  recipients = Array.isArray(settings?.surveyNotificationRecipients)
    ? settings.surveyNotificationRecipients.filter(
        (value): value is string => typeof value === "string" && value.includes("@"),
      )
    : [];
  originalPrompt =
    defaultSurveyDocument().questions.find((question) => question.id === "overallSatisfaction")?.prompt ??
    "";
});

afterAll(async () => {
  if (adminId) {
    await saveSurveyDraft(
      adminId,
      defaultSurveyDocument({ notificationRecipients: recipients, notifyOnSubmission: true }),
    ).catch(() => undefined);
    await publishSurveyDraft(adminId).catch(() => undefined);
  }
  await prisma.customerSurveyResponse.deleteMany({ where: { additionalComments: suffix } });
  await prisma.auditEvent
    .deleteMany({
      where: { actorUserId: { in: [adminId, managerId, serviceId, marketingId, repId].filter(Boolean) } },
    })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { email: { contains: `survey.editor.`, endsWith: `${suffix}@example.invalid` } } })
    .catch(() => undefined);
  await prisma.$disconnect();
});

describe("customer survey editor", () => {
  it("saves a draft and previews it without changing the published survey", async () => {
    const before = await getPublicSurvey();
    expect(before.useLegacyForm).toBe(true);
    expect(before.versionNumber).toBeGreaterThan(0);
    const stored = await submitCustomerSurvey(payload(), { ip: null }, adapter);
    expect(stored.ok).toBe(true);
    if (!stored.ok || !stored.reference) throw new Error("expected a stored response");
    const row = await prisma.customerSurveyResponse.findUniqueOrThrow({ where: { reference: stored.reference } });
    responseAId = row.id;
    const snapshot = row.answerSnapshot as Array<{ questionId: string; prompt: string }>;
    expect(snapshot.find((answer) => answer.questionId === "overallSatisfaction")?.prompt).toBe(originalPrompt);

    const draft = editedDocument(before.document);
    const preview = await previewSurveyDocument(managerId, { ...draft, title: "Preview title only" });
    expect(preview.title).toBe("Preview title only");
    const afterPreview = await getPublicSurvey();
    expect(afterPreview.versionNumber).toBe(before.versionNumber);
    expect(afterPreview.document.title).toBe(before.document.title);
    expect(afterPreview.useLegacyForm).toBe(true);

    const saved = await saveSurveyDraft(managerId, draft);
    expect(saved.draft.questions.find((question) => question.id === "overallSatisfaction")?.prompt).toBe(
      "Overall satisfaction (updated wording)",
    );
    const published = await getPublicSurvey();
    expect(published.versionNumber).toBe(before.versionNumber);
    expect(
      published.document.questions.find((question) => question.id === "overallSatisfaction")?.prompt,
    ).toBe(originalPrompt);
    expect(published.useLegacyForm).toBe(true);
    const editor = await getSurveyEditor(adminId);
    expect(editor.draft.title).toBe(draft.title);
  });

  it("refuses survey editing for response-only roles", async () => {
    const draft = defaultSurveyDocument({ notificationRecipients: recipients });
    for (const userId of [serviceId, marketingId, repId]) {
      await expect(getSurveyEditor(userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(previewSurveyDocument(userId, draft)).rejects.toBeInstanceOf(AuthError);
      await expect(saveSurveyDraft(userId, draft)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(publishSurveyDraft(userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(saveSurveyDraft(managerId, { title: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(previewSurveyDocument(adminId, { introduction: [] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("publishes a new version and keeps historic answers on their original wording", async () => {
    const before = await getPublicSurvey();
    const versionOne = await prisma.customerSurveyVersion.findFirstOrThrow({
      where: { versionNumber: 1, status: "PUBLISHED" },
    });
    const versionOnePrompt = JSON.stringify(versionOne.document);
    const published = await publishSurveyDraft(adminId);
    expect(published.publishedVersionNumber).toBe(before.versionNumber + 1);
    const versionOneAfter = await prisma.customerSurveyVersion.findUniqueOrThrow({ where: { id: versionOne.id } });
    expect(JSON.stringify(versionOneAfter.document)).toBe(versionOnePrompt);
    expect(versionOneAfter.versionNumber).toBe(1);

    const historic = await getCustomerSurveyResponse(serviceId, responseAId);
    expect(historic.answers.some((answer) => answer.prompt === originalPrompt)).toBe(true);
    expect(historic.answers.some((answer) => answer.prompt === "Overall satisfaction (updated wording)")).toBe(
      false,
    );
    expect(historic.surveyVersionNumber).toBe(before.versionNumber);

    const next = await submitCustomerSurvey(payload({ overallSatisfaction: 2 }), { ip: null }, adapter);
    expect(next.ok).toBe(true);
    if (!next.ok || !next.reference) throw new Error("expected the updated survey to accept the original payload");
    const updated = await prisma.customerSurveyResponse.findUniqueOrThrow({
      where: { reference: next.reference },
    });
    const updatedSnapshot = updated.answerSnapshot as Array<{ questionId: string; prompt: string; value: unknown }>;
    expect(updatedSnapshot.find((answer) => answer.questionId === "overallSatisfaction")).toMatchObject({
      prompt: "Overall satisfaction (updated wording)",
      value: 2,
    });
    expect(updated.overallSatisfaction).toBe(2);
    const stillHistoric = await prisma.customerSurveyResponse.findUniqueOrThrow({ where: { id: responseAId } });
    const historicSnapshot = stillHistoric.answerSnapshot as Array<{ questionId: string; prompt: string }>;
    expect(historicSnapshot.find((answer) => answer.questionId === "overallSatisfaction")?.prompt).toBe(
      originalPrompt,
    );

    const extraId = published.published.questions.find(
      (question) => question.prompt === "How clear was the new product labelling?",
    )?.id;
    if (!extraId) throw new Error("expected the new labelling question");
    const withExtra = await submitCustomerSurvey(
      {
        idempotencyKey: crypto.randomUUID(),
        submissionToken: `token-${crypto.randomUUID()}`,
        website: "",
        answers: published.published.questions
          .filter((question) => question.enabled)
          .map((question) => ({
            questionId: question.id,
            value:
              question.id === extraId
                ? 8
                : question.id === "overallSatisfaction"
                  ? 5
                  : question.id === "additionalComments"
                    ? suffix
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
      },
      { ip: null },
      adapter,
    );
    expect(withExtra.ok).toBe(true);
    if (!withExtra.ok || !withExtra.reference) throw new Error("expected the extra answer to be stored");
    const extraRow = await prisma.customerSurveyResponse.findUniqueOrThrow({
      where: { reference: withExtra.reference },
    });
    const extraSnapshot = extraRow.answerSnapshot as Array<{
      questionId: string;
      prompt: string;
      value: unknown;
      scale: { max: number } | null;
    }>;
    expect(extraSnapshot.find((answer) => answer.questionId === extraId)).toMatchObject({
      prompt: "How clear was the new product labelling?",
      value: 8,
      scale: { max: 10 },
    });
    expect(extraRow.overallSatisfaction).toBe(5);
    const dashboard = await getCustomerSurveyResponse(managerId, extraRow.id);
    expect(dashboard.surveyVersionNumber).toBe(published.publishedVersionNumber);
    expect(dashboard.answers.some((answer) => answer.prompt === "How clear was the new product labelling?")).toBe(
      true,
    );
  });
});
