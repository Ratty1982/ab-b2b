/**
 * Public customer survey submission and internal administration.
 * Personal data stays behind surveys.view. Exports require surveys.export.
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CustomerSurveyResponse, Prisma as PrismaTypes } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import type { EmailAdapter } from "@/infra/email/types";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { deliverSurveyEmails } from "@/server/surveys/email";
import {
  AVERAGE_GROUPS,
  RATING_FIELDS,
  SURVEY_IP_MAX_PER_WINDOW,
  SURVEY_IP_WINDOW_MS,
  SURVEY_QUESTIONS,
  SURVEY_TOKEN_LOCK_MS,
  WORDPRESS_EXPORT_HEADERS,
  WP_RATING_COLUMNS,
  averageExcludingNa,
  averageRecommendation,
  buildSurveyCsv,
  decidePrizeDrawEntry,
  formatStoredRating,
  londonDateTime,
  londonDayBounds,
  londonTimestamp,
  netPromoterScore,
  normaliseSalesHelp,
  normalizeIdentity,
  parseWordpressSurveyCsv,
  prizeDrawCustomerMessage,
  salesHelpLabel,
  wordpressRating,
  type PrizeDrawDecision,
  type RatingField,
} from "@/domain/customer-survey";
import {
  displayStoredAnswer,
  dynamicRatingReports,
  interpretSurveySubmission,
  type SurveyAnswerSnapshot,
} from "@/domain/survey-definition";
import { ensureSurveyConfig } from "@/server/surveys/definition";

const CLAIM_EMAIL = "EMAIL";
const CLAIM_BUSINESS = "BUSINESS";

export type SurveySubmitResult =
  | {
      ok: true;
      reference: string | null;
      alreadySubmitted: boolean;
      prizeDrawAccepted: boolean;
      prizeDrawMessage: string | null;
    }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };

const listSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  contactOnly: z.boolean().optional(),
  prizeDraw: z.enum(["all", "requested", "accepted"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

function digest(value: string): string {
  return createHash("sha256").update(`ab-customer-survey:v1:${value}`).digest("hex");
}

function submittedAtFilter(from?: string, to?: string): PrismaTypes.DateTimeFilter | undefined {
  const bounds = londonDayBounds(from, to);
  if (!bounds.gte && !bounds.lte) return undefined;
  return bounds;
}

function listWhere(
  input: z.infer<typeof listSchema>,
): PrismaTypes.CustomerSurveyResponseWhereInput {
  const where: PrismaTypes.CustomerSurveyResponseWhereInput = {};
  const submittedAt = submittedAtFilter(input.from, input.to);
  if (submittedAt) where.submittedAt = submittedAt;
  if (input.contactOnly) where.contactPermission = "yes";
  if (input.prizeDraw === "requested") where.prizeDrawRequested = true;
  if (input.prizeDraw === "accepted") where.prizeDrawAccepted = true;
  return where;
}

function present(row: CustomerSurveyResponse, alreadySubmitted: boolean): SurveySubmitResult {
  const decision: PrizeDrawDecision = {
    requested: row.prizeDrawRequested,
    accepted: row.prizeDrawAccepted,
    reason: (row.prizeDrawRejectionReason as PrizeDrawDecision["reason"]) ?? null,
  };
  return {
    ok: true,
    reference: row.reference,
    alreadySubmitted,
    prizeDrawAccepted: row.prizeDrawAccepted,
    prizeDrawMessage: prizeDrawCustomerMessage(decision),
  };
}

async function createReference(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `CS-${randomBytes(4).toString("hex").toUpperCase()}`;
    const existing = await prisma.customerSurveyResponse.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!existing) return reference;
  }
  return `CS-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function isAnswerSnapshot(value: unknown): value is SurveyAnswerSnapshot[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && "questionId" in item);
}

export async function submitCustomerSurvey(
  raw: unknown,
  ctx: { ip: string | null; now?: Date },
  adapter?: EmailAdapter,
): Promise<SurveySubmitResult> {
  const published = await ensureSurveyConfig();
  const interpreted = interpretSurveySubmission(published.published.document, raw);
  if (!interpreted.ok) {
    return {
      ok: false,
      error: interpreted.error,
      code: interpreted.code,
      ...(interpreted.fieldErrors ? { fieldErrors: interpreted.fieldErrors } : {}),
    };
  }
  const input = interpreted.submission;
  if (input.website.trim()) {
    return {
      ok: true,
      reference: null,
      alreadySubmitted: false,
      prizeDrawAccepted: false,
      prizeDrawMessage: null,
    };
  }

  const existingKey = await prisma.customerSurveyResponse.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingKey) return present(existingKey, true);

  const tokenHash = digest(input.submissionToken);
  const tokenSince = new Date(Date.now() - SURVEY_TOKEN_LOCK_MS);
  const sameBrowser = await prisma.customerSurveyResponse.findFirst({
    where: { submissionTokenHash: tokenHash, submittedAt: { gte: tokenSince }, source: "PORTAL" },
    orderBy: { submittedAt: "desc" },
  });
  if (sameBrowser) {
    return {
      ok: false,
      error:
        "This survey has already been submitted from this browser. Thank you for your feedback.",
      code: "DUPLICATE",
    };
  }

  const ipHash = ctx.ip ? digest(`ip:${ctx.ip}`) : null;
  if (ipHash) {
    const recent = await prisma.customerSurveyResponse.count({
      where: {
        ipHash,
        source: "PORTAL",
        submittedAt: { gte: new Date(Date.now() - SURVEY_IP_WINDOW_MS) },
      },
    });
    if (recent >= SURVEY_IP_MAX_PER_WINDOW) {
      return {
        ok: false,
        error: "Too many survey submissions. Please try again later.",
        code: "RATE_LIMITED",
      };
    }
  }

  const now = ctx.now ?? new Date();
  const decision = decidePrizeDrawEntry(input, now);
  if (decision.reason === "MISSING_CONTACT" || decision.reason === "MISSING_ELIGIBILITY") {
    return {
      ok: false,
      error: prizeDrawCustomerMessage(decision) ?? "Please complete the prize draw details.",
      code: "VALIDATION",
      fieldErrors:
        decision.reason === "MISSING_CONTACT"
          ? {
              customerName: input.customerName
                ? ""
                : "Please provide your name so that we can contact you.",
              customerEmail: "Please provide a valid email address.",
            }
          : {
              businessName: input.businessName ? "" : "Please provide your business name.",
              termsAccepted: "Please confirm the prize draw terms and eligibility statements.",
            },
    };
  }

  const email = input.customerEmail.trim().toLowerCase();
  const business = normalizeIdentity(input.businessName);
  let rejection = decision.reason;
  let accepted = decision.accepted;
  const reference = await createReference();

  let created: CustomerSurveyResponse;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.customerSurveyResponse.create({
        data: {
          reference,
          submittedAt: now,
          source: "PORTAL",
          idempotencyKey: input.idempotencyKey,
          submissionTokenHash: tokenHash,
          ipHash,
          ...input.ratings,
          salesHelpOptions: normaliseSalesHelp(input.salesHelpOptions),
          doWell: input.doWell,
          couldImprove: input.couldImprove,
          productRequests: input.productRequests,
          additionalComments: input.additionalComments,
          contactPermission: input.contactPermission,
          customerName: input.customerName,
          customerEmail: email,
          customerEmailNormalized: email,
          customerPhone: input.customerPhone,
          businessName: input.businessName,
          businessNameNormalized: business,
          prizeDrawRequested: decision.requested,
          prizeDrawAccepted: false,
          prizeDrawRejectionReason: rejection,
          ukResidentAdultConfirmed: input.ukResidentAdultConfirmed,
          notConnectedConfirmed: input.notConnectedConfirmed,
          termsAccepted: input.termsAccepted,
          eligibilityDeclarationsHeld: decision.accepted,
          ackEmailStatus: email ? "PENDING" : "NOT_REQUIRED",
          internalEmailStatus: "PENDING",
          surveyVersionId: published.published.id,
          answerSnapshot: input.snapshots as unknown as Prisma.InputJsonValue,
        },
      });

      if (!decision.accepted) return row;

      const emailTaken = await tx.customerSurveyPrizeClaim.findUnique({
        where: { kind_normalizedValue: { kind: CLAIM_EMAIL, normalizedValue: email } },
      });
      if (emailTaken) {
        rejection = "DUPLICATE_EMAIL";
        accepted = false;
        return tx.customerSurveyResponse.update({
          where: { id: row.id },
          data: {
            prizeDrawAccepted: false,
            prizeDrawRejectionReason: rejection,
            eligibilityDeclarationsHeld: true,
          },
        });
      }
      const businessTaken = await tx.customerSurveyPrizeClaim.findUnique({
        where: { kind_normalizedValue: { kind: CLAIM_BUSINESS, normalizedValue: business } },
      });
      if (businessTaken) {
        rejection = "DUPLICATE_BUSINESS";
        accepted = false;
        return tx.customerSurveyResponse.update({
          where: { id: row.id },
          data: {
            prizeDrawAccepted: false,
            prizeDrawRejectionReason: rejection,
            eligibilityDeclarationsHeld: true,
          },
        });
      }

      await tx.customerSurveyPrizeClaim.create({
        data: { kind: CLAIM_EMAIL, normalizedValue: email, responseId: row.id },
      });
      await tx.customerSurveyPrizeClaim.create({
        data: { kind: CLAIM_BUSINESS, normalizedValue: business, responseId: row.id },
      });

      return tx.customerSurveyResponse.update({
        where: { id: row.id },
        data: { prizeDrawAccepted: true, prizeDrawRejectionReason: null },
      });
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const raced = await prisma.customerSurveyResponse.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (raced) return present(raced, true);
    }
    throw error;
  }

  try {
    await deliverSurveyEmails(created.id, adapter);
  } catch (error) {
    await prisma.customerSurveyResponse.update({
      where: { id: created.id },
      data: {
        ackEmailStatus: email ? "FAILED" : "NOT_REQUIRED",
        internalEmailStatus: "FAILED",
      },
    });
    console.error("[ab:survey] email delivery failed", {
      reference: created.reference,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const stored = await prisma.customerSurveyResponse.findUniqueOrThrow({
    where: { id: created.id },
  });
  return present(
    {
      ...stored,
      prizeDrawAccepted: stored.prizeDrawAccepted,
      prizeDrawRejectionReason: stored.prizeDrawRejectionReason ?? rejection,
    },
    false,
  );
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function round(value: number | null): number | null {
  return value;
}

export async function getCustomerSurveyDashboard(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "surveys.view");
  const input = listSchema.parse(raw ?? {});
  const where = listWhere(input);
  const [total, rows, contactRequests, feedback] = await Promise.all([
    prisma.customerSurveyResponse.count({ where }),
    prisma.customerSurveyResponse.findMany({
      where,
      select: {
        submittedAt: true,
        recommendationScore: true,
        prizeDrawRequested: true,
        prizeDrawAccepted: true,
        contactPermission: true,
        answerSnapshot: true,
        ...Object.fromEntries(RATING_FIELDS.map((field) => [field, true])),
      },
    }),
    prisma.customerSurveyResponse.findMany({
      where: { ...where, contactPermission: "yes" },
      orderBy: { submittedAt: "desc" },
      take: 50,
      select: {
        id: true,
        reference: true,
        submittedAt: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        overallSatisfaction: true,
      },
    }),
    prisma.customerSurveyResponse.findMany({
      where: {
        ...where,
        OR: [
          { doWell: { not: "" } },
          { couldImprove: { not: "" } },
          { productRequests: { not: "" } },
          { additionalComments: { not: "" } },
        ],
      },
      orderBy: { submittedAt: "desc" },
      take: 30,
      select: {
        id: true,
        reference: true,
        submittedAt: true,
        doWell: true,
        couldImprove: true,
        productRequests: true,
        additionalComments: true,
      },
    }),
  ]);

  const categories = AVERAGE_GROUPS.map((group) => {
    const values = rows.flatMap((row) =>
      group.fields.map((field) => {
        const value = row[field as keyof typeof row];
        if (typeof value !== "number") return null;
        if (field === "environmentalImportance") return value;
        return group.excludeNa && value === 0 ? null : value;
      }),
    );
    const scored = values.filter((value): value is number => value != null && value > 0);
    return {
      id: group.id,
      label: group.label,
      average: round(averageExcludingNa(scored)),
      responses: scored.length,
    };
  });

  const recommendation = rows
    .map((row) => row.recommendationScore)
    .filter((score): score is number => typeof score === "number");
  const trends = new Map<string, number>();
  for (const row of rows) {
    const stamp = londonTimestamp(row.submittedAt).slice(0, 8);
    const key = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    trends.set(key, (trends.get(key) ?? 0) + 1);
  }

  const [pageTotal, items] = await prisma.$transaction([
    prisma.customerSurveyResponse.count({ where }),
    prisma.customerSurveyResponse.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        reference: true,
        submittedAt: true,
        overallSatisfaction: true,
        recommendationScore: true,
        productQuality: true,
        customerService: true,
        communication: true,
        orderingDelivery: true,
        documentation: true,
        environmentalRating: true,
        contactPermission: true,
        customerEmail: true,
        prizeDrawRequested: true,
        prizeDrawAccepted: true,
        ackEmailStatus: true,
        source: true,
      },
    }),
  ]);

  return {
    total,
    averageOverall: categories.find((category) => category.id === "overall")?.average ?? null,
    averageRecommendation: averageRecommendation(recommendation),
    netPromoterScore: netPromoterScore(recommendation),
    netPromoterScoreLabel:
      "Promoters (9–10) minus detractors (0–6), as a percentage of scored responses. This is separate from the average recommendation score.",
    dynamicRatings: dynamicRatingReports(
      rows.map((row) => (isAnswerSnapshot(row.answerSnapshot) ? row.answerSnapshot : [])),
    ),
    categories,
    trends: [...trends.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    prizeDraw: {
      requested: rows.filter((row) => row.prizeDrawRequested).length,
      accepted: rows.filter((row) => row.prizeDrawAccepted).length,
    },
    contactRequests: contactRequests.map((row) => ({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    })),
    feedback: feedback.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() })),
    page: input.page,
    pageSize: input.pageSize,
    pageTotal,
    items: items.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() })),
  };
}

export async function getCustomerSurveyResponse(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "surveys.view");
  const row = await prisma.customerSurveyResponse.findUnique({ where: { id } });
  if (!row) throw new AuthError("Survey response not found", "NOT_FOUND", 404);
  const version = row.surveyVersionId
    ? await prisma.customerSurveyVersion.findUnique({
        where: { id: row.surveyVersionId },
        select: { versionNumber: true },
      })
    : null;
  const answers = isAnswerSnapshot(row.answerSnapshot)
    ? row.answerSnapshot.map((answer) => ({
        number: answer.number,
        prompt: answer.prompt,
        value: displayStoredAnswer(answer),
      }))
    : SURVEY_QUESTIONS.filter((question) => question.kind === "rating").map((question) => ({
        number: question.number,
        prompt: question.prompt,
        value: formatStoredRating(question.field, row[question.field] ?? 0),
      }));
  const help = Array.isArray(row.salesHelpOptions)
    ? row.salesHelpOptions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: row.id,
    reference: row.reference,
    submittedAt: row.submittedAt.toISOString(),
    source: row.source,
    surveyVersionNumber: version?.versionNumber ?? null,
    legacyWordpressId: row.legacyWordpressId,
    answers,
    salesHelp: help.map(salesHelpLabel),
    doWell: row.doWell,
    couldImprove: row.couldImprove,
    productRequests: row.productRequests,
    additionalComments: row.additionalComments,
    contactPermission: row.contactPermission,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    businessName: row.businessName,
    prizeDrawRequested: row.prizeDrawRequested,
    prizeDrawAccepted: row.prizeDrawAccepted,
    prizeDrawRejectionReason: row.prizeDrawRejectionReason,
    eligibilityDeclarationsHeld: row.eligibilityDeclarationsHeld,
    ackEmailStatus: row.ackEmailStatus,
    ackEmailSentAt: row.ackEmailSentAt?.toISOString() ?? null,
    internalEmailStatus: row.internalEmailStatus,
    internalEmailSentAt: row.internalEmailSentAt?.toISOString() ?? null,
  };
}

export async function deleteCustomerSurveyResponse(actorUserId: string, id: string) {
  await requireSystemPermission(actorUserId, "surveys.delete");
  const row = await prisma.customerSurveyResponse.findUnique({ where: { id } });
  if (!row) throw new AuthError("Survey response not found", "NOT_FOUND", 404);
  await recordAuditEvent({
    action: "customer_survey.deleted",
    entityType: "CustomerSurveyResponse",
    entityId: row.id,
    actorUserId,
    metadata: {
      reference: row.reference,
      submittedAt: row.submittedAt.toISOString(),
      source: row.source,
      contactPermission: row.contactPermission,
      prizeDrawAccepted: row.prizeDrawAccepted,
    },
  });
  await prisma.customerSurveyResponse.delete({ where: { id: row.id } });
  return { ok: true as const };
}

function exportRows(rows: CustomerSurveyResponse[]) {
  return rows.map((row) => {
    const help = Array.isArray(row.salesHelpOptions) ? row.salesHelpOptions : [];
    return [
      row.legacyWordpressId ?? "",
      row.submittedAt.toISOString(),
      ...Object.values(WP_RATING_COLUMNS).map((field) => row[field] ?? ""),
      JSON.stringify(help),
      row.doWell,
      row.couldImprove,
      row.productRequests,
      row.additionalComments,
      row.contactPermission,
      row.customerName,
      row.customerEmail,
      row.customerPhone,
      row.prizeDrawRequested ? "yes" : "no",
      row.ackEmailStatus === "SENT" ? "yes" : "no",
      row.ackEmailSentAt?.toISOString() ?? "",
      row.reference,
      row.source,
      row.prizeDrawAccepted ? "yes" : "no",
      row.businessName,
    ];
  });
}

export async function exportCustomerSurveysCsv(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "surveys.export");
  const input = listSchema.parse({
    ...(typeof raw === "object" && raw ? raw : {}),
    page: 1,
    pageSize: 1,
  });
  const rows = await prisma.customerSurveyResponse.findMany({
    where: listWhere(input),
    orderBy: { submittedAt: "desc" },
  });
  const headers = [
    ...WORDPRESS_EXPORT_HEADERS,
    "reference",
    "source",
    "prize_draw_accepted",
    "business_name",
  ];
  return buildSurveyCsv(headers, exportRows(rows));
}

export async function exportPrizeDrawEntriesCsv(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "surveys.export");
  const input = listSchema.parse({
    ...(typeof raw === "object" && raw ? raw : {}),
    page: 1,
    pageSize: 1,
  });
  const rows = await prisma.customerSurveyResponse.findMany({
    where: { ...listWhere(input), prizeDrawAccepted: true },
    orderBy: { submittedAt: "asc" },
  });
  return buildSurveyCsv(
    [
      "reference",
      "submitted_at",
      "customer_name",
      "business_name",
      "customer_email",
      "customer_phone",
      "eligibility_confirmed",
    ],
    rows.map((row) => [
      row.reference,
      row.submittedAt.toISOString(),
      row.customerName,
      row.businessName,
      row.customerEmail,
      row.customerPhone,
      row.eligibilityDeclarationsHeld ? "yes" : "no",
    ]),
  );
}

function parseWpTimestamp(value: string): Date | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) {
    const iso = Date.parse(value);
    return Number.isNaN(iso) ? null : new Date(iso);
  }
  return londonDateTime(match[1]!, match[2]!);
}

export async function importWordpressSurveyCsv(actorUserId: string, csv: string) {
  await requireSystemPermission(actorUserId, "surveys.import");
  if (csv.length > 2_000_000) {
    throw new AuthError("The CSV file is too large.", "VALIDATION", 400);
  }
  const parsed = parseWordpressSurveyCsv(csv);
  let imported = 0;
  let skipped = 0;
  let invalid = 0;
  const versionOne = await prisma.customerSurveyVersion.findFirst({
    where: { versionNumber: 1, status: "PUBLISHED" },
    select: { id: true },
  });
  const versionOneId = versionOne?.id ?? (await ensureSurveyConfig()).published.id;

  for (const record of parsed.rows) {
    const cell = (key: string) => record[key] ?? "";
    const legacyId = Number(cell("id"));
    if (!Number.isInteger(legacyId) || legacyId <= 0) {
      invalid += 1;
      continue;
    }
    const existing = await prisma.customerSurveyResponse.findUnique({
      where: { legacyWordpressId: legacyId },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const submittedAt = parseWpTimestamp(cell("submitted_at"));
    if (!submittedAt) {
      invalid += 1;
      continue;
    }
    const ratings: Partial<Record<RatingField, number>> = {};
    let ratingsOk = true;
    for (const column of Object.keys(WP_RATING_COLUMNS)) {
      const value = wordpressRating(column, cell(column));
      if (value == null) {
        ratingsOk = false;
        break;
      }
      ratings[WP_RATING_COLUMNS[column]!] = value;
    }
    if (!ratingsOk) {
      invalid += 1;
      continue;
    }
    const contact = cell("contact_permission") === "yes" ? "yes" : "no";
    const prizeRequested = cell("prize_draw_entry") === "yes";
    const email = cell("customer_email").trim().toLowerCase();
    let help: string[] = [];
    const salesHelpRaw = cell("sales_help_options");
    if (salesHelpRaw) {
      try {
        const decoded = JSON.parse(salesHelpRaw) as unknown;
        help = Array.isArray(decoded)
          ? decoded.filter((value): value is string => typeof value === "string")
          : [];
      } catch {
        help = salesHelpRaw
          .split("|")
          .map((value) => value.trim())
          .filter(Boolean);
      }
    }
    const ackSent = cell("ack_email_sent") === "yes";
    const ackRaw = cell("ack_email_sent_at");
    const ackAt = ackRaw ? parseWpTimestamp(ackRaw) : null;
    await prisma.customerSurveyResponse.create({
      data: {
        reference: `CS-WP-${legacyId}`,
        submittedAt,
        source: "WORDPRESS_IMPORT",
        legacyWordpressId: legacyId,
        surveyVersionId: versionOneId,
        ...(ratings as Record<RatingField, number>),
        salesHelpOptions: normaliseSalesHelp(help),
        doWell: cell("do_well").slice(0, 4000),
        couldImprove: cell("could_improve").slice(0, 4000),
        productRequests: cell("product_requests").slice(0, 4000),
        additionalComments: cell("additional_comments").slice(0, 4000),
        contactPermission: contact,
        customerName: cell("customer_name").slice(0, 255),
        customerEmail: email.slice(0, 255),
        customerEmailNormalized: email.slice(0, 255),
        customerPhone: cell("customer_phone").slice(0, 100),
        prizeDrawRequested: prizeRequested,
        prizeDrawAccepted: false,
        prizeDrawRejectionReason: prizeRequested ? "LEGACY_UNVERIFIED" : null,
        eligibilityDeclarationsHeld: false,
        ackEmailStatus: ackSent ? "SENT" : "SKIPPED_IMPORT",
        ackEmailSentAt: ackSent ? (ackAt ?? submittedAt) : null,
        internalEmailStatus: "SKIPPED_IMPORT",
      },
    });
    imported += 1;
  }

  await recordAuditEvent({
    action: "customer_survey.imported",
    entityType: "CustomerSurveyResponse",
    entityId: "wordpress-csv",
    actorUserId,
    metadata: { imported, skipped, invalid },
  });

  return { imported, skipped, invalid };
}
