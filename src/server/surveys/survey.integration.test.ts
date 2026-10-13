import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { londonDateTime } from "@/domain/customer-survey";
import type { EmailAdapter } from "@/infra/email/types";
import { AuthError } from "@/server/rbac/guards";
import {
  deleteCustomerSurveyResponse,
  exportCustomerSurveysCsv,
  exportPrizeDrawEntriesCsv,
  getCustomerSurveyDashboard,
  importWordpressSurveyCsv,
  submitCustomerSurvey,
} from "@/server/surveys/service";

const prisma = new PrismaClient();
const suffix = `${Date.now()}`;
let adminId = "";
let serviceId = "";
let repId = "";
let previousEnabled = false;

const okAdapter: EmailAdapter = {
  name: "survey-test-ok",
  send: async () => ({ ok: true, id: "survey-test" }),
};
const failAdapter: EmailAdapter = {
  name: "survey-test-fail",
  send: async () => ({ ok: false, detail: "smtp down" }),
};

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
    salesHelpOptions: ["counter_top_displays", "other"],
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
    doWell: "Reliable stock",
    couldImprove: '=HYPERLINK("http://evil.example")',
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
  adminId = await internal(`survey.admin.${suffix}@example.invalid`, "SUPER_ADMIN");
  serviceId = await internal(`survey.cs.${suffix}@example.invalid`, "CUSTOMER_SERVICE");
  repId = await internal(`survey.rep.${suffix}@example.invalid`, "SALES_REPRESENTATIVE");
  const settings = await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled: true,
      surveyNotificationRecipients: [`survey.${suffix}@example.invalid`],
    },
    update: {},
  });
  previousEnabled = settings.enabled;
  await prisma.emailSettings.update({
    where: { id: "singleton" },
    data: { enabled: true, surveyNotificationRecipients: [`survey.${suffix}@example.invalid`] },
  });
});

afterAll(async () => {
  await prisma.emailSettings
    .update({
      where: { id: "singleton" },
      data: { enabled: previousEnabled },
    })
    .catch(() => undefined);
  await prisma.customerSurveyResponse.deleteMany({
    where: {
      OR: [
        { additionalComments: suffix },
        { customerEmail: { contains: suffix } },
        { reference: { startsWith: "CS-WP-" } },
      ],
    },
  });
  await prisma.auditEvent
    .deleteMany({ where: { actorUserId: { in: [adminId, serviceId, repId] } } })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({
      where: {
        email: {
          in: [
            `survey.admin.${suffix}@example.invalid`,
            `survey.cs.${suffix}@example.invalid`,
            `survey.rep.${suffix}@example.invalid`,
          ],
        },
      },
    })
    .catch(() => undefined);
  await prisma.$disconnect();
});

