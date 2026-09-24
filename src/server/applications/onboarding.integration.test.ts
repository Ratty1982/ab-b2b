/**
 * Trade application onboarding journey — domain + service integration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  acceptTradeInvitation,
  approveTradeApplication,
  getInvitationPreview,
  getTradeApplication,
  listTradeApplications,
  markApplicationUnderReview,
  rejectTradeApplication,
  requestApplicationMoreInfo,
  submitTradeApplication,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import { setCompanyAutopartCustomerCode, verifyCompanyAutopartCustomerCode } from "@/server/companies/autopart-account";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { addToBasket, getBasket } from "@/server/basket/service";
import { saveProduct } from "@/server/catalogue/service";
import { hashInviteToken } from "@/domain/invitation";
import {
  BUSINESS_TYPES,
  tradeApplicationSubmitSchema,
} from "@/domain/trade-application";

const prisma = new PrismaClient();
const suffix = `onboard-${Date.now()}`;
let adminId = "";
let priceListId = "";
let variantId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email,
        actorType: "INTERNAL",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUnique({ where: { key } });
    if (!role) continue;
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
  adminId = await ensureUser(`onboard.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  const list = await prisma.priceList.create({
    data: {
      code: `PL-${suffix}`.slice(0, 20),
      name: `Onboard List ${suffix}`,
      currency: "GBP",
    },
  });
  priceListId = list.id;
  const product = await saveProduct(adminId, {
    sku: `ONB-${suffix}`.slice(0, 30),
    name: `Onboard SKU ${suffix}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 4.5,
    rrp: 9.99,
    packQty: 1,
    caseQty: 12,
    description: "onboarding",
    active: true,
  });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
  variantId = variant.id;
  await prisma.priceListItem.create({
    data: { priceListId, variantId, unitPrice: 4.1 },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("trade application domain", () => {
  it("exposes useful business types and requires consent", () => {
    expect(BUSINESS_TYPES).toContain("Motor Factor");
    expect(() =>
      tradeApplicationSubmitSchema.parse({
        companyName: "X",
        businessType: "Motor Factor",
        tradingAddress: { line1: "1", town: "Town", postcode: "B1 1AA", country: "GB" },
        primaryContact: {
          firstName: "A",
          lastName: "B",
          email: "a@b.com",
          phone: "01214567890",
        },
        existingAccountClaim: "no",
      }),
    ).toThrow();
  });
});

describe("trade onboarding journey", () => {
  it("submits with claimed Autopart code remaining unverified", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `ABC Motor Factors ${suffix}`,
        email: `abc.buyer.${suffix}@example.invalid`,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: "ABC001",
        companyNumber: `CN${suffix}`.slice(0, 20),
      }),
    );
    expect(submitted.reference).toMatch(/^APP-\d{8}-\d{4}$/);
    expect(submitted.duplicate).toBe(false);

    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.claimedAutopartCustomerCode).toBe("ABC001");
    expect(app.existingAccountClaim).toBe("yes");
    expect(app.consentAcceptedAt).toBeTruthy();
    expect(app.status).toBe("SUBMITTED");
  });

  it("protects against duplicate submit spam", async () => {
    const email = `dup.${suffix}@example.invalid`;
    const companyName = `Dup Co ${suffix}`;
    const first = await submitTradeApplication(
      validTradeApplicationInput({ companyName, email }),
    );
    const second = await submitTradeApplication(
      validTradeApplicationInput({ companyName, email }),
    );
    expect(second.duplicate).toBe(true);
    expect(second.reference).toBe(first.reference);
  });

  it("supports under-review and more-info transitions", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Info Co ${suffix}`,
        email: `info.${suffix}@example.invalid`,
      }),
    );
    const under = await markApplicationUnderReview(adminId, submitted.id);
    expect(under.status).toBe("UNDER_REVIEW");

    const more = await requestApplicationMoreInfo(adminId, {
      id: submitted.id,
      customerMessage: "Please send your VAT certificate.",
      reviewNotes: "Need VAT proof",
    });
    expect(more.status).toBe("MORE_INFO_REQUIRED");
    expect(more.emailDeferred).toBe(true);
    expect(more.emailSent).toBe(false);

    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.customerMessage).toContain("VAT certificate");
  });

  it("rejects without creating company or access", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `No Go ${suffix}`,
        email: `nogo.${suffix}@example.invalid`,
      }),
    );
    await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Outside supply area",
      customerMessage: "We cannot onboard at this time.",
    });
    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.status).toBe("REJECTED");
    expect(app.companyId).toBeNull();
    await expect(
      approveTradeApplication(adminId, { id: submitted.id }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("allows staff to edit open application details and delete unlinked apps", async () => {
    const {
      updateTradeApplicationDetails,
      withdrawTradeApplication,
      deleteTradeApplication,
    } = await import("@/server/applications/service");

    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Edit Me ${suffix}`,
        email: `editme.${suffix}@example.invalid`,
      }),
    );
    const edited = await updateTradeApplicationDetails(adminId, {
      id: submitted.id,
      companyName: `Edited Factors ${suffix}`,
      tradingName: "Edited T/A",
      businessType: "Garage / Workshop",
      tradingAddress: {
        line1: "99 New Street",
        line2: null,
        town: "Leeds",
        county: null,
        postcode: "LS1 2AB",
        country: "GB",
      },
      primaryContact: {
        firstName: "Pat",
        lastName: "Buyer",
        role: "Buyer",
        email: `editme.${suffix}@example.invalid`,
        phone: "01131112222",
      },
      existingAccountClaim: "no",
      brandsInterest: ["power-maxed"],
      notes: "Staff corrected address",
    });
    expect(edited.companyName).toBe(`Edited Factors ${suffix}`);
    const address = edited.tradingAddress as { line1?: string } | null;
    expect(address?.line1).toBe("99 New Street");
    expect(edited.notes).toBe("Staff corrected address");

    const withdrawn = await withdrawTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Duplicate / withdrawn",
    });
    expect(withdrawn.status).toBe("WITHDRAWN");

    const spam = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Spam ${suffix}`,
        email: `spam.${suffix}@example.invalid`,
      }),
    );
    const deleted = await deleteTradeApplication(adminId, { id: spam.id });
    expect(deleted.ok).toBe(true);
    await expect(getTradeApplication(adminId, spam.id)).rejects.toBeInstanceOf(AuthError);
  });

  it("approves with commercial setup, activates invite, and scopes company", async () => {
    const email = `activate.${suffix}@example.invalid`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Activate Co ${suffix}`,
        email,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: `A${suffix.replace(/\D/g, "").slice(-10)}`,
      }),
    );

    const approved = await approveTradeApplication(adminId, {
      id: submitted.id,
      priceListId,
      paymentTerms: "30 days",
      reviewNotes: "Looks good",
    });
    expect(approved.created).toBe(true);
    expect(approved.inviteToken).toBeTruthy();
    expect(approved.activationPath).toContain("/activate?token=");

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.priceListId).toBe(priceListId);
    expect(company.paymentTerms).toBe("30 days");
    expect(company.autopartCustomerCode).toBeNull();

    const verifiedCode = `A${suffix.replace(/\D/g, "").slice(-10)}`;
    await setCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code: verifiedCode,
    });
    await verifyCompanyAutopartCustomerCode(adminId, { companyId: company.id });
    const verified = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(verified.autopartCustomerCode).toBe(verifiedCode);
    expect(verified.autopartCustomerCodeVerifiedAt).toBeTruthy();

    const preview = await getInvitationPreview(approved.inviteToken!);
    expect(preview?.email).toBe(email);
    expect(preview?.expired).toBe(false);

    const activated = await acceptTradeInvitation({
      token: approved.inviteToken!,
      password: "SecurePass-Onboard1",
      confirmPassword: "SecurePass-Onboard1",
    });
    expect(activated.companyId).toBe(company.id);
    expect(activated.portalPath).toBe("/portal");

    const membership = await prisma.companyUser.findUniqueOrThrow({
      where: {
        companyId_userId: { companyId: company.id, userId: activated.userId },
      },
    });
    expect(membership.status).toBe("ACTIVE");
    expect(membership.role).toBe("TRADE_ADMIN");

    const invite = await prisma.userInvitation.findUniqueOrThrow({
      where: { tokenHash: hashInviteToken(approved.inviteToken!) },
    });
    expect(invite.status).toBe("ACCEPTED");

    // Idempotent approve
    const again = await approveTradeApplication(adminId, { id: submitted.id });
    expect(again.created).toBe(false);
    expect(again.companyId).toBe(company.id);

    // Pricing resolves for company context
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    const prices = await resolveVariantTradePrices({
      companyId: company.id,
      variants: [
        {
          id: variant.id,
          sku: variant.sku,
          tradePrice: variant.tradePrice,
          vatCode: variant.vatCode,
        },
      ],
    });
    expect(prices.get(variantId)?.unitPriceExVatDisplay).toBe("4.10");

    // Seed stock so Phase 6A basket rules can accept a case
    const warehouse = await prisma.warehouse.upsert({
      where: { code: "AUTOPART" },
      create: { code: "AUTOPART", name: "Autopart" },
      update: {},
    });
    await prisma.inventory.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
      create: {
        variantId,
        warehouseId: warehouse.id,
        qtyOnHand: 48,
        qtyReserved: 0,
        status: "IN_STOCK",
        externalSyncedAt: new Date(),
        sourceAvailRaw: "48",
      },
      update: {
        qtyOnHand: 48,
        qtyReserved: 0,
        status: "IN_STOCK",
        externalSyncedAt: new Date(),
        sourceAvailRaw: "48",
      },
    });
    await prisma.stockSyncRun.create({
      data: {
        source: "231PO3NEW",
        mode: "live",
        status: "SUCCESS",
        trigger: "test",
        completedAt: new Date(),
        rowsRead: 1,
        matched: 1,
        updated: 1,
        unchanged: 0,
        unmatched: 0,
        invalid: 0,
        duplicates: 0,
      },
    });

    const basket = await addToBasket(activated.userId, {
      variantId,
      quantity: 12,
    });
    expect(basket.companyId).toBe(company.id);
    expect(basket.lines.length).toBeGreaterThan(0);

    const viewed = await getBasket(activated.userId);
    expect(viewed.companyId).toBe(company.id);
  });

  it("surfaces possible duplicates for staff", async () => {
    const email = `match.${suffix}@example.invalid`;
    const first = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Match Co ${suffix}`,
        email,
        vatNumber: `GB${suffix}`.slice(0, 12),
      }),
    );
    // Force a second open app with same email by bypassing 10-minute guard via different company name
    // but same email — findPossibleDuplicates should still flag.
    const second = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Match Co Alt ${suffix}`,
        email,
        vatNumber: `GB${suffix}`.slice(0, 12),
      }),
    );
    expect(second.duplicate).toBe(false);
    const detail = await getTradeApplication(adminId, second.id);
    expect(detail.possibleDuplicates.some((d) => d.id === first.id)).toBe(true);
    expect(detail.possibleDuplicates[0]?.matchReasons.join(" ")).toMatch(/email|VAT/i);
  });

  it("lists applications with search across reference and claimed code", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Searchable ${suffix}`,
        email: `search.${suffix}@example.invalid`,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: `SRCH${suffix}`.slice(0, 12),
      }),
    );
    const rows = await listTradeApplications(adminId, { q: submitted.reference });
    expect(rows.some((r) => r.id === submitted.id)).toBe(true);
    const byClaim = await listTradeApplications(adminId, {
      q: `SRCH${suffix}`.slice(0, 12),
      existingAccount: "claimed",
    });
    expect(byClaim.some((r) => r.id === submitted.id)).toBe(true);
  });

  it("blocks approving internal staff email as trade applicant", async () => {
    const staffEmail = `staff.conflict.${suffix}@example.invalid`;
    await ensureUser(staffEmail, ["SALES_REPRESENTATIVE"]);
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Staff Conflict ${suffix}`,
        email: staffEmail,
      }),
    );
    await expect(
      approveTradeApplication(adminId, { id: submitted.id, confirmExistingUserLink: true }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
