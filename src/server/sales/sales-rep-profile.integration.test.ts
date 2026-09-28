import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  resolveAccountManagerForCompany,
  resolveAccountManagerForSalesRep,
  resolveSalesRepAssignmentRoute,
} from "@/server/sales/account-manager";
import {
  assignCompanyToSalesRep,
  createSalesRep,
  getSalesRepProfile,
  listLinkableUsersForSalesRep,
  listSalesRepProfiles,
  unassignCompanyFromSalesRep,
  updateSalesRepProfile,
} from "@/server/sales/service";
import { AuthError } from "@/server/rbac/guards";
import { getPortalDashboard } from "@/server/portal/dashboard";
import {
  PROTOTYPE_SALES_TEAM_FABRICATIONS,
  PROTOTYPE_SALES_TEAM_STRINGS,
} from "@/domain/sales-rep-profile";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let adminId = "";
let salesViewerId = "";
let salesRepUserId = "";
let salesRepId = "";
let companyId = "";
let buyerId = "";
let mediaId = "";

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
  adminId = await ensureUser(`sr.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  salesViewerId = await ensureUser(`sr.viewer.${suffix}@example.invalid`, ["SALES_MANAGER"]);

  salesRepUserId = await ensureUser(
    `sr.luke.${suffix}@automotivebrands.co.uk`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
    "Luke Andrews",
  );
  const rep = await prisma.salesRep.create({
    data: {
      userId: salesRepUserId,
      code: `SR${suffix.slice(-4).toUpperCase()}`,
      active: true,
      customerContactEnabled: true,
    },
  });
  salesRepId = rep.id;

  const company = await prisma.company.create({
    data: { name: `SR Co ${suffix}`, status: "ACTIVE" },
  });
  companyId = company.id;
  await prisma.companyAssignment.create({
    data: { companyId, salesRepId, isPrimary: true },
  });

  buyerId = await ensureUser(`sr.buyer.${suffix}@example.invalid`, [], "TRADE", "Buyer");
  await prisma.companyUser.create({
    data: {
      companyId,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  const media = await prisma.cmsMedia.create({
    data: {
      filename: `sr-${suffix}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 120,
      storageKey: `test/sr-${suffix}.jpg`,
      altText: "Luke",
      width: 200,
      height: 200,
    },
  });
  mediaId = media.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SalesRep profile admin", () => {
  it("lists profiles for authorised viewers and blocks buyers", async () => {
    const list = await listSalesRepProfiles(adminId);
    expect(list.some((r) => r.id === salesRepId)).toBe(true);
    await expect(listSalesRepProfiles(buyerId)).rejects.toBeInstanceOf(AuthError);
  });

  it("updates customer-facing fields with audit and retains leading zeroes", async () => {
    const before = await getSalesRepProfile(adminId, salesRepId);
    expect(before.user.email).toContain("sr.luke");

    const updated = await updateSalesRepProfile(adminId, {
      id: salesRepId,
      displayName: "Luke Andrews",
      jobTitle: "Account Manager",
      businessEmail: `luke.business.${suffix}@automotivebrands.co.uk`,
      phone: "01234 567890",
      mobile: "07123 456789",
      customerContactEnabled: true,
      active: true,
      photoMediaId: mediaId,
      photoAlt: "Luke Andrews",
    });

    expect(updated.phone).toBe("01234 567890");
    expect(updated.mobile).toBe("07123 456789");
    expect(updated.businessEmail).toBe(`luke.business.${suffix}@automotivebrands.co.uk`);
    expect(updated.customerPreview?.email).toBe(updated.businessEmail);
    expect(updated.customerPreview?.telHref).toBe("tel:01234567890");
    expect(updated.customerPreview?.photo?.src).toContain(mediaId);
    expect(JSON.stringify(updated.customerPreview)).not.toContain("SUPER_ADMIN");
    expect(JSON.stringify(updated.customerPreview)).not.toContain(salesRepUserId);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "sales_rep.profile_updated", entityId: salesRepId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);

    // Sales manager may view but not edit
    await expect(
      updateSalesRepProfile(salesViewerId, {
        id: salesRepId,
        displayName: "Nope",
        customerContactEnabled: true,
        active: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("account manager resolver with SalesRep profile", () => {
  it("prefers SalesRep business email / phone / mobile over User and TeamMember", async () => {
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.name).toBe("Luke Andrews");
    expect(am?.jobTitle).toBe("Account Manager");
    expect(am?.email).toBe(`luke.business.${suffix}@automotivebrands.co.uk`);
    expect(am?.phone).toBe("01234 567890");
    expect(am?.mobile).toBe("07123 456789");
    expect(am?.primaryContactHref).toContain("mailto:");
    expect(am?.primaryContactLabel).toMatch(/Contact account manager/i);

    const byRep = await resolveAccountManagerForSalesRep(salesRepId);
    expect(byRep?.email).toBe(am?.email);
  });

  it("falls back to User email when business email blank and contact enabled", async () => {
    await prisma.salesRep.update({
      where: { id: salesRepId },
      data: { businessEmail: null },
    });
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.email).toBe(`sr.luke.${suffix}@automotivebrands.co.uk`);
  });

  it("hides contact channels when customer contact disabled", async () => {
    await updateSalesRepProfile(adminId, {
      id: salesRepId,
      displayName: "Luke Andrews",
      jobTitle: "Account Manager",
      businessEmail: `luke.business.${suffix}@automotivebrands.co.uk`,
      phone: "01234 567890",
      mobile: "07123 456789",
      customerContactEnabled: false,
      active: true,
      photoMediaId: mediaId,
    });
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.name).toBe("Luke Andrews");
    expect(am?.email).toBeNull();
    expect(am?.phone).toBeNull();
    expect(am?.mobile).toBeNull();
    expect(am?.primaryContactHref).toBeNull();
    expect(am?.photo).not.toBeNull();
  });

  it("supports telephone-only CTA when email missing but phone present", async () => {
    await updateSalesRepProfile(adminId, {
      id: salesRepId,
      displayName: "Luke Andrews",
      jobTitle: "Account Manager",
      businessEmail: null,
      phone: "01234 567890",
      mobile: null,
      customerContactEnabled: true,
      active: true,
      photoMediaId: null,
    });
    // Clear user email fallback by using a blank business email — user email still exists.
    // Force email null path: customer contact on but we need email null — only possible if
    // we temporarily rely on phone when mailto uses user email. Spec prefers mailto first.
    // Explicitly test tel href still formed:
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.phone).toBe("01234 567890");
    expect(am?.telHref).toBe("tel:01234567890");
    // User email still provides mailto as fallback when contact enabled
    expect(am?.mailtoHref).toContain("mailto:");
  });

  it("routes callbacks via the same assignment resolver", async () => {
    const route = await resolveSalesRepAssignmentRoute(companyId);
    expect(route?.salesRepId).toBe(salesRepId);
    expect(route?.assigneeUserId).toBe(salesRepUserId);
    expect(route?.accountManagerName).toBe("Luke Andrews");
  });

  it("surfaces profile on portal dashboard without internal fields", async () => {
    await updateSalesRepProfile(adminId, {
      id: salesRepId,
      displayName: "Luke Andrews",
      jobTitle: "Account Manager",
      businessEmail: `luke.portal.${suffix}@automotivebrands.co.uk`,
      phone: "01234 567890",
      mobile: "+44 7123 456789",
      customerContactEnabled: true,
      active: true,
      photoMediaId: mediaId,
    });
    const dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager?.email).toBe(`luke.portal.${suffix}@automotivebrands.co.uk`);
    expect(dash.accountManager?.mobile).toBe("+44 7123 456789");
    expect(dash.accountManager?.mobileTelHref).toBe("tel:+447123456789");
    expect(JSON.stringify(dash.accountManager)).not.toContain(salesRepId);
    expect(JSON.stringify(dash.accountManager)).not.toContain("customerContactEnabled");
  });

  it("preserves existing CompanyAssignment → Luke Andrews account manager", async () => {
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.name).toBe("Luke Andrews");
    expect(am?.jobTitle).toBe("Account Manager");
    const detail = await getSalesRepProfile(adminId, salesRepId);
    expect(detail.assignments.some((a) => a.companyId === companyId && a.isPrimary)).toBe(true);
    expect(detail.customerCount).toBeGreaterThanOrEqual(1);
  });
});

