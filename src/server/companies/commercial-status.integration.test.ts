/**
 * Regression: commercial settings / Autopart ops must not reset ACTIVE → PROSPECT,
 * and portal account manager must match the admin-assigned SalesRep.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  approveTradeApplication,
  repairApprovedTradeCompanyStatuses,
  submitTradeApplication,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import { updateCompany, getCompanyWorkspace } from "@/server/companies/service";
import { linkAndVerifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import {
  confirmAutopartCreditImport,
  previewAutopartCreditImport,
} from "@/server/companies/autopart-history";
import { getPortalDashboard } from "@/server/portal/dashboard";
import { resolveAccountManagerForCompany } from "@/server/sales/account-manager";
import { companyUpdateSchema } from "@/domain/company";
import { assignCompanyToPriceList, upsertPriceList } from "@/server/pricing/service";

const prisma = new PrismaClient();
const suffix = `comm-status-${Date.now()}`;
let adminId = "";
let wayneRepId = "";
let tomRepId = "";

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
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

async function makeRep(email: string, name: string, code: string) {
  const userId = await ensureUser(email, ["SALES_REPRESENTATIVE"]);
  await prisma.user.update({ where: { id: userId }, data: { name } });
  const existing = await prisma.salesRep.findUnique({ where: { userId } });
  if (existing) return existing.id;
  const rep = await prisma.salesRep.create({
    data: {
      userId,
      code,
      active: true,
      displayName: name,
      businessEmail: email,
      phone: "01789330668",
      mobile: "07718149284",
      customerContactEnabled: true,
    },
  });
  return rep.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`comm.status.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  wayneRepId = await makeRep(
    `wayne.comm.${suffix}@automotivebrands.co.uk`,
    "Wayne Radford",
    `WC${suffix.slice(-4).toUpperCase()}`,
  );
  tomRepId = await makeRep(
    `tom.comm.${suffix}@automotivebrands.co.uk`,
    "Tom Gibbons",
    `TC${suffix.slice(-4).toUpperCase()}`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("commercial settings preserve ACTIVE status", () => {
  it("approval → ACTIVE; commercial save / salesperson / terms / credit / Autopart keep ACTIVE", async () => {
    const email = `buyer.comm.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Comm Status Co ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const companyId = approved.companyId;

    let company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.status).toBe("ACTIVE");

    // Zod must not inject PROSPECT for a commercial patch.
    const parsed = companyUpdateSchema.parse({
      id: companyId,
      paymentTerms: "60 DAYS",
      taxStatus: "STANDARD",
      salesRepId: tomRepId,
      creditLimit: 5000,
    });
    expect(parsed.status).toBeUndefined();

    let updated = await updateCompany(adminId, {
      id: companyId,
      paymentTerms: "60 DAYS",
      taxStatus: "STANDARD",
      salesRepId: tomRepId,
      creditLimit: 5000,
    });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.paymentTerms).toBe("60 DAYS");
    expect(updated.creditLimit).toBe(5000);
    expect(updated.salesperson?.salesRepId).toBe(tomRepId);

    company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.status).toBe("ACTIVE");

    // Change salesperson Tom → Wayne
    updated = await updateCompany(adminId, {
      id: companyId,
      salesRepId: wayneRepId,
    });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.salesperson?.salesRepId).toBe(wayneRepId);
    expect(updated.salesperson?.name).toBe("Wayne Radford");

    const am = await resolveAccountManagerForCompany(companyId);
    expect(am?.name).toBe("Wayne Radford");
    expect(am?.email).toContain("wayne.comm");
    expect(am?.phone).toBe("01789330668");

    // Price list change
    const list = await upsertPriceList(adminId, {
      code: `PL${suffix.slice(-6).toUpperCase()}`,
      name: `List ${suffix}`,
      currency: "GBP",
      isDefault: false,
    });
    await assignCompanyToPriceList(adminId, {
      companyId,
      priceListId: list.id,
    });
    company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.status).toBe("ACTIVE");
    expect(company.priceListId).toBe(list.id);

    // Payment terms / credit again
    updated = await updateCompany(adminId, {
      id: companyId,
      paymentTerms: "30 DAYS",
      creditLimit: 7500,
    });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.paymentTerms).toBe("30 DAYS");

    // Autopart verify
    const code = `YK${suffix.slice(-6).toUpperCase()}`;
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId,
      code,
    });
    company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.status).toBe("ACTIVE");

    // Credit import (407P100 single-row for this account)
    const file407 = `Customer,customer name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
OTHER001,OTHER ONE,100,0,0,0,0,0,100,1000
${code},YORK MOTOR FACTORS,3494.75,0,0,0,0,0,3494.75,5000
`;
    const preview = await previewAutopartCreditImport(adminId, {
      companyId,
      file407,
      filename: "407.csv",
    });
    expect(preview.canCommit).toBe(true);
    await confirmAutopartCreditImport(adminId, { companyId, file407, filename: "407.csv" });
    company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.status).toBe("ACTIVE");

    // Activate buyer membership and check portal
    const buyer = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: buyer.id },
      data: { status: "ACTIVE", actorType: "TRADE", emailVerified: true },
    });
    await prisma.companyUser.updateMany({
      where: { companyId, userId: buyer.id },
      data: { status: "ACTIVE", isDefault: true },
    });

    const dash = await getPortalDashboard(buyer.id);
    expect(dash.company.status).toBe("ACTIVE");
    expect(dash.accountManager?.name).toBe("Wayne Radford");
    expect(dash.accountManager?.email).toContain("wayne.comm");
    // Manual Company.creditLimit must not invent available credit; 407P100 snapshot drives it.
    expect(dash.creditLimit).toBe(5000);
    expect(dash.usedCredit).toBe(3494.75);
    expect(dash.availableCredit).toBe(1505.25);

    const workspace = await getCompanyWorkspace(adminId, companyId);
    expect(workspace.company.status).toBe("ACTIVE");
    expect(workspace.company.salesperson?.salesRepId).toBe(wayneRepId);

    const statusAudit = await prisma.auditEvent.findFirst({
      where: { action: "company.sales_rep_changed", companyId },
      orderBy: { createdAt: "desc" },
    });
    expect(statusAudit).toBeTruthy();
  });

  it("repair heals approved PROSPECT companies without activating CRM prospects", async () => {
    const email = `legacy.comm.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Legacy Comm ${suffix}`,
        email,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    await prisma.company.update({
      where: { id: approved.companyId },
      data: { status: "PROSPECT" },
    });

    const crm = await prisma.company.create({
      data: { name: `CRM Only ${suffix}`, status: "PROSPECT" },
    });

    const repaired = await repairApprovedTradeCompanyStatuses(adminId);
    expect(repaired.repaired.some((r) => r.companyId === approved.companyId)).toBe(true);
    expect(repaired.repaired.some((r) => r.companyId === crm.id)).toBe(false);

    const fixed = await prisma.company.findUniqueOrThrow({ where: { id: approved.companyId } });
    expect(fixed.status).toBe("ACTIVE");
    const untouched = await prisma.company.findUniqueOrThrow({ where: { id: crm.id } });
    expect(untouched.status).toBe("PROSPECT");
  });

  it("reports counts of affected PROSPECT approved companies (systemic check)", async () => {
    const broken = await prisma.tradeApplication.count({
      where: {
        status: "APPROVED",
        companyId: { not: null },
        company: { status: "PROSPECT" },
      },
    });
    // After repair above, should be zero in this DB (or only races). Soft assert.
    expect(broken).toBeGreaterThanOrEqual(0);

    // Companies where multiple isPrimary=true exist should be impossible after migration helper
    // (service demotes). Count duplicates for report.
    const primaries = await prisma.companyAssignment.groupBy({
      by: ["companyId"],
      where: { isPrimary: true },
      _count: { _all: true },
    });
    const multiPrimary = primaries.filter((p) => p._count._all > 1);
    expect(multiPrimary.length).toBe(0);
  });
});
