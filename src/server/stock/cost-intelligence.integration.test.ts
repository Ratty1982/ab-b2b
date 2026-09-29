import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { applyStockFeed, ensureAutopartWarehouse } from "@/server/stock/service";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import {
  exportCostIntelligenceCsv,
  getCostIntelligenceWorkspace,
} from "@/server/stock/cost-intelligence";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let adminId = "";
let salesRepId = "";
let buyerId = "";
let variantId = "";
const skuUp = `CIU${suffix.slice(-6).toUpperCase()}`;
const skuDown = `CID${suffix.slice(-6).toUpperCase()}`;
const skuFirst = `CIF${suffix.slice(-6).toUpperCase()}`;
const skuNoCost = `CIN${suffix.slice(-6).toUpperCase()}`;
const skuRepeat = `CIR${suffix.slice(-6).toUpperCase()}`;

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

async function makeProduct(sku: string, name: string, trade: number, rrp: number) {
  await saveProduct(adminId, {
    sku,
    name,
    brand: "Power Maxed",
    category: "Cleaning",
    trade,
    rrp,
    packQty: 1,
    caseQty: 12,
    description: "cost intelligence test",
    active: true,
  });
  return (await prisma.productVariant.findUniqueOrThrow({ where: { sku } })).id;
}

function feedRows(
  rows: Array<{ sku: string; cost: string; avail?: string }>,
) {
  return buildNative231Po3New(
    rows.map((r) => ({
      sku: r.sku,
      description: r.sku,
      stk: "20.0000",
      avail: r.avail ?? "12.0000",
      pick: "0.0000",
      physical: "20.0000",
      cost: r.cost,
    })),
  );
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`ci.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepId = await ensureUser(`ci.rep.${suffix}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  buyerId = await ensureUser(`ci.buyer.${suffix}@example.invalid`, [], "TRADE");
  await ensureAutopartWarehouse();

  variantId = await makeProduct(skuUp, `Snow Foam CI ${suffix}`, 11.5, 17.99);
  await makeProduct(skuDown, `Degreaser CI ${suffix}`, 8, 14.99);
  await makeProduct(skuFirst, `First Seen CI ${suffix}`, 5, 9.99);
  await makeProduct(skuNoCost, `No Cost CI ${suffix}`, 4, 7.99);
  await makeProduct(skuRepeat, `Repeated CI ${suffix}`, 6, 12.99);

  const day1 = new Date("2026-09-20T12:00:00.000Z");
  const day2 = new Date("2026-09-25T12:00:00.000Z");
  const day3 = new Date("2026-09-29T12:00:00.000Z");

  await applyStockFeed({
    text: feedRows([
      { sku: skuUp, cost: "6.20" },
      { sku: skuDown, cost: "4.10" },
      { sku: skuRepeat, cost: "3.00" },
    ]),
    dryRun: false,
    trigger: "manual",
    actorUserId: adminId,
    sourceLabel: "ci-seed-1",
    observedAt: day1,
  });
  await applyStockFeed({
    text: feedRows([
      { sku: skuUp, cost: "6.20" },
      { sku: skuDown, cost: "4.10" },
      { sku: skuRepeat, cost: "3.20" },
    ]),
    dryRun: false,
    trigger: "manual",
    actorUserId: adminId,
    sourceLabel: "ci-seed-2",
    observedAt: day2,
  });
  await applyStockFeed({
    text: feedRows([
      { sku: skuUp, cost: "6.85" },
      { sku: skuDown, cost: "3.89" },
      { sku: skuFirst, cost: "3.01" },
      { sku: skuRepeat, cost: "3.10" },
    ]),
    dryRun: false,
    trigger: "manual",
    actorUserId: adminId,
    sourceLabel: "ci-seed-3",
    observedAt: day3,
  });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Cost Intelligence workspace", () => {
  it("allows Super Admin with products.cost.view and returns movement rows", async () => {
    const ws = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "ALL",
      movement: "ALL",
      q: skuUp,
    });
    const row = ws.items.find((r) => r.sku === skuUp);
    expect(row).toBeTruthy();
    expect(row!.previousCost).toBe("6.2000");
    expect(row!.latestCost).toBe("6.8500");
    expect(row!.change?.absolute).toBe("0.6500");
    expect(row!.change?.percent).toBe("+10.48");
    expect(row!.movement).toBe("INCREASED");
    expect(row!.tradePrice).toBe("11.5000");
    expect(row!.rrp).toBe("17.99");
    expect(row!.productVariantId).toBe(variantId);
  });

  it("surfaces price review for >=5% with trade price; excludes small moves", async () => {
    const review = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "PRICE_REVIEW",
      magnitude: "PCT_5",
    });
    const up = review.items.find((r) => r.sku === skuUp);
    expect(up?.priceReview).toBe(true);
    expect(up?.tradePrice).toBe("11.5000");

    // Small increase product: create on the fly at 1.61%
    const smallSku = `CIS${suffix.slice(-5).toUpperCase()}`;
    await makeProduct(smallSku, `Small Move ${suffix}`, 10, 15);
    const t0 = new Date("2026-09-20T12:00:00.000Z");
    const t1 = new Date("2026-09-29T12:00:00.000Z");
    await applyStockFeed({
      text: feedRows([{ sku: smallSku, cost: "6.20" }]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      sourceLabel: "ci-small-1",
      observedAt: t0,
    });
    await applyStockFeed({
      text: feedRows([{ sku: smallSku, cost: "6.30" }]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      sourceLabel: "ci-small-2",
      observedAt: t1,
    });
    const review2 = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "PRICE_REVIEW",
      magnitude: "PCT_5",
      q: smallSku,
    });
    expect(review2.items.find((r) => r.sku === smallSku)).toBeUndefined();
  });

  it("first seen has no change percentages and appears under FIRST_SEEN", async () => {
    const ws = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      movement: "FIRST_SEEN",
      q: skuFirst,
    });
    const row = ws.items.find((r) => r.sku === skuFirst);
    expect(row?.movement).toBe("FIRST_SEEN");
    expect(row?.previousCost).toBeNull();
    expect(row?.change).toBeNull();
    expect(row?.latestCost).toBe("3.0100");
  });

  it("lists catalogue SKUs with no cost under NO_COST without £0.00", async () => {
    const ws = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      movement: "NO_COST",
      q: skuNoCost,
    });
    const row = ws.items.find((r) => r.sku === skuNoCost);
    expect(row?.movement).toBe("NO_COST");
    expect(row?.latestCost).toBeNull();
    expect(row?.previousCost).toBeNull();
  });

  it("repeated movers require more than one distinct transition", async () => {
    const ws = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "REPEATED",
      q: skuRepeat,
    });
    const row = ws.items.find((r) => r.sku === skuRepeat);
    expect(row).toBeTruthy();
    expect(row!.movementCountInPeriod).toBeGreaterThanOrEqual(2);

    const upOnly = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "REPEATED",
      q: skuUp,
    });
    // skuUp has one distinct transition (6.20→6.85); identical 6.20 polls do not add moves
    expect(upOnly.items.find((r) => r.sku === skuUp)).toBeUndefined();
  });

  it("biggest decreases exclude first seen and sort by magnitude", async () => {
    const ws = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "DECREASES",
      sort: "PCT_DECREASE",
    });
    expect(ws.items.every((r) => r.movement === "DECREASED")).toBe(true);
    expect(ws.items.every((r) => r.movement !== "FIRST_SEEN")).toBe(true);
    const down = ws.items.find((r) => r.sku === skuDown);
    expect(down?.change?.percent).toBe("-5.12");
  });

  it("does not mutate tradePrice or RRP when loading workspace or exporting", async () => {
    const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      view: "PRICE_REVIEW",
      q: skuUp,
    });
    const csv = await exportCostIntelligenceCsv(adminId, {
      period: "ALL",
      view: "PRICE_REVIEW",
      q: skuUp,
    });
    expect(csv.csv).toContain(skuUp);
    expect(csv.csv).toContain("Previous Cost");
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(String(after.tradePrice)).toBe(String(before.tradePrice));
    expect(String(after.rrp)).toBe(String(before.rrp));
  });

  it("denies sales rep without products.cost.view, trade, and has no cost payload", async () => {
    await expect(
      getCostIntelligenceWorkspace(salesRepId, { period: "ALL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getCostIntelligenceWorkspace(buyerId, { period: "ALL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      exportCostIntelligenceCsv(salesRepId, { period: "ALL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      exportCostIntelligenceCsv(buyerId, { period: "ALL" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("paginates server-side", async () => {
    const page1 = await getCostIntelligenceWorkspace(adminId, {
      period: "ALL",
      page: 1,
      pageSize: 25,
    });
    expect(page1.items.length).toBeLessThanOrEqual(25);
    expect(page1.pageSize).toBe(25);
    expect(page1.totalPages).toBeGreaterThanOrEqual(1);
  });
});
