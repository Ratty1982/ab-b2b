import { z } from "zod";
import type { TradeTestPricingMode } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";

const ADMIN_TEST_PERMS = ["admin.access", "pricing.view", "pricing.edit", "products.view"] as const;

export const TRADE_TEST_MODES = ["NONE", "BASE_TRADE", "PRICE_LIST"] as const;
export type TradeTestMode = (typeof TRADE_TEST_MODES)[number];

export const BASE_TRADE_LABEL = "Default Trade Price";

function assertInternalCanManageTradeTest(profile: Awaited<ReturnType<typeof requireAuthenticatedUser>>) {
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Trade test level is only for internal users", "TRADE_TEST_FORBIDDEN", 403);
  }
  if (!ADMIN_TEST_PERMS.some((p) => hasPermission(profile, p))) {
    throw new AuthError("Insufficient permissions for trade test level", "TRADE_TEST_FORBIDDEN", 403);
  }
}

export type TradeTestLevelView = {
  mode: TradeTestMode;
  priceListId: string | null;
  priceListCode: string | null;
  priceListName: string | null;
  /** Human label for status / session chrome. */
  label: string | null;
  options: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
};

function viewFromUser(
  user: {
    tradeTestPricingMode: TradeTestPricingMode;
    tradeTestPriceListId: string | null;
    tradeTestPriceList: { id: string; code: string; name: string } | null;
  },
  options: TradeTestLevelView["options"],
): TradeTestLevelView {
  const mode = user.tradeTestPricingMode as TradeTestMode;
  if (mode === "BASE_TRADE") {
    return {
      mode,
      priceListId: null,
      priceListCode: null,
      priceListName: null,
      label: BASE_TRADE_LABEL,
      options,
    };
  }
  if (mode === "PRICE_LIST" && user.tradeTestPriceList) {
    return {
      mode,
      priceListId: user.tradeTestPriceListId,
      priceListCode: user.tradeTestPriceList.code,
      priceListName: user.tradeTestPriceList.name,
      label: user.tradeTestPriceList.name,
      options,
    };
  }
  return {
    mode: "NONE",
    priceListId: null,
    priceListCode: null,
    priceListName: null,
    label: null,
    options,
  };
}

async function loadOptions() {
  return prisma.priceList.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isDefault: true },
  });
}

/** Current user's admin Trade Test Level + selectable PriceLists. */
export async function getMyTradeTestLevel(userId: string | null): Promise<TradeTestLevelView> {
  const profile = await requireAuthenticatedUser(userId);
  assertInternalCanManageTradeTest(profile);

  const [user, options] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: profile.userId },
      select: {
        tradeTestPricingMode: true,
        tradeTestPriceListId: true,
        tradeTestPriceList: { select: { id: true, code: true, name: true } },
      },
    }),
    loadOptions(),
  ]);

  return viewFromUser(user, options);
}

const setSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("NONE") }),
  z.object({ mode: z.literal("BASE_TRADE") }),
  z.object({
    mode: z.literal("PRICE_LIST"),
    priceListId: z.string().cuid(),
  }),
]);

/** Persist Trade Test Level for the authenticated INTERNAL user only. */
export async function setMyTradeTestLevel(userId: string | null, raw: unknown): Promise<TradeTestLevelView> {
  const profile = await requireAuthenticatedUser(userId);
  assertInternalCanManageTradeTest(profile);
  const input = setSchema.parse(raw);

  let nextMode: TradeTestPricingMode = input.mode;
  let nextListId: string | null = null;

  if (input.mode === "PRICE_LIST") {
    const list = await prisma.priceList.findUnique({ where: { id: input.priceListId } });
    if (!list) {
      throw new AuthError("Price list not found", "PRICE_LIST_NOT_FOUND", 404);
    }
    nextListId = list.id;
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: profile.userId },
    select: {
      tradeTestPricingMode: true,
      tradeTestPriceListId: true,
      tradeTestPriceList: { select: { id: true, code: true, name: true } },
    },
  });

  const updated = await prisma.user.update({
    where: { id: profile.userId },
    data: {
      tradeTestPricingMode: nextMode,
      tradeTestPriceListId: nextListId,
    },
    select: {
      tradeTestPricingMode: true,
      tradeTestPriceListId: true,
      tradeTestPriceList: { select: { id: true, code: true, name: true } },
    },
  });

  const beforeView = viewFromUser(before, []);
  const afterView = viewFromUser(updated, []);

  await recordAuditEvent({
    action: "user.trade_test_pricing_mode.updated",
    entityType: "User",
    entityId: profile.userId,
    actorUserId: profile.userId,
    targetUserId: profile.userId,
    before: {
      mode: before.tradeTestPricingMode,
      tradeTestPriceListId: before.tradeTestPriceListId,
      label: beforeView.label,
      code: before.tradeTestPriceList?.code ?? null,
      name: before.tradeTestPriceList?.name ?? null,
    },
    after: {
      mode: updated.tradeTestPricingMode,
      tradeTestPriceListId: updated.tradeTestPriceListId,
      label: afterView.label,
      code: updated.tradeTestPriceList?.code ?? null,
      name: updated.tradeTestPriceList?.name ?? null,
    },
  });

  return viewFromUser(updated, await loadOptions());
}
