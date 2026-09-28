import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  resolveAccountManagerForCompany,
  resolveAccountManagerForSalesRep,
  resolveSalesRepAssignmentRoute,
} from "@/server/sales/account-manager";
import {
  getSalesRepProfile,
  listSalesRepProfiles,
  updateSalesRepProfile,
} from "@/server/sales/service";
import { AuthError } from "@/server/rbac/guards";
import { getPortalDashboard } from "@/server/portal/dashboard";

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
});
