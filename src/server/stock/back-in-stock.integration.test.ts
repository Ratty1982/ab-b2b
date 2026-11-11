import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { applyStockFeed } from "@/server/stock/service";
import { listBackInStockEvents } from "@/server/stock/back-in-stock";
import { AuthError } from "@/server/rbac/guards";
import { AUTOPART_WAREHOUSE_CODE, STOCK_SYNC_MUTEX_ID } from "@/domain/stock";

const prisma = new PrismaClient();
let adminId = "";
let tradeUserId = "";

async function clearStockLock() {
  await prisma.$executeRaw`
    UPDATE "StockSyncMutex"
    SET "holder" = NULL, "lockedAt" = NULL
    WHERE "id" = ${STOCK_SYNC_MUTEX_ID}
  `;
  await prisma.stockSyncRun.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", errorSummary: "test cleanup", completedAt: new Date() },
  });
}

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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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

function csv(rows: string[]) {
  return ["SKU,Description,Avail", ...rows].join("\n");
}

async function makeActiveProduct(sku: string, name: string) {
  const product = await saveProduct(adminId, {
    sku,
    name,
    brand: "Power Maxed",
    category: "Braking",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
  });
  return product;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("bis.admin@example.invalid", ["SUPER_ADMIN"]);
  tradeUserId = await ensureUser("bis.trade@example.invalid", [], "TRADE");
  await clearStockLock();
});

afterEach(async () => {
  await clearStockLock();
});

afterAll(async () => {
  await clearStockLock();
  await prisma.$disconnect();
});

describe("StockBackInStockEvent recording + listing", () => {
  it(
    "records 0→10, skips 10→20, skips UNKNOWN→10, records 10→0→5, and is idempotent on repeat",
    async () => {
    const stamp = Date.now();
    const sku = `BIS-A-${stamp}`;
    const product = await makeActiveProduct(sku, `BIS Product ${stamp}`);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });

    // First live apply: UNKNOWN → 10 — confirm inventory, but NO BIS event.
    const unknownToTen = await applyStockFeed({
      text: csv([`${sku},first,10`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T09:00:00.000Z"),
    });
    expect(unknownToTen.status).toBe("SUCCESS");
    expect(
      await prisma.stockBackInStockEvent.count({ where: { runId: unknownToTen.runId } }),
    ).toBe(0);

    // 10 → 20 — quantity change only, no BIS.
    const tenToTwenty = await applyStockFeed({
      text: csv([`${sku},up,20`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T10:00:00.000Z"),
    });
    expect(
      await prisma.stockBackInStockEvent.count({ where: { runId: tenToTwenty.runId } }),
    ).toBe(0);

    // 20 → 0 — go to confirmed zero.
    await applyStockFeed({
      text: csv([`${sku},zero,0`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T11:00:00.000Z"),
    });

    // 0 → 10 — genuine back in stock.
    const zeroToTen = await applyStockFeed({
      text: csv([`${sku},back,10`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T12:00:00.000Z"),
    });
    const firstEvents = await prisma.stockBackInStockEvent.findMany({
      where: { runId: zeroToTen.runId },
    });
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0]).toMatchObject({
      variantId: variant.id,
      productId: product.id,
      previousQty: 0,
      newQty: 10,
      skuSnapshot: sku,
    });

    // Identical report again — StockSyncChange may be empty (unchanged); no new BIS.
    const again = await applyStockFeed({
      text: csv([`${sku},back,10`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T12:30:00.000Z"),
    });
    expect(await prisma.stockBackInStockEvent.count({ where: { runId: again.runId } })).toBe(0);
    expect(await prisma.stockBackInStockEvent.count({ where: { variantId: variant.id } })).toBe(1);

    // 10 → 0 → 5 — new BIS event on the 0→5 run.
    await applyStockFeed({
      text: csv([`${sku},zero2,0`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T13:00:00.000Z"),
    });
    const zeroToFive = await applyStockFeed({
      text: csv([`${sku},return,5`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-11T14:00:00.000Z"),
    });
    const second = await prisma.stockBackInStockEvent.findMany({
      where: { runId: zeroToFive.runId },
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.newQty).toBe(5);
    expect(await prisma.stockBackInStockEvent.count({ where: { variantId: variant.id } })).toBe(2);
  },
    60_000,
  );

  it(
    "respects manual override + reserved for display sellable, not for transition detection",
    async () => {
    const stamp = Date.now();
    const sku = `BIS-B-${stamp}`;
    await makeActiveProduct(sku, `BIS Override ${stamp}`);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });

    await applyStockFeed({
      text: csv([`${sku},seed,0`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-10T09:00:00.000Z"),
    });

    const warehouse = await prisma.warehouse.findUniqueOrThrow({
      where: { code: AUTOPART_WAREHOUSE_CODE },
    });
    await prisma.inventory.update({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      data: { manualOverrideQty: 3, qtyReserved: 2 },
    });

    // Feed 0→15 while override is active — transition is still based on Avail 0→15.
    const live = await applyStockFeed({
      text: csv([`${sku},return,15`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      observedAt: new Date("2026-11-10T10:00:00.000Z"),
    });
    expect(await prisma.stockBackInStockEvent.count({ where: { runId: live.runId } })).toBe(1);

    const listed = await listBackInStockEvents(adminId, { forDashboard: true, limit: 20 });
    const row = listed.items.find((item) => item.sku === sku);
    expect(row).toBeTruthy();
    // Display sellable uses override 3 − reserved 2 = 1.
    expect(row?.currentAvailQty).toBe(15);
    expect(row?.manualOverrideQty).toBe(3);
    expect(row?.reservedQty).toBe(2);
    expect(row?.currentSellableQty).toBe(1);
    expect(row?.imageSrc).toBeNull();
  },
    60_000,
  );

  it(
    "does not record for inactive / non-trade-visible products and rejects trade actors",
    async () => {
      const stamp = Date.now();
      const sku = `BIS-C-${stamp}`;
      const product = await makeActiveProduct(sku, `BIS Hidden ${stamp}`);
      await applyStockFeed({
        text: csv([`${sku},seed,0`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { isTradeVisible: false },
      });
      const hidden = await applyStockFeed({
        text: csv([`${sku},back,9`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
      expect(await prisma.stockBackInStockEvent.count({ where: { runId: hidden.runId } })).toBe(0);

      await expect(listBackInStockEvents(tradeUserId, { forDashboard: true })).rejects.toBeInstanceOf(
        AuthError,
      );
    },
    60_000,
  );

  it(
    "hides events when current Avail is no longer positive",
    async () => {
      const stamp = Date.now();
      const sku = `BIS-D-${stamp}`;
      await makeActiveProduct(sku, `BIS Gone ${stamp}`);
      await applyStockFeed({
        text: csv([`${sku},seed,0`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-09T09:00:00.000Z"),
      });
      await applyStockFeed({
        text: csv([`${sku},back,7`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-09T10:00:00.000Z"),
      });
      const before = await listBackInStockEvents(adminId, { forDashboard: true, limit: 50 });
      expect(before.items.some((item) => item.sku === sku)).toBe(true);

      await applyStockFeed({
        text: csv([`${sku},out,0`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-09T11:00:00.000Z"),
      });
      const after = await listBackInStockEvents(adminId, { forDashboard: true, limit: 50 });
      expect(after.items.some((item) => item.sku === sku)).toBe(false);
    },
    60_000,
  );
});
