import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  resolveAccountManagerForCompany,
  resolveAccountManagerForSalesRep,
  resolveGeneralTradeContact,
} from "@/server/sales/account-manager";
import { getPortalDashboard } from "@/server/portal/dashboard";
import { updateCompany } from "@/server/companies/service";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let companyId = "";
let otherCompanyId = "";
let buyerId = "";
let adminId = "";
let wayneUserId = "";
let tomUserId = "";
let wayneRepId = "";
let tomRepId = "";
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

  adminId = await ensureUser(`am.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
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

  wayneUserId = await ensureUser(
    `wayne.radford.${suffix}@automotivebrands.co.uk`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
  );
  await prisma.user.update({
    where: { id: wayneUserId },
    data: { name: "Wayne Radford" },
  });
  const wayne = await prisma.salesRep.create({
    data: {
      userId: wayneUserId,
      code: `WR${suffix.slice(-4).toUpperCase()}`,
      active: true,
      displayName: "Wayne Radford",
      jobTitle: "Account Manager",
      businessEmail: `wayne.radford.${suffix}@automotivebrands.co.uk`,
      phone: "01789330668",
      mobile: "07718149284",
      customerContactEnabled: true,
    },
  });
  wayneRepId = wayne.id;

  tomUserId = await ensureUser(
    `tom.gibbons.${suffix}@automotivebrands.co.uk`,
    ["SALES_REPRESENTATIVE"],
    "INTERNAL",
  );
  await prisma.user.update({
    where: { id: tomUserId },
    data: { name: "Tom Gibbons" },
  });
  const tom = await prisma.salesRep.create({
    data: {
      userId: tomUserId,
      code: `TG${suffix.slice(-4).toUpperCase()}`,
      active: true,
      displayName: "Tom Gibbons",
      jobTitle: "Account Manager",
      businessEmail: `tom.gibbons.${suffix}@automotivebrands.co.uk`,
      phone: "01234567890",
      mobile: "07000000001",
      customerContactEnabled: true,
    },
  });
  tomRepId = tom.id;

  const media = await prisma.cmsMedia.create({
    data: {
      filename: `am-${suffix}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 100,
      storageKey: `test/am-${suffix}.jpg`,
      altText: "Wayne Radford",
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

  it("shows assigned SalesRep name/email/phones from the same SalesRep record", async () => {
    await prisma.companyAssignment.create({
      data: { companyId, salesRepId: wayneRepId, isPrimary: true },
    });
    const am = await resolveAccountManagerForCompany(companyId);
    expect(am).not.toBeNull();
    expect(am!.name).toBe("Wayne Radford");
    expect(am!.jobTitle).toBe("Account Manager");
    expect(am!.email).toBe(`wayne.radford.${suffix}@automotivebrands.co.uk`);
    expect(am!.phone).toBe("01789330668");
    expect(am!.mobile).toBe("07718149284");
    expect(am!.mailtoHref).toContain("mailto:");
    expect(am!.initials).toBe("WR");
    expect(JSON.stringify(am)).not.toContain(wayneRepId);
    expect(JSON.stringify(am)).not.toContain("Autopart");
  });

  it("does not mix TeamMember name with SalesRep contact details", async () => {
    // Wrongly linked public TeamMember under Wayne — must NOT steal the display name.
    await prisma.teamMember.create({
      data: {
        firstName: "Tom",
        lastName: "Gibbons",
        jobTitle: "Wrong Source",
        email: `tom.wrong.${suffix}@automotivebrands.co.uk`,
        phone: "09999 999999",
        mobile: "07999 999999",
        isPublic: true,
        isContactable: true,
        salesRepId: wayneRepId,
        photoMediaId: mediaId,
      },
    });

    const am = await resolveAccountManagerForCompany(companyId);
    expect(am!.name).toBe("Wayne Radford");
    expect(am!.email).toBe(`wayne.radford.${suffix}@automotivebrands.co.uk`);
    expect(am!.phone).toBe("01789330668");
    expect(am!.mobile).toBe("07718149284");
    expect(am!.jobTitle).toBe("Account Manager");
    expect(am!.name).not.toContain("Tom");
    expect(am!.email).not.toContain("tom.wrong");
    expect(am!.phone).not.toBe("09999 999999");

    await prisma.salesRep.update({
      where: { id: wayneRepId },
      data: { photoMediaId: mediaId, photoAlt: "Wayne Radford" },
    });
    const withPhoto = await resolveAccountManagerForCompany(companyId);
    expect(withPhoto!.photo?.src).toContain(mediaId);
    expect(withPhoto!.photo?.alt).toContain("Wayne");
  });

  it("omits inactive SalesRep", async () => {
    await prisma.salesRep.update({ where: { id: wayneRepId }, data: { active: false } });
    expect(await resolveAccountManagerForCompany(companyId)).toBeNull();
    await prisma.salesRep.update({ where: { id: wayneRepId }, data: { active: true } });
  });

  it("resolves only the current primary when historic assignments exist", async () => {
    await prisma.companyAssignment.deleteMany({ where: { companyId } });
    await prisma.companyAssignment.create({
      data: { companyId, salesRepId: tomRepId, isPrimary: false },
    });
    await prisma.companyAssignment.create({
      data: { companyId, salesRepId: wayneRepId, isPrimary: true },
    });

    const am = await resolveAccountManagerForCompany(companyId);
    expect(am!.name).toBe("Wayne Radford");
    expect(am!.email).toContain("wayne.radford");
    expect(am!.name).not.toContain("Tom");

    const byRep = await resolveAccountManagerForSalesRep(wayneRepId);
    expect(byRep?.name).toBe("Wayne Radford");
    expect(byRep?.phone).toBe(am!.phone);
  });

  it("isolates companies — other company does not inherit assignment", async () => {
    const other = await resolveAccountManagerForCompany(otherCompanyId);
    expect(other).toBeNull();
  });
});

