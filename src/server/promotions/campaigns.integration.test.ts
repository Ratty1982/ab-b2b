import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { listCustomerPromotions } from "@/server/portal/promotions";
import { resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import {
  approveCampaign,
  cancelCampaign,
  rejectCampaign,
  saveCampaignDraft,
  setCampaignAuditWriterForTests,
  setNegotiatedEligibility,
  submitCampaign,
} from "@/server/promotions/campaigns";
import { getCampaignPerformance } from "@/server/promotions/performance";
import { AuthError } from "@/server/rbac/guards";

const prisma = new PrismaClient();
const suffix = `${Date.now()}`;

let adminId = "";
let repId = "";
let otherRepId = "";
let managerId = "";
let managementId = "";
let buyerId = "";
let repSalesId = "";
let otherSalesId = "";
let managerSalesId = "";
let companyAId = "";
let companyBId = "";
let variantAId = "";
let variantBId = "";
let skuA = "";
let skuB = "";
let productIds: string[] = [];
let promotionIds: string[] = [];
let orderIds: string[] = [];

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

async function salesRep(userId: string, code: string, managerSalesRepId?: string) {
  const rep = await prisma.salesRep.create({
    data: { userId, code, active: true, ...(managerSalesRepId ? { managerId: managerSalesRepId } : {}) },
  });
  return rep.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await internal(`promo.admin.${suffix}@example.invalid`, "SUPER_ADMIN");
  managementId = await internal(`promo.mgmt.${suffix}@example.invalid`, "MANAGEMENT");
  managerId = await internal(`promo.manager.${suffix}@example.invalid`, "SALES_MANAGER");
  repId = await internal(`promo.rep.${suffix}@example.invalid`, "SALES_REPRESENTATIVE");
  otherRepId = await internal(`promo.other.${suffix}@example.invalid`, "SALES_REPRESENTATIVE");
  managerSalesId = await salesRep(managerId, `PMG${suffix}`);
  repSalesId = await salesRep(repId, `PREP${suffix}`, managerSalesId);
  otherSalesId = await salesRep(otherRepId, `POTR${suffix}`);

  const companyA = await prisma.company.create({
    data: { name: `Promo A ${suffix}`, status: "ACTIVE" },
  });
  const companyB = await prisma.company.create({
    data: { name: `Promo B ${suffix}`, status: "ACTIVE" },
  });
  companyAId = companyA.id;
  companyBId = companyB.id;
  await prisma.companyAssignment.create({ data: { companyId: companyAId, salesRepId: repSalesId, isPrimary: true } });
  await prisma.companyAssignment.create({ data: { companyId: companyBId, salesRepId: otherSalesId, isPrimary: true } });

  const buyer = await prisma.user.create({
    data: {
      email: `promo.buyer.${suffix}@example.invalid`,
      name: `Promo Buyer ${suffix}`,
      status: "ACTIVE",
      actorType: "TRADE",
      emailVerified: true,
    },
  });
  buyerId = buyer.id;
  await prisma.companyUser.create({
    data: { companyId: companyAId, userId: buyerId, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
  });

  skuA = `PCAMP-A-${suffix}`;
  skuB = `PCAMP-B-${suffix}`;
  const productA = await saveProduct(adminId, {
    sku: skuA,
    name: `Campaign product A ${suffix}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 20,
    rrp: 40,
    packQty: 1,
    caseQty: 1,
    description: "campaign fixture",
    active: true,
  });
  const productB = await saveProduct(adminId, {
    sku: skuB,
    name: `Campaign product B ${suffix}`,
    brand: "Power Maxed",
    category: "Braking",
    trade: 20,
    rrp: 40,
    packQty: 1,
    caseQty: 1,
    description: "campaign fixture",
    active: true,
  });
  productIds = [productA.id, productB.id];
  variantAId = (await prisma.productVariant.findFirstOrThrow({ where: { productId: productA.id } })).id;
  variantBId = (await prisma.productVariant.findFirstOrThrow({ where: { productId: productB.id } })).id;
  await prisma.customerPrice.create({
    data: { companyId: companyAId, variantId: variantAId, unitPrice: "16.5000" },
  });
});

afterAll(async () => {
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (promotionIds.length) await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (companyAId) await prisma.company.delete({ where: { id: companyAId } }).catch(() => undefined);
  if (companyBId) await prisma.company.delete({ where: { id: companyBId } }).catch(() => undefined);
  const userIds = [adminId, repId, otherRepId, managerId, managementId, buyerId].filter(Boolean);
  if (userIds.length) {
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.companyUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.salesRep.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

async function price(companyId: string | null, variantId: string) {
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { id: true, sku: true, tradePrice: true, vatCode: true },
  });
  const resolved = await resolveVariantTradePrices({
    companyId,
    variants: [variant],
    quantity: 1,
  });
  return resolved.get(variantId)!;
}

describe("sales promotion campaigns", () => {
  it("lets a representative draft and submit, and only management approve or reject", async () => {
    const legacy = await prisma.promotion.create({
      data: {
        code: `LEGACY-${suffix}`,
        name: `Legacy ${suffix}`,
        type: "PERCENT",
        value: "10.0000",
        isActive: true,
        metadata: { skus: [skuA], description: "leave me" },
      },
    });
    promotionIds.push(legacy.id);
    const before = await prisma.promotion.findUniqueOrThrow({ where: { id: legacy.id } });

    const negotiated = await price(companyAId, variantAId);
    expect(negotiated.source).toBe("PROMOTION");
    expect(negotiated.promotionApplied?.id).toBe(legacy.id);
    expect(negotiated.unitPriceExVat).toBe("14.8500");

    await expect(approveCampaign(repId, { id: legacy.id })).rejects.toBeInstanceOf(AuthError);
    await expect(saveCampaignDraft(managementId, { id: legacy.id, code: legacy.code, name: "Changed", type: "PERCENT", value: 5, skus: [skuA] })).rejects.toMatchObject({
      code: "CAMPAIGN_LEGACY",
    });
    const after = await prisma.promotion.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.isActive).toBe(before.isActive);
    expect(after.value.toString()).toBe(before.value.toString());
    expect(after.type).toBe(before.type);
    expect(after.campaignStatus).toBe("LEGACY");
    expect(after.appliesToNegotiatedPrices).toBe(true);
    expect(after.metadata).toEqual(before.metadata);
    await prisma.promotion.update({ where: { id: legacy.id }, data: { isActive: false } });

    const draft = await saveCampaignDraft(repId, {
      code: `CAMP-${suffix}`,
      name: `Spring ${suffix}`,
      description: "Telephone offer",
      imageUrl: "https://cdn.example.com/spring.png",
      type: "PERCENT",
      value: 10,
      skus: [skuA],
      appliesToNegotiatedPrices: true,
    });
    promotionIds.push(draft.id);
    expect(draft.campaignStatus).toBe("DRAFT");
    expect(draft.appliesToNegotiatedPrices).toBe(false);
    expect(draft.isActive).toBe(false);
    const edited = await saveCampaignDraft(repId, {
      id: draft.id,
      code: `CAMP-${suffix}`,
      name: `Spring revised ${suffix}`,
      type: "PERCENT",
      value: 10,
      skus: [skuA],
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(edited.name).toContain("revised");
    await expect(
      saveCampaignDraft(otherRepId, {
        id: draft.id,
        code: `CAMP-${suffix}`,
        name: "Stolen",
        type: "PERCENT",
        value: 10,
        skus: [skuA],
      }),
    ).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });

    const held = await price(companyAId, variantAId);
    expect(held.promotionApplied).toBeNull();
    expect(held.unitPriceExVat).toBe("16.5000");

    await submitCampaign(repId, { id: draft.id });
    await expect(approveCampaign(repId, { id: draft.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(approveCampaign(managerId, { id: draft.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rejected = await rejectCampaign(managementId, { id: draft.id, reason: "Dates missing" });
    expect(rejected.campaignStatus).toBe("REJECTED");
    expect(rejected.reviewReason).toBe("Dates missing");
    expect(rejected.isActive).toBe(false);

    await saveCampaignDraft(repId, {
      id: draft.id,
      code: `CAMP-${suffix}`,
      name: `Spring revised ${suffix}`,
      type: "PERCENT",
      value: 10,
      startsAt: new Date("2026-10-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-01T00:00:00.000Z").toISOString(),
      skus: [skuA],
      expectedUpdatedAt: rejected.updatedAt,
    });
    await submitCampaign(repId, { id: draft.id });
    const approved = await approveCampaign(managementId, { id: draft.id, appliesToNegotiatedPrices: false });
    expect(approved.campaignStatus).toBe("APPROVED");
    expect(approved.displayStatus).toBe("ACTIVE");
    expect(approved.isActive).toBe(true);
    expect(approved.appliesToNegotiatedPrices).toBe(false);

    const protectedPrice = await price(companyAId, variantAId);
    expect(protectedPrice.source).toBe("CUSTOMER");
    expect(protectedPrice.unitPriceExVat).toBe("16.5000");
    const openPrice = await price(companyBId, variantAId);
    expect(openPrice.source).toBe("PROMOTION");
    expect(openPrice.promotionApplied?.id).toBe(draft.id);
    expect(openPrice.promotionBaselineUnitExVat).toBe("20.0000");
    expect(openPrice.unitPriceExVat).toBe("18.0000");
    const otherSku = await price(companyBId, variantBId);
    expect(otherSku.promotionApplied).toBeNull();

    const offers = await listCustomerPromotions(buyerId);
    const offer = offers.find((row) => row.id === draft.id);
    expect(offer?.code).toBe(`CAMP-${suffix}`);
    expect(offer?.products.find((product) => product.sku === skuA)).toBeUndefined();

    const future = await saveCampaignDraft(repId, {
      code: `FUTURE-${suffix}`,
      name: `Future ${suffix}`,
      type: "FIXED",
      value: 1,
      startsAt: new Date("2026-12-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      skus: [skuB],
    });
    promotionIds.push(future.id);
    await submitCampaign(repId, { id: future.id });
    const scheduled = await approveCampaign(managementId, { id: future.id });
    expect(scheduled.displayStatus).toBe("SCHEDULED");
    expect(scheduled.displayLabel).toBe("Scheduled");
    expect((await listCustomerPromotions(buyerId)).some((row) => row.id === future.id)).toBe(false);
    await prisma.promotion.update({
      where: { id: future.id },
      data: { endsAt: new Date("2026-10-01T00:00:00.000Z") },
    });
    const expiredRow = await prisma.promotion.findUniqueOrThrow({ where: { id: future.id } });
    expect(expiredRow.isActive).toBe(true);
    expect(expiredRow.campaignStatus).toBe("APPROVED");
    const { campaignDisplayStatus } = await import("@/domain/promotion-campaigns");
    expect(
      campaignDisplayStatus({
        campaignStatus: expiredRow.campaignStatus,
        isActive: expiredRow.isActive,
        startsAt: expiredRow.startsAt,
        endsAt: expiredRow.endsAt,
        at: new Date(),
      }).status,
    ).toBe("EXPIRED");
    expect((await price(companyBId, variantBId)).promotionApplied).toBeNull();
  });

  it("reports each order and customer once, and hides accounts outside a representative's scope", async () => {
    const campaign = await prisma.promotion.findFirstOrThrow({ where: { code: `CAMP-${suffix}` } });
    const standing = await prisma.order.create({
      data: {
        orderNumber: `PC-${suffix}-A`,
        companyId: companyAId,
        status: "SUBMITTED",
        subtotal: "30.00",
        vatTotal: "6.00",
        grandTotal: "36.00",
        salesRepNameSnapshot: "Alex Rep",
        placedAt: new Date("2026-10-10T12:00:00.000Z"),
        items: {
          create: [
            {
              variantId: variantAId,
              sku: skuA,
              name: "A",
              qty: 2,
              unitPrice: "18.0000",
              customerUnitPrice: "18.00",
              vatRate: "20.00",
              lineTotal: "36.00",
              promotionId: campaign.id,
              promotionBaselineUnitPrice: "20.0000",
            },
            {
              variantId: variantAId,
              sku: skuA,
              name: "A extra",
              qty: 1,
              unitPrice: "18.0000",
              customerUnitPrice: "18.00",
              vatRate: "20.00",
              lineTotal: "18.00",
              promotionId: campaign.id,
            },
          ],
        },
      },
    });
    const cancelled = await prisma.order.create({
      data: {
        orderNumber: `PC-${suffix}-C`,
        companyId: companyAId,
        status: "CANCELLED",
        subtotal: "18.00",
        vatTotal: "3.60",
        grandTotal: "21.60",
        placedAt: new Date("2026-10-11T12:00:00.000Z"),
        items: {
          create: {
            variantId: variantAId,
            sku: skuA,
            name: "A",
            qty: 4,
            unitPrice: "18.0000",
            customerUnitPrice: "18.00",
            vatRate: "20.00",
            lineTotal: "72.00",
            promotionId: campaign.id,
            promotionBaselineUnitPrice: "20.0000",
          },
        },
      },
    });
    const outside = await prisma.order.create({
      data: {
        orderNumber: `PC-${suffix}-B`,
        companyId: companyBId,
        status: "DELIVERED",
        subtotal: "18.00",
        vatTotal: "3.60",
        grandTotal: "21.60",
        salesRepNameSnapshot: "Other Rep",
        placedAt: new Date("2026-10-12T12:00:00.000Z"),
        items: {
          create: {
            variantId: variantAId,
            sku: skuA,
            name: "A",
            qty: 1,
            unitPrice: "18.0000",
            customerUnitPrice: "18.00",
            vatRate: "20.00",
            lineTotal: "18.00",
            promotionId: campaign.id,
            promotionBaselineUnitPrice: "20.0000",
          },
        },
      },
    });
    orderIds.push(standing.id, cancelled.id, outside.id);

    const organisation = await getCampaignPerformance(managementId, { promotionId: campaign.id });
    expect(organisation.scope).toBe("organisation");
    expect(organisation.placed.orders).toBe(3);
    expect(organisation.placed.customers).toBe(2);
    expect(organisation.standing.orders).toBe(2);
    expect(organisation.standing.units).toBe(4);
    expect(organisation.cancelled.orders).toBe(1);
    expect(organisation.completed.orders).toBe(1);
    expect(organisation.savings.coverage).toBe("partial");
    expect(organisation.savings.linesWithoutBaseline).toBe(1);
    expect(organisation.credits.attributable).toBe(false);
    const standingOrder = organisation.orders.items.find((row) => row.id === standing.id);
    expect(standingOrder?.lines).toBe(2);
    expect(organisation.customers.items.find((row) => row.companyId === companyAId)?.orders).toBe(1);

    const scoped = await getCampaignPerformance(repId, { promotionId: campaign.id });
    expect(scoped.scope).toBe("assigned_accounts");
    expect(scoped.placed.orders).toBe(2);
    expect(scoped.orders.items.some((row) => row.companyId === companyBId)).toBe(false);
    expect(scoped.customers.items.some((row) => row.companyName.includes("Promo B"))).toBe(false);
    expect(scoped.representatives.some((row) => row.name === "Alex Rep")).toBe(true);
    expect(organisation.revenueNote).toContain("before credit-note adjustments");

    const team = await getCampaignPerformance(managerId, { promotionId: campaign.id });
    expect(team.scope).toBe("assigned_accounts");
    expect(team.orders.items.some((row) => row.companyId === companyAId)).toBe(true);
    expect(team.orders.items.some((row) => row.companyId === companyBId)).toBe(false);

    const historical = await prisma.promotion.create({
      data: {
        code: `HIST-${suffix}`,
        name: `Hist ${suffix}`,
        type: "PERCENT",
        value: "5.0000",
        isActive: false,
        metadata: { skus: [`HIST-ONLY-${suffix}`] },
      },
    });
    promotionIds.push(historical.id);
    const oldOrder = await prisma.order.create({
      data: {
        orderNumber: `PC-${suffix}-H`,
        companyId: companyAId,
        status: "DISPATCHED",
        subtotal: "10.00",
        vatTotal: "2.00",
        grandTotal: "12.00",
        placedAt: new Date("2026-09-01T12:00:00.000Z"),
        items: {
          create: {
            sku: skuA,
            name: "Historical",
            qty: 1,
            unitPrice: "10.0000",
            customerUnitPrice: "10.00",
            vatRate: "20.00",
            lineTotal: "10.00",
            promotionId: historical.id,
          },
        },
      },
    });
    orderIds.push(oldOrder.id);
    const history = await getCampaignPerformance(managementId, { promotionId: historical.id });
    expect(history.savings.coverage).toBe("unavailable");
    expect(history.savings.savingsExVat).toBeNull();
    expect(history.placed.orders).toBe(1);
  });

  it("cancels an approved campaign without creating a second pricing rule", async () => {
    const campaign = await prisma.promotion.findFirstOrThrow({ where: { code: `CAMP-${suffix}` } });
    const cancelled = await cancelCampaign(managementId, { id: campaign.id, reason: "Ended early" });
    expect(cancelled.campaignStatus).toBe("CANCELLED");
    expect(cancelled.isActive).toBe(false);
    expect((await price(companyBId, variantAId)).promotionApplied).toBeNull();
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: campaign.id, action: { in: ["promotions.campaign.created", "promotions.campaign.approved", "promotions.campaign.cancelled"] } },
    });
    expect(audits.map((row) => row.action).sort()).toEqual([
      "promotions.campaign.approved",
      "promotions.campaign.cancelled",
      "promotions.campaign.created",
    ]);
  });

  it("rejects a second review and requires confirmation before discounting negotiated prices", async () => {
    const draft = await saveCampaignDraft(repId, {
      code: `RACE-${suffix}`,
      name: `Race ${suffix}`,
      type: "PERCENT",
      value: 5,
      startsAt: new Date("2026-10-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      skus: [skuB],
      appliesToNegotiatedPrices: true,
    });
    promotionIds.push(draft.id);
    expect(draft.appliesToNegotiatedPrices).toBe(false);
    const managerDraft = await saveCampaignDraft(managerId, {
      code: `MGR-${suffix}`,
      name: `Manager ${suffix}`,
      type: "PERCENT",
      value: 5,
      skus: [skuB],
      appliesToNegotiatedPrices: true,
    });
    promotionIds.push(managerDraft.id);
    expect(managerDraft.appliesToNegotiatedPrices).toBe(false);
    const stored = draft.startsAt;
    const resaved = await saveCampaignDraft(repId, {
      id: draft.id,
      code: `RACE-${suffix}`,
      name: `Race ${suffix}`,
      type: "PERCENT",
      value: 5,
      startsAt: stored,
      endsAt: draft.endsAt,
      skus: [skuB],
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(resaved.startsAt).toBe(stored);
    await expect(
      saveCampaignDraft(managerId, {
        id: draft.id,
        code: `RACE-${suffix}`,
        name: `Race ${suffix}`,
        type: "PERCENT",
        value: 5,
        skus: [skuB],
        appliesToNegotiatedPrices: true,
      }),
    ).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });

    await submitCampaign(repId, { id: draft.id });
    await expect(
      approveCampaign(managementId, { id: draft.id, appliesToNegotiatedPrices: true }),
    ).rejects.toMatchObject({ code: "NEGOTIATED_CONFIRMATION_REQUIRED" });
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: draft.id } })).campaignStatus).toBe(
      "PENDING_APPROVAL",
    );

    const [approved, rejected] = await Promise.allSettled([
      approveCampaign(managementId, { id: draft.id, appliesToNegotiatedPrices: false }),
      rejectCampaign(adminId, { id: draft.id, reason: "Too soon" }),
    ]);
    const outcomes = [approved, rejected];
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((row) => row.status === "rejected")).toHaveLength(1);
    const failure = outcomes.find((row) => row.status === "rejected");
    expect(failure?.status === "rejected" ? failure.reason : null).toMatchObject({ code: "CAMPAIGN_CONFLICT" });

    const reviewAudits = await prisma.auditEvent.findMany({
      where: {
        entityId: draft.id,
        action: { in: ["promotions.campaign.approved", "promotions.campaign.rejected"] },
      },
    });
    expect(reviewAudits).toHaveLength(1);

    const current = await prisma.promotion.findUniqueOrThrow({ where: { id: draft.id } });
    if (current.campaignStatus === "REJECTED") {
      await submitCampaign(repId, { id: draft.id });
    } else {
      await expect(approveCampaign(adminId, { id: draft.id })).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });
      await cancelCampaign(managementId, { id: draft.id, reason: "Reset for confirmation" });
      const again = await saveCampaignDraft(repId, {
        code: `RACE2-${suffix}`,
        name: `Race two ${suffix}`,
        type: "PERCENT",
        value: 5,
        startsAt: new Date("2026-10-01T00:00:00.000Z").toISOString(),
        endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
        skus: [skuB],
      });
      promotionIds.push(again.id);
      await submitCampaign(repId, { id: again.id });
      const confirmed = await approveCampaign(managementId, {
        id: again.id,
        appliesToNegotiatedPrices: true,
        confirmNegotiatedPrices: true,
      });
      expect(confirmed.appliesToNegotiatedPrices).toBe(true);
      await expect(setNegotiatedEligibility(repId, { id: again.id, appliesToNegotiatedPrices: false })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        setNegotiatedEligibility(managerId, { id: again.id, appliesToNegotiatedPrices: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const tightened = await setNegotiatedEligibility(managementId, {
        id: again.id,
        appliesToNegotiatedPrices: false,
      });
      expect(tightened.appliesToNegotiatedPrices).toBe(false);
      await expect(
        setNegotiatedEligibility(managementId, { id: again.id, appliesToNegotiatedPrices: true }),
      ).rejects.toMatchObject({ code: "NEGOTIATED_CONFIRMATION_REQUIRED" });
      const opened = await setNegotiatedEligibility(adminId, {
        id: again.id,
        appliesToNegotiatedPrices: true,
        confirmNegotiatedPrices: true,
      });
      expect(opened.appliesToNegotiatedPrices).toBe(true);
      const stacking = await prisma.auditEvent.count({
        where: { entityId: again.id, action: "promotions.campaign.stacking_updated" },
      });
      expect(stacking).toBe(2);
      await cancelCampaign(managementId, { id: again.id, reason: "Cleanup" });
      return;
    }

    const confirmed = await approveCampaign(managementId, {
      id: draft.id,
      appliesToNegotiatedPrices: true,
      confirmNegotiatedPrices: true,
    });
    expect(confirmed.appliesToNegotiatedPrices).toBe(true);
    await expect(approveCampaign(adminId, { id: draft.id, appliesToNegotiatedPrices: true, confirmNegotiatedPrices: true })).rejects.toMatchObject({
      code: "CAMPAIGN_LOCKED",
    });
    await expect(setNegotiatedEligibility(repId, { id: draft.id, appliesToNegotiatedPrices: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const tightened = await setNegotiatedEligibility(managementId, { id: draft.id, appliesToNegotiatedPrices: false });
    expect(tightened.appliesToNegotiatedPrices).toBe(false);
    await expect(
      setNegotiatedEligibility(managementId, { id: draft.id, appliesToNegotiatedPrices: true }),
    ).rejects.toMatchObject({ code: "NEGOTIATED_CONFIRMATION_REQUIRED" });
    const opened = await setNegotiatedEligibility(adminId, {
      id: draft.id,
      appliesToNegotiatedPrices: true,
      confirmNegotiatedPrices: true,
    });
    expect(opened.appliesToNegotiatedPrices).toBe(true);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: draft.id, action: "promotions.campaign.stacking_updated" },
      }),
    ).toBe(2);
    await cancelCampaign(managementId, { id: draft.id, reason: "Cleanup" });
  });

  async function pendingCampaign(code: string, sku: string) {
    const draft = await saveCampaignDraft(repId, {
      code,
      name: code,
      type: "PERCENT",
      value: 10,
      startsAt: new Date("2026-10-01T00:00:00.000Z").toISOString(),
      endsAt: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      skus: [sku],
    });
    promotionIds.push(draft.id);
    return submitCampaign(repId, { id: draft.id });
  }

  it("rejects a stale save and will not approve a pending campaign from an outdated review", async () => {
    const pending = await pendingCampaign(`STALE-${suffix}`, skuA);
    const approved = await approveCampaign(managementId, {
      id: pending.id,
      appliesToNegotiatedPrices: false,
      expectedUpdatedAt: pending.updatedAt,
    });
    expect(approved.isActive).toBe(true);
    await expect(
      saveCampaignDraft(repId, {
        id: pending.id,
        code: `STALE-${suffix}`,
        name: "Older editor",
        type: "PERCENT",
        value: 10,
        skus: [skuA],
        startsAt: pending.startsAt,
        endsAt: pending.endsAt,
        expectedUpdatedAt: pending.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: "CAMPAIGN_CONFLICT",
      message: expect.stringMatching(/Refresh/),
    });
    const stayed = await prisma.promotion.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stayed.campaignStatus).toBe("APPROVED");
    expect(stayed.isActive).toBe(true);
    expect(stayed.name).toBe(pending.name);

    const pendingEdit = await pendingCampaign(`STALE2-${suffix}`, skuB);
    const edited = await saveCampaignDraft(managementId, {
      id: pendingEdit.id,
      code: `STALE2-${suffix}`,
      name: "Changed while pending",
      type: "PERCENT",
      value: 12,
      startsAt: pendingEdit.startsAt,
      endsAt: pendingEdit.endsAt,
      skus: [skuB],
      expectedUpdatedAt: pendingEdit.updatedAt,
    });
    expect(edited.campaignStatus).toBe("DRAFT");
    expect(edited.isActive).toBe(false);
    await expect(
      approveCampaign(managementId, {
        id: pendingEdit.id,
        appliesToNegotiatedPrices: false,
        expectedUpdatedAt: pendingEdit.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: "CAMPAIGN_CONFLICT",
      message: expect.stringMatching(/Refresh/),
    });
    const held = await prisma.promotion.findUniqueOrThrow({ where: { id: pendingEdit.id } });
    expect(held.campaignStatus).toBe("DRAFT");
    expect(held.isActive).toBe(false);
    await cancelCampaign(managementId, { id: pending.id, reason: "Cleanup stale" }).catch(async () => {
      await prisma.promotion.update({ where: { id: pending.id }, data: { isActive: false } });
    });
  });

  it("lets only one of a simultaneous save and approval change the campaign", async () => {
    const pending = await pendingCampaign(`SIMUL-${suffix}`, skuB);
    const [saved, approved] = await Promise.allSettled([
      saveCampaignDraft(repId, {
        id: pending.id,
        code: `SIMUL-${suffix}`,
        name: "Race save",
        type: "PERCENT",
        value: 10,
        startsAt: pending.startsAt,
        endsAt: pending.endsAt,
        skus: [skuB],
        expectedUpdatedAt: pending.updatedAt,
      }),
      approveCampaign(managementId, {
        id: pending.id,
        appliesToNegotiatedPrices: false,
        expectedUpdatedAt: pending.updatedAt,
      }),
    ]);
    expect([saved, approved].filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect([saved, approved].filter((row) => row.status === "rejected")).toHaveLength(1);
    const row = await prisma.promotion.findUniqueOrThrow({ where: { id: pending.id } });
    const approvedAudits = await prisma.auditEvent.count({
      where: { entityId: pending.id, action: "promotions.campaign.approved" },
    });
    if (saved.status === "fulfilled") {
      expect(row.campaignStatus).toBe("DRAFT");
      expect(row.isActive).toBe(false);
      expect(approvedAudits).toBe(0);
    } else {
      expect(row.campaignStatus).toBe("APPROVED");
      expect(row.isActive).toBe(true);
      expect(row.name).toBe(pending.name);
      expect(approvedAudits).toBe(1);
      await cancelCampaign(managementId, { id: pending.id, reason: "Cleanup race" });
    }
  });

  it("rolls sensitive campaign changes back when the audit record cannot be written", async () => {
    const pending = await pendingCampaign(`AUDIT-${suffix}`, skuA);
    setCampaignAuditWriterForTests(async () => {
      throw new Error("audit persistence failed");
    });
    try {
      await expect(
        approveCampaign(managementId, { id: pending.id, appliesToNegotiatedPrices: false }),
      ).rejects.toThrow(/audit persistence failed/);
      expect((await prisma.promotion.findUniqueOrThrow({ where: { id: pending.id } })).campaignStatus).toBe(
        "PENDING_APPROVAL",
      );
      expect(
        await prisma.auditEvent.count({ where: { entityId: pending.id, action: "promotions.campaign.approved" } }),
      ).toBe(0);
      expect((await price(companyAId, variantAId)).unitPriceExVat).toBe("16.5000");

      setCampaignAuditWriterForTests(null);
      const approved = await approveCampaign(managementId, { id: pending.id, appliesToNegotiatedPrices: false });
      expect(approved.isActive).toBe(true);
      expect((await price(companyAId, variantAId)).unitPriceExVat).toBe("16.5000");
      const untouched = await price(companyBId, variantAId);
      expect(untouched.source).toBe("PROMOTION");
      expect(untouched.unitPriceExVat).toBe("18.0000");

      setCampaignAuditWriterForTests(async () => {
        throw new Error("audit persistence failed");
      });
      await expect(
        setNegotiatedEligibility(managementId, {
          id: pending.id,
          appliesToNegotiatedPrices: true,
          confirmNegotiatedPrices: true,
        }),
      ).rejects.toThrow(/audit persistence failed/);
      expect((await prisma.promotion.findUniqueOrThrow({ where: { id: pending.id } })).appliesToNegotiatedPrices).toBe(
        false,
      );
      expect((await price(companyAId, variantAId)).unitPriceExVat).toBe("16.5000");

      setCampaignAuditWriterForTests(null);
      const opened = await setNegotiatedEligibility(managementId, {
        id: pending.id,
        appliesToNegotiatedPrices: true,
        confirmNegotiatedPrices: true,
        expectedUpdatedAt: approved.updatedAt,
      });
      expect(opened.appliesToNegotiatedPrices).toBe(true);
      expect((await price(companyAId, variantAId)).unitPriceExVat).toBe("14.8500");
      const stacking = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: pending.id, action: "promotions.campaign.stacking_updated" },
      });
      expect(stacking.before).toEqual({ appliesToNegotiatedPrices: false });
      expect(stacking.after).toEqual({ appliesToNegotiatedPrices: true, code: `AUDIT-${suffix}` });

      const [firstDecision, secondDecision] = await Promise.allSettled([
        setNegotiatedEligibility(managementId, {
          id: pending.id,
          appliesToNegotiatedPrices: false,
          expectedUpdatedAt: opened.updatedAt,
        }),
        setNegotiatedEligibility(adminId, {
          id: pending.id,
          appliesToNegotiatedPrices: false,
          expectedUpdatedAt: opened.updatedAt,
        }),
      ]);
      expect([firstDecision, secondDecision].filter((row) => row.status === "fulfilled")).toHaveLength(1);
      expect(
        await prisma.auditEvent.count({
          where: { entityId: pending.id, action: "promotions.campaign.stacking_updated" },
        }),
      ).toBe(2);

      setCampaignAuditWriterForTests(async () => {
        throw new Error("audit persistence failed");
      });
      await expect(cancelCampaign(managementId, { id: pending.id, reason: "Stop" })).rejects.toThrow(
        /audit persistence failed/,
      );
      expect((await prisma.promotion.findUniqueOrThrow({ where: { id: pending.id } })).campaignStatus).toBe("APPROVED");

      const pendingReject = await pendingCampaign(`AUDITR-${suffix}`, skuB);
      await expect(rejectCampaign(managementId, { id: pendingReject.id, reason: "No" })).rejects.toThrow(
        /audit persistence failed/,
      );
      expect((await prisma.promotion.findUniqueOrThrow({ where: { id: pendingReject.id } })).campaignStatus).toBe(
        "PENDING_APPROVAL",
      );
      expect(
        await prisma.auditEvent.count({ where: { entityId: pendingReject.id, action: "promotions.campaign.rejected" } }),
      ).toBe(0);
    } finally {
      setCampaignAuditWriterForTests(null);
    }
    await cancelCampaign(managementId, { id: pending.id, reason: "Cleanup audit" });
  });
});