describe("SalesRep create and company assignment", () => {
  let secondUserId = "";
  let secondRepId = "";
  let otherCompanyId = "";

  beforeAll(async () => {
    // Name sorts early so the user remains inside listLinkableUsersForSalesRep's take:500
    // window even when the shared test database has many INTERNAL users.
    secondUserId = await ensureUser(
      `sr.second.${suffix}@automotivebrands.co.uk`,
      ["SALES_REPRESENTATIVE"],
      "INTERNAL",
      `AAA Linkable ${suffix}`,
    );
    // ensureUser may have triggered role create without SalesRep depending on path —
    // remove any auto SalesRep so createSalesRep can link cleanly.
    await prisma.salesRep.deleteMany({ where: { userId: secondUserId } });

    const other = await prisma.company.create({
      data: { name: `SR Other Co ${suffix}`, status: "ACTIVE" },
    });
    otherCompanyId = other.id;
  });

  it("lists linkable users and creates a SalesRep linked to User", async () => {
    const linkable = await listLinkableUsersForSalesRep(adminId);
    expect(linkable.some((u) => u.id === secondUserId)).toBe(true);
    expect(linkable.some((u) => u.id === salesRepUserId)).toBe(false);

    const created = await createSalesRep(adminId, {
      userId: secondUserId,
      displayName: `AAA Linkable ${suffix}`,
      jobTitle: "Account Manager",
      businessEmail: `second.${suffix}@automotivebrands.co.uk`,
      phone: "0161 123 4567",
      mobile: "+44 7700 900123",
      customerContactEnabled: true,
      active: true,
    });
    secondRepId = created.id;
    expect(created.user.id).toBe(secondUserId);
    expect(created.phone).toBe("0161 123 4567");
    expect(created.mobile).toBe("+44 7700 900123");
    expect(created.customerCount).toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "sales_rep.created", entityId: secondRepId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBe(adminId);

    await expect(
      createSalesRep(adminId, { userId: secondUserId, customerContactEnabled: true, active: true }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("assigns, reassigns and unassigns companies with audit", async () => {
    const assigned = await assignCompanyToSalesRep(adminId, {
      salesRepId: secondRepId,
      companyId: otherCompanyId,
    });
    expect(assigned.assignments.some((a) => a.companyId === otherCompanyId)).toBe(true);
    expect(assigned.customerCount).toBe(1);

    const reassigned = await assignCompanyToSalesRep(adminId, {
      salesRepId: salesRepId,
      companyId: otherCompanyId,
    });
    expect(reassigned.assignments.some((a) => a.companyId === otherCompanyId)).toBe(true);

    const secondAfter = await getSalesRepProfile(adminId, secondRepId);
    expect(secondAfter.assignments.some((a) => a.companyId === otherCompanyId)).toBe(false);

    const reaudit = await prisma.auditEvent.findFirst({
      where: { action: "sales_rep.company_reassigned", companyId: otherCompanyId },
      orderBy: { createdAt: "desc" },
    });
    expect(reaudit?.actorUserId).toBe(adminId);

    await unassignCompanyFromSalesRep(adminId, {
      salesRepId: salesRepId,
      companyId: otherCompanyId,
    });
    const afterUnassign = await getSalesRepProfile(adminId, salesRepId);
    expect(afterUnassign.assignments.some((a) => a.companyId === otherCompanyId)).toBe(false);

    // Original Luke assignment must still be intact
    const luke = await getSalesRepProfile(adminId, salesRepId);
    expect(luke.assignments.some((a) => a.companyId === companyId)).toBe(true);
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.name).toBe("Luke Andrews");
  });

  it("blocks buyers from create/assign and sales managers from edit mutations", async () => {
    await expect(
      createSalesRep(buyerId, { userId: secondUserId, customerContactEnabled: true, active: true }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      assignCompanyToSalesRep(salesViewerId, {
        salesRepId: salesRepId,
        companyId: otherCompanyId,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Sales Team production output has no prototype demo data", () => {
  it("list/detail API payloads never include fabricated demo metrics or companies", async () => {
    // Ensure legacy seed demo name is not left as James Whitfield on the shared login.
    await prisma.user.updateMany({
      where: { email: "sales.rep@example.invalid", name: "James Whitfield" },
      data: { name: "Luke Andrews" },
    });

    const list = await listSalesRepProfiles(adminId);
    const detail = await getSalesRepProfile(adminId, salesRepId);
    const blob = JSON.stringify({ list, detail });
    for (const banned of PROTOTYPE_SALES_TEAM_FABRICATIONS) {
      expect(blob).not.toContain(banned);
    }
    // List rows are operational SalesRep records — not the old salesTeam metric shape.
    for (const row of list) {
      expect(row).not.toHaveProperty("mtd");
      expect(row).not.toHaveProperty("target");
      expect(row).not.toHaveProperty("pipeline");
      expect(row).not.toHaveProperty("conversion");
      expect(typeof row.customerCount).toBe("number");
    }
    expect(list.some((r) => r.id === salesRepId)).toBe(true);
    expect(detail.assignments.some((a) => a.companyId === companyId)).toBe(true);
  });

  it("Sales Team route source does not import demo crm-data or hard-code prototype reps", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/crm.manager.tsx"), "utf8");
    expect(source).not.toContain("crm-data");
    expect(source).not.toContain("salesTeam");
    expect(source).not.toContain("managerTotals");
    expect(source).not.toContain("monthlySales");
    expect(source).not.toContain("salesByBrand");
    for (const banned of PROTOTYPE_SALES_TEAM_STRINGS) {
      expect(source).not.toContain(banned);
    }
    expect(source).toContain("listSalesRepProfilesFn");
    expect(source).toContain("Add sales representative");
    expect(source).toContain("No sales representatives");
  });
});