describe("portal dashboard account manager", () => {
  it("matches admin commercial salesperson after reassignment", async () => {
    await prisma.companyAssignment.deleteMany({ where: { companyId } });
    await prisma.companyAssignment.create({
      data: { companyId, salesRepId: tomRepId, isPrimary: true },
    });

    let dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager?.name).toBe("Tom Gibbons");
    expect(dash.accountManager?.email).toContain("tom.gibbons");

    const updated = await updateCompany(adminId, {
      id: companyId,
      salesRepId: wayneRepId,
    });
    expect(updated.salesperson?.salesRepId).toBe(wayneRepId);
    expect(updated.salesperson?.name).toBe("Wayne Radford");
    expect(updated.status).toBe("ACTIVE");

    dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager?.name).toBe("Wayne Radford");
    expect(dash.accountManager?.email).toContain("wayne.radford");
    expect(dash.accountManager?.phone).toBe("01789330668");
    expect(dash.accountManager?.mobile).toBe("07718149284");
    expect(dash.accountManager?.name).not.toContain("Tom");
  });

  it("shows general team contact fallback when unassigned", async () => {
    await prisma.companyAssignment.deleteMany({ where: { companyId } });
    const dash = await getPortalDashboard(buyerId);
    expect(dash.accountManager).toBeNull();
    expect(dash.generalContact).toBeTruthy();
    expect(dash.generalContact.label).toBe("Automotive Brands Team");
  });
});

describe("resolveGeneralTradeContact", () => {
  it("returns configured email only when present", async () => {
    const contact = await resolveGeneralTradeContact();
    expect(contact.label).toBe("Automotive Brands Team");
    if (contact.email) {
      expect(contact.mailtoHref).toBe(`mailto:${contact.email}`);
    } else {
      expect(contact.mailtoHref).toBeNull();
    }
  });
});
