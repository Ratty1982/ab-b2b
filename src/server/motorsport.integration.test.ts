import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { submitMotorsportPartnershipEnquiry } from "@/server/motorsport/service";
import { MOTORSPORT_PARTNERSHIP_LEAD_SOURCE } from "@/domain/motorsport";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();

beforeAll(async () => {
  await bootstrapRbac(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("motorsport partnership enquiry → Lead", () => {
  it("creates a Lead with MOTORSPORT_PARTNERSHIP source", async () => {
    const stamp = Date.now();
    const result = await submitMotorsportPartnershipEnquiry({
      companyName: `Motorsport Co ${stamp}`,
      contactName: "Jordan Lead",
      email: `jordan-${stamp}@example.invalid`,
      telephone: "07000000000",
      industry: "Distribution",
      interestedIn: "Commercial Sponsorship",
      approximateBudget: "£25,000–£50,000",
      message: "Interested in discussing brand exposure.",
      consent: true,
      websiteConfirm: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } });
    expect(lead.source).toBe(MOTORSPORT_PARTNERSHIP_LEAD_SOURCE);
    expect(lead.status).toBe("NEW");
    expect(lead.companyName).toContain("Motorsport Co");
    expect(lead.notes).toContain("Commercial Sponsorship");
    expect(lead.notes).toContain("£25,000–£50,000");
    expect(lead.ownerId).toBeNull();

    // Public must not gain lead listing via this path — only create.
    expect(Object.keys(result)).not.toContain("notes");
  });

  it("returns field errors for invalid payload without creating a lead", async () => {
    const before = await prisma.lead.count({
      where: { source: MOTORSPORT_PARTNERSHIP_LEAD_SOURCE },
    });
    const result = await submitMotorsportPartnershipEnquiry({
      companyName: "",
      contactName: "X",
      email: "bad",
      interestedIn: "Not A Real Option",
      message: "",
      consent: false,
      websiteConfirm: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toBeTruthy();
    const after = await prisma.lead.count({
      where: { source: MOTORSPORT_PARTNERSHIP_LEAD_SOURCE },
    });
    expect(after).toBe(before);
  });

  it("dedupes rapid resubmits and rejects honeypot", async () => {
    const stamp = Date.now();
    const payload = {
      companyName: `Dup Co ${stamp}`,
      contactName: "Sam",
      email: `sam-${stamp}@example.invalid`,
      interestedIn: "Other" as const,
      message: "Hello again",
      consent: true as const,
      websiteConfirm: "",
    };
    const first = await submitMotorsportPartnershipEnquiry(payload);
    const second = await submitMotorsportPartnershipEnquiry(payload);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.leadId).toBe(first.leadId);
    }

    await expect(
      submitMotorsportPartnershipEnquiry({ ...payload, websiteConfirm: "http://spam" }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
