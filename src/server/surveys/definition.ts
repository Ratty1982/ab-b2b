/**
 * Draft and published customer survey versions.
 * Publishing copies the draft into a new immutable version. It never rewrites an older version.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  defaultSurveyDocument,
  usesLegacySurveyForm,
  validateSurveyDocument,
  type SurveyDocument,
} from "@/domain/survey-definition";

export type PublicSurvey = {
  enabled: boolean;
  title: string;
  introduction: string[];
  durationLabel: string;
  thankYouTitle: string;
  thankYouParagraphs: string[];
  useLegacyForm: boolean;
  document: SurveyDocument;
  versionNumber: number;
};

export type SurveyEditorState = {
  publishedVersionNumber: number;
  publishedAt: string | null;
  draft: SurveyDocument;
  published: SurveyDocument;
};

function parseDocument(value: unknown): SurveyDocument {
  const parsed = validateSurveyDocument(value);
  if (!parsed.ok) return defaultSurveyDocument();
  return parsed.document;
}

async function notificationSeed(): Promise<string[]> {
  const settings = await prisma.emailSettings.findUnique({ where: { id: "singleton" } });
  const recipients = settings?.surveyNotificationRecipients;
  return Array.isArray(recipients)
    ? recipients.filter((value): value is string => typeof value === "string" && value.includes("@"))
    : [];
}

export async function ensureSurveyConfig(): Promise<{
  published: { id: string; versionNumber: number; document: SurveyDocument; publishedAt: Date | null };
  draft: { id: string; document: SurveyDocument };
}> {
  let published = await prisma.customerSurveyVersion.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
  });
  if (!published) {
    const document = defaultSurveyDocument({ notificationRecipients: await notificationSeed() });
    published = await prisma.customerSurveyVersion.create({
      data: {
        versionNumber: 1,
        status: "PUBLISHED",
        document: document as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    });
  }
  let draft = await prisma.customerSurveyVersion.findFirst({ where: { status: "DRAFT" } });
  if (!draft) {
    try {
      draft = await prisma.customerSurveyVersion.create({
        data: {
          status: "DRAFT",
          document: published.document as Prisma.InputJsonValue,
        },
      });
    } catch {
      draft = await prisma.customerSurveyVersion.findFirstOrThrow({ where: { status: "DRAFT" } });
    }
  }
  const versionOne = await prisma.customerSurveyVersion.findFirst({
    where: { versionNumber: 1, status: "PUBLISHED" },
    select: { id: true },
  });
  if (versionOne) {
    await prisma.customerSurveyResponse.updateMany({
      where: { surveyVersionId: null },
      data: { surveyVersionId: versionOne.id },
    });
  }
  return {
    published: {
      id: published.id,
      versionNumber: published.versionNumber ?? 1,
      document: parseDocument(published.document),
      publishedAt: published.publishedAt,
    },
    draft: { id: draft.id, document: parseDocument(draft.document) },
  };
}

export async function getPublicSurvey(): Promise<PublicSurvey> {
  const { published } = await ensureSurveyConfig();
  return {
    enabled: published.document.enabled,
    title: published.document.title,
    introduction: published.document.introduction,
    durationLabel: published.document.durationLabel,
    thankYouTitle: published.document.thankYouTitle,
    thankYouParagraphs: published.document.thankYouParagraphs,
    useLegacyForm: usesLegacySurveyForm(published.document),
    document: published.document,
    versionNumber: published.versionNumber,
  };
}

async function requireSurveyEditor(userId: string) {
  const profile = await requireSystemPermission(userId, "surveys.manage");
  if (
    profile.actorType !== "INTERNAL" ||
    (!profile.systemRoles.includes("SUPER_ADMIN") && !profile.systemRoles.includes("MANAGEMENT"))
  ) {
    throw new AuthError("Only Management or Super Admin can edit the survey.", "FORBIDDEN", 403);
  }
  return profile;
}

function editorState(config: Awaited<ReturnType<typeof ensureSurveyConfig>>): SurveyEditorState {
  return {
    publishedVersionNumber: config.published.versionNumber,
    publishedAt: config.published.publishedAt?.toISOString() ?? null,
    draft: config.draft.document,
    published: config.published.document,
  };
}

export async function getSurveyEditor(userId: string): Promise<SurveyEditorState> {
  await requireSurveyEditor(userId);
  return editorState(await ensureSurveyConfig());
}

export async function previewSurveyDocument(userId: string, raw: unknown): Promise<SurveyDocument> {
  await requireSurveyEditor(userId);
  const parsed = validateSurveyDocument(raw);
  if (!parsed.ok) throw new AuthError(parsed.errors.join(" "), "VALIDATION", 400);
  return parsed.document;
}

export async function saveSurveyDraft(userId: string, raw: unknown): Promise<SurveyEditorState> {
  await requireSurveyEditor(userId);
  const parsed = validateSurveyDocument(raw);
  if (!parsed.ok) throw new AuthError(parsed.errors.join(" "), "VALIDATION", 400);
  const config = await ensureSurveyConfig();
  await prisma.customerSurveyVersion.update({
    where: { id: config.draft.id },
    data: { document: parsed.document as unknown as Prisma.InputJsonValue },
  });
  await recordAuditEvent({
    action: "customer_survey.draft_saved",
    entityType: "CustomerSurveyVersion",
    entityId: config.draft.id,
    actorUserId: userId,
    metadata: { questionCount: parsed.document.questions.length, enabled: parsed.document.enabled },
  });
  return editorState(await ensureSurveyConfig());
}

export async function publishSurveyDraft(userId: string): Promise<SurveyEditorState> {
  await requireSurveyEditor(userId);
  const config = await ensureSurveyConfig();
  const parsed = validateSurveyDocument(config.draft.document);
  if (!parsed.ok) throw new AuthError(parsed.errors.join(" "), "VALIDATION", 400);
  const document = structuredClone(parsed.document);
  const latest = await prisma.customerSurveyVersion.aggregate({
    where: { status: "PUBLISHED" },
    _max: { versionNumber: true },
  });
  const versionNumber = (latest._max.versionNumber ?? 0) + 1;
  const created = await prisma.customerSurveyVersion.create({
    data: {
      versionNumber,
      status: "PUBLISHED",
      document: document as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
      publishedByUserId: userId,
    },
  });
  if (document.notifyOnSubmission) {
    await prisma.emailSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        surveyNotificationRecipients: document.notificationRecipients,
      },
      update: { surveyNotificationRecipients: document.notificationRecipients },
    });
  }
  await recordAuditEvent({
    action: "customer_survey.published",
    entityType: "CustomerSurveyVersion",
    entityId: created.id,
    actorUserId: userId,
    metadata: {
      versionNumber,
      questionCount: document.questions.length,
      enabled: document.enabled,
      notifyOnSubmission: document.notifyOnSubmission,
    },
  });
  return editorState(await ensureSurveyConfig());
}
