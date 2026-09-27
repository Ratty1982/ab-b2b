import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import {
  getCallbackPrefill,
  submitCallbackEnquiry,
} from "@/server/callback/service";
import { CALLBACK_REQUEST_LEAD_SOURCE } from "@/domain/callback";
import { listCompanyActivity } from "@/server/companies/service";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let companyId = "";
let otherCompanyId = "";
let buyerId = "";
let otherBuyerId = "";
let salesRepUserId = "";
let salesRepId = "";
let adminId = "";
let contactId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
  name?: string,
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: name ?? email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
  } else if (name) {
    user = await prisma.user.update({ where: { id: user.id }, data: { name } });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);

  const company = await prisma.company.create({
    data: {
      name: `Callback Co ${suffix}`,
      tradingName: "testy",
      status: "ACTIVE",
      phone: "01234567890",
    },
  });
  companyId = company.id;

  const other = await prisma.company.create({
    data: { name: `Callback Other ${suffix}`, status: "ACTIVE" },
  });
  otherCompanyId = other.id;

  buyerId = await ensureUser(
    `cb.buyer.${suffix}@example.invalid`,
    [],
    "TRADE",
    "Wayne Radford",
  );
  await prisma.companyUser.create({
    data: {
      companyId,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  contactId = (
    await prisma.contact.create({
      data: {
        companyId,
        firstName: "Wayne",
        lastName: "Radford",
        email: `cb.buyer.${suffix}@example.invalid`,
        phone: "07999111222",
        isPrimary: true,
      },
    })
  ).id;

  otherBuyerId = await ensureUser(`cb.other.${suffix}@example.invalid`, [], "TRADE", "Other Buyer");
  await prisma.companyUser.create({
    data: {
      companyId: otherCompanyId,
      userId: otherBuyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  salesRepUserId = await ensureUser(
    `cb.luke.${suffix}@automotivebrands.co.uk`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
    "Luke Andrews",
  );
  const rep = await prisma.salesRep.create({
    data: {
      userId: salesRepUserId,
      code: `CB${suffix.slice(-4).toUpperCase()}`,
      active: true,
    },
  });
  salesRepId = rep.id;

  await prisma.companyAssignment.create({
    data: { companyId, salesRepId, isPrimary: true },
  });

  adminId = await ensureUser(`cb.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"], "INTERNAL");

  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled: true,
      tradeApplicationRecipients: [`trade.cb.${suffix}@example.invalid`],
    },
    update: {
      enabled: true,
      tradeApplicationRecipients: [`trade.cb.${suffix}@example.invalid`],
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("callback prefill", () => {
  it("prefills name, company, email, telephone for authenticated trade user", async () => {
    const prefill = await getCallbackPrefill(buyerId);
    expect(prefill.authenticated).toBe(true);
    expect(prefill.name).toBe("Wayne Radford");
    expect(prefill.company).toBe("testy");
    expect(prefill.email).toBe(`cb.buyer.${suffix}@example.invalid`);
    expect(prefill.telephone).toBe("07999111222");
    expect(prefill.accountManagerName).toBe("Luke Andrews");
    expect(prefill.supportingCopy).toContain("Luke Andrews");
  });

  it("returns empty prefill for guests", async () => {
    const prefill = await getCallbackPrefill(null);
    expect(prefill.authenticated).toBe(false);
    expect(prefill.company).toBe("");
  });
});

describe("authenticated callback submission", () => {
  it("creates Activity + Task, routes to SalesRep, does not create Lead", async () => {
    const leadsBefore = await prisma.lead.count({
      where: { source: CALLBACK_REQUEST_LEAD_SOURCE },
    });

    const result = await submitCallbackEnquiry(
      {
        name: "Wayne Radford",
        company: "ignored-client-company",
        email: `cb.buyer.${suffix}@example.invalid`,
        telephone: "07999111222",
        message: `Please call about stock ${suffix}`,
        websiteConfirm: "",
        clientRequestId: `auth-${suffix}-1`,
      },
      { userId: buyerId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("activity");
    expect(result.accountManagerName).toBe("Luke Andrews");
    expect(result.customerFirstName).toBe("Wayne");

    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: result.enquiryId },
    });
    expect(activity.type).toBe("CALLBACK_REQUEST");
    expect(activity.companyId).toBe(companyId);
    expect(activity.subject).toBe("Callback requested");
    expect(activity.body).toContain("Wayne Radford");
    expect(activity.body).toContain("Assigned to: Luke Andrews");
    expect(activity.body).toContain(`Please call about stock ${suffix}`);

    const meta = activity.metadata as Record<string, unknown>;
    expect(meta["contactId"]).toBe(contactId);
    expect(meta["salesRepId"]).toBe(salesRepId);
    expect(meta["companyName"]).toBe("testy");

    const task = await prisma.task.findFirst({
      where: { companyId, title: "Call customer", description: { contains: suffix } },
    });
    expect(task).toBeTruthy();
    expect(task!.assigneeId).toBe(salesRepUserId);
    expect(task!.status).toBe("OPEN");

    const leadsAfter = await prisma.lead.count({
      where: { source: CALLBACK_REQUEST_LEAD_SOURCE },
    });
    expect(leadsAfter).toBe(leadsBefore);

    const emails = await prisma.transactionalEmail.findMany({
      where: {
        purpose: "CALLBACK_REQUEST_INTERNAL",
        entityId: result.enquiryId,
      },
    });
    expect(emails.length).toBeGreaterThan(0);
    const tos = emails.map((e) => e.toEmail);
    expect(tos).toContain(`cb.luke.${suffix}@automotivebrands.co.uk`);
    expect(tos).toContain(`trade.cb.${suffix}@example.invalid`);
    expect(emails[0]!.htmlBody).not.toContain("<script>");
    expect(emails.some((e) => e.subject.includes("REQUEST A CALLBACK") || e.textBody.includes("REQUEST A CALLBACK"))).toBe(
      true,
    );

    // Company master record unchanged by form company field
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.name).toBe(`Callback Co ${suffix}`);
    expect(company.tradingName).toBe("testy");
  });

  it("dedupes rapid resubmits and rejects honeypot", async () => {
    const payload = {
      name: "Wayne Radford",
      email: `cb.buyer.${suffix}@example.invalid`,
      telephone: "07999111222",
      message: `Duplicate guard ${suffix}`,
      websiteConfirm: "",
      clientRequestId: `dup-${suffix}`,
    };
    const first = await submitCallbackEnquiry(payload, { userId: buyerId });
    const second = await submitCallbackEnquiry(payload, { userId: buyerId });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.enquiryId).toBe(first.enquiryId);
    }

    const count = await prisma.activity.count({
      where: {
        companyId,
        type: "CALLBACK_REQUEST",
        body: { contains: `Duplicate guard ${suffix}` },
      },
    });
    expect(count).toBe(1);

    await expect(
      submitCallbackEnquiry({ ...payload, websiteConfirm: "http://spam" }, { userId: buyerId }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("falls back to trade team when no SalesRep assignment", async () => {
    const lonely = await prisma.company.create({
      data: { name: `Lonely CB ${suffix}`, status: "ACTIVE" },
    });
    const lonelyBuyer = await ensureUser(`cb.lonely.${suffix}@example.invalid`, [], "TRADE", "Lonely");
    await prisma.companyUser.create({
      data: {
        companyId: lonely.id,
        userId: lonelyBuyer,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    const result = await submitCallbackEnquiry(
      {
        name: "Lonely",
        email: `cb.lonely.${suffix}@example.invalid`,
        message: `No AM ${suffix}`,
        websiteConfirm: "",
        clientRequestId: `lonely-${suffix}`,
      },
      { userId: lonelyBuyer },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountManagerName).toBeNull();

    const task = await prisma.task.findFirst({
      where: { companyId: lonely.id, title: "Call customer" },
    });
    expect(task?.assigneeId).toBeNull();

    const emails = await prisma.transactionalEmail.findMany({
      where: { purpose: "CALLBACK_REQUEST_INTERNAL", entityId: result.enquiryId },
    });
    expect(emails.map((e) => e.toEmail)).toContain(`trade.cb.${suffix}@example.invalid`);
  });
});

describe("anonymous callback submission", () => {
  it("creates a Lead for a genuine prospect", async () => {
    const result = await submitCallbackEnquiry({
      name: "Prospect Person",
      company: "Prospect Ltd",
      email: `prospect.${suffix}@example.invalid`,
      telephone: "",
      message: `New prospect callback ${suffix}`,
      websiteConfirm: "",
      clientRequestId: `prospect-${suffix}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("lead");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.enquiryId } });
    expect(lead.source).toBe(CALLBACK_REQUEST_LEAD_SOURCE);
    expect(lead.companyId).toBeNull();
    expect(lead.notes).toContain(`New prospect callback ${suffix}`);
  });

  it("accepts telephone-only contact and validates required fields", async () => {
    const phoneOnly = await submitCallbackEnquiry({
      name: "Phone Only",
      telephone: "07000111222",
      message: `Phone only ${suffix}`,
      websiteConfirm: "",
    });
    expect(phoneOnly.ok).toBe(true);

    const invalid = await submitCallbackEnquiry({
      name: "",
      message: "",
      websiteConfirm: "",
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.fieldErrors).toBeTruthy();
  });

  it("associates by contact email without creating a duplicate Lead", async () => {
    const leadsBefore = await prisma.lead.count({
      where: { source: CALLBACK_REQUEST_LEAD_SOURCE },
    });
    const result = await submitCallbackEnquiry({
      name: "Wayne Radford",
      email: `cb.buyer.${suffix}@example.invalid`,
      message: `Matched contact path ${suffix}`,
      websiteConfirm: "",
      clientRequestId: `match-${suffix}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("activity");

    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: result.enquiryId },
    });
    expect(activity.companyId).toBe(companyId);

    const leadsAfter = await prisma.lead.count({
      where: { source: CALLBACK_REQUEST_LEAD_SOURCE },
    });
    expect(leadsAfter).toBe(leadsBefore);
  });
});

describe("email failure does not lose enquiry", () => {
  it("keeps the activity when notification recipients are empty", async () => {
    await prisma.emailSettings.update({
      where: { id: "singleton" },
      data: { tradeApplicationRecipients: [], orderNotificationRecipients: [] },
    });

    // Temporarily remove sales assignment email path by using company without AM
    const bare = await prisma.company.create({
      data: { name: `Bare CB ${suffix}`, status: "ACTIVE" },
    });
    const bareBuyer = await ensureUser(`cb.bare.${suffix}@example.invalid`, [], "TRADE", "Bare");
    await prisma.companyUser.create({
      data: {
        companyId: bare.id,
        userId: bareBuyer,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    const result = await submitCallbackEnquiry(
      {
        name: "Bare",
        email: `cb.bare.${suffix}@example.invalid`,
        message: `Persist without email ${suffix}`,
        websiteConfirm: "",
        clientRequestId: `bare-${suffix}`,
      },
      { userId: bareBuyer },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const activity = await prisma.activity.findUnique({ where: { id: result.enquiryId } });
    expect(activity).toBeTruthy();

    // restore recipients for remaining tests
    await prisma.emailSettings.update({
      where: { id: "singleton" },
      data: { tradeApplicationRecipients: [`trade.cb.${suffix}@example.invalid`] },
    });
  });
});

describe("admin visibility and isolation", () => {
  it("shows callback on company activity timeline for admin", async () => {
    const timeline = await listCompanyActivity(adminId, companyId, 50);
    const hit = timeline.find(
      (row) => row.kind === "activity" && row.title === "Callback requested",
    );
    expect(hit).toBeTruthy();
    expect(hit!.body).toContain("Wayne Radford");
  });

  it("does not leak activities across companies", async () => {
    const otherTimeline = await listCompanyActivity(adminId, otherCompanyId, 50);
    const leaked = otherTimeline.some(
      (row) =>
        row.kind === "activity" &&
        typeof row.body === "string" &&
        row.body.includes(`Please call about stock ${suffix}`),
    );
    expect(leaked).toBe(false);
  });

  it("blocks trade users from other companies' activity", async () => {
    await expect(listCompanyActivity(otherBuyerId, companyId)).rejects.toBeInstanceOf(AuthError);
  });
});