describe("customer survey submission", () => {
  it("stores an anonymous response and excludes N/A from the satisfaction average", async () => {
    const result = await submitCustomerSurvey(
      payload({ recommendationScore: 0, overallSatisfaction: 0 }),
      { ip: `anon-${suffix}` },
      okAdapter,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toMatch(/^CS-/);
    expect(result.prizeDrawAccepted).toBe(false);
    const row = await prisma.customerSurveyResponse.findFirstOrThrow({
      where: { reference: result.reference! },
    });
    expect(row.customerEmail).toBe("");
    expect(row.ackEmailStatus).toBe("NOT_REQUIRED");
    const dashboard = await getCustomerSurveyDashboard(adminId, {});
    expect(dashboard.total).toBeGreaterThan(0);
    expect(dashboard.netPromoterScoreLabel).toContain("separate");
  });

  it("rejects an incomplete survey and a contact request without an email", async () => {
    const missing = await submitCustomerSurvey(payload({ overallSatisfaction: undefined }), {
      ip: null,
    });
    expect(missing.ok).toBe(false);
    const contact = await submitCustomerSurvey(payload({ contactPermission: "yes" }), { ip: null });
    expect(contact.ok).toBe(false);
    if (contact.ok) return;
    expect(contact.fieldErrors?.["customerEmail"]).toBeTruthy();
  });

  it("sends an acknowledgement when an email is provided and records a failed send", async () => {
    const email = `thanks.${suffix}@example.invalid`;
    const saved = await submitCustomerSurvey(
      payload({
        contactPermission: "yes",
        customerName: "Alex Customer",
        customerEmail: email,
        customerPhone: "01527 000000",
      }),
      { ip: `mail-${suffix}` },
      okAdapter,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok || !saved.reference) return;
    const row = await prisma.customerSurveyResponse.findFirstOrThrow({
      where: { reference: saved.reference },
    });
    expect(row.ackEmailStatus).toBe("SENT");
    const emails = await prisma.transactionalEmail.count({
      where: { entityId: row.id, purpose: "CUSTOMER_SURVEY_ACK" },
    });
    expect(emails).toBe(1);
    const ack = await prisma.transactionalEmail.findFirstOrThrow({
      where: { entityId: row.id, purpose: "CUSTOMER_SURVEY_ACK" },
    });
    expect(ack.htmlBody).toContain(saved.reference);
    expect(ack.htmlBody).not.toContain("Prize Draw");

    const failed = await submitCustomerSurvey(
      payload({
        contactPermission: "yes",
        customerName: "Fail Customer",
        customerEmail: `fail.${suffix}@example.invalid`,
      }),
      { ip: `fail-${suffix}` },
      failAdapter,
    );
    expect(failed.ok).toBe(true);
    if (!failed.ok || !failed.reference) return;
    const failedRow = await prisma.customerSurveyResponse.findFirstOrThrow({
      where: { reference: failed.reference },
    });
    expect(failedRow.ackEmailStatus).toBe("FAILED");
  });

  it("accepts one prize draw entry inside the window and blocks a duplicate person or business", async () => {
    const open = londonDateTime("2026-11-02", "12:00:00");
    const closed = await submitCustomerSurvey(
      payload({
        prizeDrawEntry: "yes",
        customerName: "Early",
        customerEmail: `early.${suffix}@example.invalid`,
        businessName: "Early Ltd",
        ukResidentAdultConfirmed: true,
        notConnectedConfirmed: true,
        termsAccepted: true,
      }),
      { ip: `closed-${suffix}`, now: londonDateTime("2026-10-13", "12:00:00") },
      okAdapter,
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.prizeDrawAccepted).toBe(false);
    expect(closed.prizeDrawMessage).toContain("not accepted");

    const entry = {
      prizeDrawEntry: "yes",
      customerName: "Prize Person",
      customerEmail: `prize.${suffix}@example.invalid`,
      businessName: `Prize Business ${suffix}`,
      ukResidentAdultConfirmed: true,
      notConnectedConfirmed: true,
      termsAccepted: true,
      contactPermission: "no",
    };
    const first = await submitCustomerSurvey(
      payload(entry),
      { ip: `prize-${suffix}`, now: open },
      okAdapter,
    );
    expect(first.ok && first.prizeDrawAccepted).toBe(true);
    if (!first.ok || !first.reference) return;
    const ack = await prisma.transactionalEmail.findFirstOrThrow({
      where: { purpose: "CUSTOMER_SURVEY_ACK", subject: { contains: "Thank you" } },
      orderBy: { createdAt: "desc" },
    });
    const firstRow = await prisma.customerSurveyResponse.findFirstOrThrow({
      where: { reference: first.reference },
    });
    const firstAck = await prisma.transactionalEmail.findFirstOrThrow({
      where: { entityId: firstRow.id, purpose: "CUSTOMER_SURVEY_ACK" },
    });
    expect(firstAck.htmlBody).toContain("Prize Draw");

    const duplicateEmail = await submitCustomerSurvey(
      payload({
        ...entry,
        businessName: `Other Business ${suffix}`,
        customerName: "Another Person",
      }),
      { ip: `prize-dup-${suffix}`, now: open },
      okAdapter,
    );
    expect(duplicateEmail.ok).toBe(true);
    if (!duplicateEmail.ok) return;
    expect(duplicateEmail.prizeDrawAccepted).toBe(false);
    expect(duplicateEmail.prizeDrawMessage).toContain("already exists");

    const duplicateBusiness = await submitCustomerSurvey(
      payload({ ...entry, customerEmail: `other.${suffix}@example.invalid` }),
      { ip: `prize-biz-${suffix}`, now: open },
      okAdapter,
    );
    expect(duplicateBusiness.ok).toBe(true);
    if (!duplicateBusiness.ok) return;
    expect(duplicateBusiness.prizeDrawAccepted).toBe(false);
    expect(ack.htmlBody).toContain("Automotive Brands");
  });

  it("replays the same submission and blocks a second browser token", async () => {
    const body = payload();
    const first = await submitCustomerSurvey(body, { ip: `dup-${suffix}` }, okAdapter);
    const second = await submitCustomerSurvey(body, { ip: `dup-${suffix}` }, okAdapter);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reference).toBe(first.reference);
    expect(second.alreadySubmitted).toBe(true);
    const count = await prisma.customerSurveyResponse.count({
      where: { idempotencyKey: body.idempotencyKey },
    });
    expect(count).toBe(1);

    const again = await submitCustomerSurvey(
      payload({ submissionToken: body.submissionToken }),
      { ip: `dup2-${suffix}` },
      okAdapter,
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("DUPLICATE");
  });

  it("discards a honeypot submission", async () => {
    const before = await prisma.customerSurveyResponse.count();
    const result = await submitCustomerSurvey(payload({ website: "https://spam.example" }), {
      ip: `spam-${suffix}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBeNull();
    expect(await prisma.customerSurveyResponse.count()).toBe(before);
  });

  it("restricts administration, exports formula-safe CSV, and imports historic rows once", async () => {
    await expect(getCustomerSurveyDashboard(repId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(deleteCustomerSurveyResponse(serviceId, "missing")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const csv = await exportCustomerSurveysCsv(adminId, {});
    expect(csv).toContain("overall_satisfaction");
    expect(csv).toContain(`'=HYPERLINK`);
    const prize = await exportPrizeDrawEntriesCsv(serviceId, {});
    expect(prize.split("\n")[0]).toContain("customer_email");

    const legacyId = 900000 + Number(suffix.slice(-5));
    const header =
      "id,submitted_at,overall_satisfaction,recommendation_score,product_quality,product_consistency,product_range,product_shelf_appearance,customer_service,marketing_support,marketing_channel_website,marketing_channel_social,marketing_channel_pos,marketing_channel_campaigns,marketing_channel_media,communication,response_time,complaint_handling,ordering_delivery,order_accuracy,packaging_condition,speed_delivery,documentation,environmental_importance,environmental_rating,sales_help_options,do_well,could_improve,product_requests,additional_comments,contact_permission,customer_name,customer_email,customer_phone,prize_draw_entry,ack_email_sent,ack_email_sent_at";
    const values = `${legacyId},2026-10-01 09:30:00,5,8,4,4,3,3,5,4,5,0,3,2,1,4,4,0,5,5,4,4,3,4,0,[],Does well,,,,no,Historic,historic.${suffix}@example.invalid,,yes,yes,2026-10-01 09:31:00`;
    const file = `${header}\n${values}\n`;
    const imported = await importWordpressSurveyCsv(adminId, file);
    expect(imported.imported).toBe(1);
    const again = await importWordpressSurveyCsv(adminId, file);
    expect(again.skipped).toBe(1);
    expect(again.imported).toBe(0);
    const row = await prisma.customerSurveyResponse.findUniqueOrThrow({
      where: { legacyWordpressId: legacyId },
    });
    expect(row.ackEmailStatus).toBe("SENT");
    expect(row.prizeDrawAccepted).toBe(false);
    expect(row.prizeDrawRejectionReason).toBe("LEGACY_UNVERIFIED");
    const sent = await prisma.transactionalEmail.count({ where: { entityId: row.id } });
    expect(sent).toBe(0);

    await deleteCustomerSurveyResponse(adminId, row.id);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "customer_survey.deleted", entityId: row.id },
    });
    expect(audit).toBeTruthy();
    expect(await prisma.customerSurveyResponse.findUnique({ where: { id: row.id } })).toBeNull();
  });
});
