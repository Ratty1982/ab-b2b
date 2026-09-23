/**
 * Integration: the shared request-session resolver must agree with pricing's
 * optional user id path. Previous UI-only mocks passed while production still
 * showed YOUR PRICE with an anonymous public header.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildSafeSession, sessionDiagnostics } from "@/server/auth/request-session";
import { loadPricingActor } from "@/server/pricing/resolve-trade-price";
import { canViewTrade } from "@/server/pricing/trade-price";
import { isTradeCustomerSession, canViewBasketSession } from "@/lib/session-guards";

const prisma = new PrismaClient();
const suffix = `${Date.now()}`;
const email = `trade-session-${suffix}@example.invalid`;

describe("request session ↔ pricing actor agreement", () => {
  let userId = "";
  let companyId = "";

  afterAll(async () => {
    if (userId) {
      await prisma.companyUser.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (companyId) {
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    await prisma.$disconnect();
  });

  it("buildSafeSession yields TRADE chrome + pricing-visible actor for the same userId", async () => {
    const company = await prisma.company.create({
      data: { name: `Session Co ${suffix}`, status: "ACTIVE" },
    });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        email,
        name: "Session Trade Buyer",
        emailVerified: true,
        actorType: "TRADE",
        status: "ACTIVE",
      },
    });
    userId = user.id;
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: user.id,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    const session = await buildSafeSession(userId);
    expect(session).not.toBeNull();
    expect(session!.signedIn).toBe(true);
    expect(session!.user.actorType).toBe("TRADE");
    expect(session!.user.companyId).toBe(companyId);
    expect(session!.user.navPermissions).toContain("orders.view");
    expect(session!.user.navPermissions).toContain("orders.create");
    expect(isTradeCustomerSession(session!)).toBe(true);
    expect(canViewBasketSession(session!)).toBe(true);

    const pricing = await loadPricingActor(userId);
    expect(pricing.companyId).toBe(companyId);
    expect(canViewTrade(pricing.viewer)).toBe(true);

    const diag = sessionDiagnostics(session!);
    expect(diag.signedIn).toBe(true);
    expect(diag.isTradeCustomer).toBe(true);
    // Contradiction that failed in production must be impossible for this actor:
    const wouldShowYourPrice = canViewTrade(pricing.viewer);
    const wouldShowTradeLogin = !diag.signedIn;
    expect(wouldShowYourPrice && wouldShowTradeLogin).toBe(false);
  });

  it("anonymous pricing actor cannot view trade and is not a trade customer session", async () => {
    const pricing = await loadPricingActor(null);
    expect(canViewTrade(pricing.viewer)).toBe(false);
    expect(isTradeCustomerSession({ signedIn: false })).toBe(false);
    expect(canViewBasketSession({ signedIn: false })).toBe(false);
  });
});
