import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  resolveAccountManagerForCompany,
  resolveAccountManagerForSalesRep,
  resolveGeneralTradeContact,
} from "@/server/sales/account-manager";
import { getPortalDashboard } from "@/server/portal/dashboard";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let companyId = "";
let otherCompanyId = "";
let buyerId = "";
let salesRepUserId = "";
let salesRepId = "";
let mediaId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
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
    data: { name: `AM Co ${suffix}`, status: "ACTIVE" },
  });
  companyId = company.id;
  const other = await prisma.company.create({
    data: { name: `AM Other ${suffix}`, status: "ACTIVE" },
  });
  otherCompanyId = other.id;

  buyerId = await ensureUser(`am.buyer.${suffix}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  salesRepUserId = await ensureUser(
    `luke.andrews.${suffix}@automotivebrands.co.uk`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
  );
  await prisma.user.update({
    where: { id: salesRepUserId },
    data: { name: "Luke Andrews" },
  });
  const rep = await prisma.salesRep.create({
    data: { userId: salesRepUserId, code: `LA${suffix.slice(-4).toUpperCase()}`, active: true },
  });
  salesRepId = rep.id;

  const media = await prisma.cmsMedia.create({
    data: {
      filename: `am-${suffix}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 100,
      storageKey: `test/am-${suffix}.jpg`,
      altText: "Luke Andrews",
      width: 200,
      height: 200,
    },
  });
  mediaId = media.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveAccountManagerForCompany", () => {
  it("returns null when no SalesRep is assigned", async () => {
    await prisma.companyAssignment.deleteMany({ where: { companyId } });
    expect(await resolveAccountManagerForCompany(companyId)).toBeNull();
  });

  it("shows assigned SalesRep name and user email without inventing phone/photo", async () => {
    await prisma.companyAssignment.create({
      data: { companyId, salesRepId, isPrimary: true },
    });
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am).not.toBeNull();
    expect(am!.name).toBe("Luke Andrews");
    expect(am!.jobTitle).toBe("Account Manager");
    expect(am!.email).toContain("luke.andrews");
    expect(am!.mailtoHref).toContain("mailto:");
    expect(am!.primaryContactHref).toContain("mailto:");
    expect(am!.phone).toBeNull();
    expect(am!.mobile).toBeNull();
    expect(am!.photo).toBeNull();
    expect(am!.initials).toBe("LA");
    expect(JSON.stringify(am)).not.toContain(salesRepId);
    expect(JSON.stringify(am)).not.toContain("Autopart");
    expect(JSON.stringify(am)).not.toContain("customerContactEnabled");
  });

  it("omits inactive SalesRep", async () => {
    await prisma.salesRep.update({ where: { id: salesRepId }, data: { active: false } });
    expect(await resolveAccountManagerForCompany(companyId)).toBeNull();
    await prisma.salesRep.update({ where: { id: salesRepId }, data: { active: true } });
  });

  it("enriches from public contactable TeamMember (phone, mobile, photo, job title)", async () => {
    const member = await prisma.teamMember.create({
      data: {
        firstName: "Luke",
        lastName: "Andrews",
        jobTitle: "Account Manager",
        email: `luke.public.${suffix}@automotivebrands.co.uk`,
        phone: "01234 567890",
        mobile: "07123 456789",
        isPublic: true,
        isContactable: true,
        salesRepId,
        photoMediaId: mediaId,
        photoAlt: "Luke Andrews",
      },
    });

    const am = await resolveAccountManagerForCompany(companyId);
    expect(am!.name).toBe("Luke Andrews");
    expect(am!.jobTitle).toBe("Account Manager");
    expect(am!.email).toBe(`luke.public.${suffix}@automotivebrands.co.uk`);
    expect(am!.phone).toBe("01234 567890");
    expect(am!.mobile).toBe("07123 456789");
    expect(am!.telHref).toBe("tel:01234567890");
    expect(am!.mobileTelHref).toBe("tel:07123456789");
    expect(am!.photo?.src).toContain(mediaId);
    expect(am!.photo?.alt).toContain("Luke");

    // Same resolver for SalesRep id (Quotes)
    const byRep = await resolveAccountManagerForSalesRep(salesRepId);
    expect(byRep?.email).toBe(am!.email);
    expect(byRep?.phone).toBe(am!.phone);

    // Non-contactable hides phone/mobile/public email (falls back to user email)
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { isContactable: false },
    });
    const hiddenContact = await resolveAccountManagerForCompany(companyId);
    expect(hiddenContact!.phone).toBeNull();
    expect(hiddenContact!.mobile).toBeNull();
    expect(hiddenContact!.email).toContain("luke.andrews");
    expect(hiddenContact!.photo).not.toBeNull(); // photo still ok when public

    // Non-public profile ignored for enrichment
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { isPublic: false, isContactable: true },
    });
    const privateProfile = await resolveAccountManagerForCompany(companyId);
    expect(privateProfile!.phone).toBeNull();
    expect(privateProfile!.photo).toBeNull();
    expect(privateProfile!.email).toContain("luke.andrews");

    await prisma.teamMember.delete({ where: { id: member.id } });
  });

  it("isolates companies — other company does not inherit assignment", async () => {
    const other = await resolveAccountManagerForCompany(otherCompanyId);
    expect(other).toBeNull();
  });
});

describe("portal dashboard account manager", () => {
  it("surfaces enriched AM via the shared resolver", async () => {
    await prisma.teamMember.create({
      data: {
        firstName: "Luke",
        lastName: "Andrews",
        jobTitle: "Regional Account Manager",
        email: `dash.luke.${suffix}@automotivebrands.co.uk`,
        phone: "01234 111111",
        mobile: "07111 111111",
        isPublic: true,
        isContactable: true,
        salesRepId,
      },
    });

    const dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager?.name).toBe("Luke Andrews");
    expect(dash.accountManager?.jobTitle).toBe("Regional Account Manager");
    expect(dash.accountManager?.phone).toBe("01234 111111");
    expect(dash.accountManager?.mobile).toBe("07111 111111");
    expect(dash.accountManager?.mailtoHref).toContain("mailto:");
    expect(dash.features.quotes).toBe(true);
    // No internal fields
    expect(JSON.stringify(dash.accountManager)).not.toContain(salesRepId);
    expect(JSON.stringify(dash.accountManager)).not.toContain("targetMtd");
  });

  it("shows general contact fallback when unassigned", async () => {
    await prisma.companyAssignment.deleteMany({ where: { companyId } });
    const dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager).toBeNull();
    expect(dash.generalContact).toBeTruthy();
    expect(dash.generalContact.label).toBe("Automotive Brands");
  });
});

describe("resolveGeneralTradeContact", () => {
  it("returns configured email only when present", async () => {
    const contact = await resolveGeneralTradeContact();
    expect(contact.label).toBe("Automotive Brands");
    if (contact.email) {
      expect(contact.mailtoHref).toBe(`mailto:${contact.email}`);
    } else {
      expect(contact.mailtoHref).toBeNull();
    }
  });
});
