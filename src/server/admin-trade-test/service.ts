import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";

const ADMIN_TEST_PERMS = ["admin.access", "pricing.view", "pricing.edit", "products.view"] as const;

function assertInternalCanManageTradeTest(profile: Awaited<ReturnType<typeof requireAuthenticatedUser>>) {
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Trade test level is only for internal users", "TRADE_TEST_FORBIDDEN", 403);
  }
  if (!ADMIN_TEST_PERMS.some((p) => hasPermission(profile, p))) {
    throw new AuthError("Insufficient permissions for trade test level", "TRADE_TEST_FORBIDDEN", 403);
  }
}

export type TradeTestLevelView = {
  priceListId: string | null;
  priceListCode: string | null;
  priceListName: string | null;
  options: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
};

/** Current user's admin Trade Test Level + selectable PriceLists. */
export async function getMyTradeTestLevel(userId: string | null): Promise<TradeTestLevelView> {
  const profile = await requireAuthenticatedUser(userId);
  assertInternalCanManageTradeTest(profile);

  const [user, lists] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
      select: {
        tradeTestPriceListId: true,
        tradeTestPriceList: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.priceList.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, isDefault: true },
    }),
  ]);

  return {
    priceListId: user.tradeTestPriceListId,
    priceListCode: user.tradeTestPriceList?.code ?? null,
    priceListName: user.tradeTestPriceList?.name ?? null,
    options: lists,
  };
}

const setSchema = z.object({
  priceListId: z.string().cuid().nullable(),
});

/** Persist Trade Test Level for the authenticated INTERNAL user only. */
export async function setMyTradeTestLevel(userId: string | null, raw: unknown): Promise<TradeTestLevelView> {
  const profile = await requireAuthenticatedUser(userId);
  assertInternalCanManageTradeTest(profile);
  const input = setSchema.parse(raw);

  if (input.priceListId) {
    const list = await prisma.priceList.findUnique({ where: { id: input.priceListId } });
    if (!list) {
      throw new AuthError("Price list not found", "PRICE_LIST_NOT_FOUND", 404);
    }
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: profile.userId },
    select: {
      tradeTestPriceListId: true,
      tradeTestPriceList: { select: { id: true, code: true, name: true } },
    },
  });

  const updated = await prisma.user.update({
    where: { id: profile.userId },
    data: { tradeTestPriceListId: input.priceListId },
    select: {
      tradeTestPriceListId: true,
      tradeTestPriceList: { select: { id: true, code: true, name: true } },
    },
  });

  await recordAuditEvent({
    action: "user.trade_test_price_list.updated",
    entityType: "User",
    entityId: profile.userId,
    actorUserId: profile.userId,
    targetUserId: profile.userId,
    before: {
      tradeTestPriceListId: before.tradeTestPriceListId,
      code: before.tradeTestPriceList?.code ?? null,
      name: before.tradeTestPriceList?.name ?? null,
    },
    after: {
      tradeTestPriceListId: updated.tradeTestPriceListId,
      code: updated.tradeTestPriceList?.code ?? null,
      name: updated.tradeTestPriceList?.name ?? null,
    },
  });

  const options = await prisma.priceList.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isDefault: true },
  });

  return {
    priceListId: updated.tradeTestPriceListId,
    priceListCode: updated.tradeTestPriceList?.code ?? null,
    priceListName: updated.tradeTestPriceList?.name ?? null,
    options,
  };
}
