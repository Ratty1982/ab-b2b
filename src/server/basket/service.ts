import { z } from "zod";
import { prisma } from "@/infra/database/client";
import {
  AuthError,
  requireAuthenticatedUser,
  requireCompanyPermission,
} from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { loadPricingActor, resolveVariantTradePrices } from "@/server/pricing/resolve-trade-price";
import { loadStockByVariantIds } from "@/server/stock/service";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import {
  addMoney,
  moneyToString,
  mulQty,
  parseMoney,
  roundGbpDisplay,
  applyVatInc,
  moneyZero,
} from "@/domain/money";
import {
  assessBasketLineQuantity,
  basketLineIssueMessage,
  canDecrementQuantity,
  canIncrementQuantity,
  caseCountForQuantity,
  formatCaseCountLabel,
  getOrderingRules,
  isOrderableByStockPolicy,
  maxOrderableQuantity,
  validateOrderQuantity,
  type BasketLineIssue,
} from "@/domain/ordering";
import { publicTradeOrderingCopy } from "@/domain/case-ordering";
import type { PublicAvailability } from "@/domain/availability";
import type { TradePriceResolution } from "@/domain/trade-price-resolution";

const variantIdSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().positive().max(100_000),
});

const itemIdSchema = z.object({
  itemId: z.string().cuid(),
  quantity: z.number().int().positive().max(100_000),
});

const removeSchema = z.object({
  itemId: z.string().cuid(),
});

export type BasketMoney = {
  net: string;
  vat: string;
  gross: string;
  netDisplay: string;
  vatDisplay: string;
  grossDisplay: string;
};

export type PublicBasketLine = {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  sku: string;
  name: string;
  imageSrc: string | null;
  quantity: number;
  caseQty: number | null;
  caseCount: number | null;
  caseCountLabel: string | null;
  caseTitle: string | null;
  unitPriceExVat: string | null;
  unitPriceExVatDisplay: string | null;
  lineNet: string | null;
  lineNetDisplay: string | null;
  lineVat: string | null;
  lineGross: string | null;
  availability: PublicAvailability | null;
  issue: BasketLineIssue;
  issueMessage: string | null;
  canIncrement: boolean;
  canDecrement: boolean;
  priceSource: TradePriceResolution["source"] | null;
};

export type PublicBasket = {
  id: string;
  /** Null for admin trade-test baskets. */
  companyId: string | null;
  companyName: string;
  /** True when this is an INTERNAL admin isolated test basket. */
  adminTest: boolean;
  status: "OPEN";
  lineCount: number;
  unitCount: number;
  lines: PublicBasketLine[];
  totals: BasketMoney;
  currency: "GBP";
  hasBlockingIssues: boolean;
};

export type BasketSummary = {
  basketId: string | null;
  companyId: string | null;
  lineCount: number;
  unitCount: number;
};

export type ProductOrderingPanel = {
  orderable: boolean;
  reason: string | null;
  caseQty: number | null;
  caseTitle: string | null;
  caseSubtitle: string | null;
  minimumQuantity: number | null;
  quantity: number | null;
  caseCount: number | null;
  caseCountLabel: string | null;
  /** Authoritative 4dp unit price ex VAT (do not multiply the 2dp display). */
  unitPriceExVat: string | null;
  unitPriceExVatDisplay: string | null;
  lineNetDisplay: string | null;
  canIncrement: boolean;
  canDecrement: boolean;
  canAdd: boolean;
  insufficientFullCase: boolean;
};

type BasketContext = {
  kind: "company" | "admin_test";
  companyId: string | null;
  companyName: string;
  /**
   * Admin PRICE_LIST mode: selected PriceList id.
   * Admin BASE_TRADE mode: null (resolver uses ProductVariant.tradePrice).
   * Company baskets: null (list comes via companyId).
   */
  priceListId: string | null;
  /** True for INTERNAL BASE_TRADE / PRICE_LIST admin test contexts. */
  adminTestActive: boolean;
  canMutate: boolean;
  canView: boolean;
  userId: string;
};

const ADMIN_TEST_BASKET_LABEL = "Admin trade test";
const ADMIN_NO_TEST_LEVEL =
  "Select a trade test level in Admin to enable ordering.";

async function resolveBasketContext(userId: string): Promise<BasketContext> {
  const profile = await requireAuthenticatedUser(userId);
  const actor = await loadPricingActor(userId);

  if (profile.actorType === "TRADE") {
    if (!actor.companyId) {
      throw new AuthError("No company context for basket", "BASKET_NO_COMPANY", 403);
    }
    const company = await prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { id: true, name: true, status: true },
    });
    if (!company || company.status !== "ACTIVE") {
      throw new AuthError("Company is not approved for ordering", "BASKET_COMPANY_INACTIVE", 403);
    }
    await requireCompanyPermission(userId, company.id, "orders.view");
    return {
      kind: "company",
      companyId: company.id,
      companyName: company.name,
      priceListId: null,
      adminTestActive: false,
      canMutate: hasPermission(profile, "orders.create"),
      canView: true,
      userId,
    };
  }

  if (profile.actorType === "INTERNAL") {
    const canMutate =
      hasPermission(profile, "admin.access") ||
      hasPermission(profile, "orders.create") ||
      hasPermission(profile, "orders.place_for_customer") ||
      hasPermission(profile, "pricing.view");
    if (!canMutate) {
      throw new AuthError(
        "You do not have permission to use the admin test basket",
        "BASKET_FORBIDDEN",
        403,
      );
    }

    if (actor.adminTestPricingMode === "BASE_TRADE") {
      return {
        kind: "admin_test",
        companyId: null,
        companyName: `${ADMIN_TEST_BASKET_LABEL} · Default Trade Price`,
        priceListId: null,
        adminTestActive: true,
        canMutate: true,
        canView: true,
        userId,
      };
    }

    if (actor.adminTestPricingMode === "PRICE_LIST" && actor.adminTestPriceListId) {
      const list = await prisma.priceList.findUnique({
        where: { id: actor.adminTestPriceListId },
        select: { id: true, name: true, code: true },
      });
      if (!list) {
        throw new AuthError(ADMIN_NO_TEST_LEVEL, "BASKET_NO_TEST_LEVEL", 403);
      }
      return {
        kind: "admin_test",
        companyId: null,
        companyName: `${ADMIN_TEST_BASKET_LABEL} · ${list.name}`,
        priceListId: list.id,
        adminTestActive: true,
        canMutate: true,
        canView: true,
        userId,
      };
    }

    throw new AuthError(ADMIN_NO_TEST_LEVEL, "BASKET_NO_TEST_LEVEL", 403);
  }

  throw new AuthError("Trade basket requires a trade customer account", "BASKET_FORBIDDEN", 403);
}

async function requireMutableBasketContext(userId: string) {
  const ctx = await resolveBasketContext(userId);
  if (!ctx.canMutate) {
    throw new AuthError("You do not have permission to modify the basket", "BASKET_READ_ONLY", 403);
  }
  return ctx;
}

async function getOrCreateOpenBasket(ctx: BasketContext) {
  if (ctx.kind === "company" && ctx.companyId) {
    const existing = await prisma.basket.findFirst({
      where: { companyId: ctx.companyId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;
    return prisma.basket.create({
      data: { companyId: ctx.companyId, userId: ctx.userId, status: "OPEN" },
    });
  }

  // Admin test basket: owned by the admin user, never attached to a company.
  const existing = await prisma.basket.findFirst({
    where: { userId: ctx.userId, companyId: null, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.basket.create({
    data: { companyId: null, userId: ctx.userId, status: "OPEN" },
  });
}

async function loadOwnedBasket(userId: string, basketId: string) {
  const ctx = await resolveBasketContext(userId);
  const basket = await prisma.basket.findFirst({
    where:
      ctx.kind === "company"
        ? { id: basketId, companyId: ctx.companyId, status: "OPEN" }
        : { id: basketId, userId: ctx.userId, companyId: null, status: "OPEN" },
  });
  if (!basket) {
    throw new AuthError("Basket not found", "BASKET_NOT_FOUND", 404);
  }
  return { basket, ctx };
}

function pricingInputFromContext(ctx: BasketContext) {
  return {
    companyId: ctx.companyId,
    priceListId: ctx.kind === "admin_test" ? ctx.priceListId : null,
    adminTestActive: ctx.adminTestActive,
  };
}

function moneyBundle(net: ReturnType<typeof moneyZero>, vat: ReturnType<typeof moneyZero>, gross: ReturnType<typeof moneyZero>): BasketMoney {
  return {
    net: moneyToString(net, 4),
    vat: moneyToString(vat, 4),
    gross: moneyToString(gross, 4),
    netDisplay: moneyToString(net, 2),
    vatDisplay: moneyToString(vat, 2),
    grossDisplay: moneyToString(gross, 2),
  };
}

function lineTotalsFromResolution(resolution: TradePriceResolution | null, quantity: number) {
  if (!resolution || resolution.source === "NONE" || !resolution.unitPriceExVat) {
    return {
      unitEx: null as string | null,
      unitExDisplay: null as string | null,
      lineNet: null as string | null,
      lineNetDisplay: null as string | null,
      lineVat: null as string | null,
      lineGross: null as string | null,
      hasPrice: false,
      source: null as TradePriceResolution["source"] | null,
    };
  }
  const unitEx = parseMoney(resolution.unitPriceExVat)!;
  const vatRate = parseMoney(resolution.vatRate)!;
  const lineNet = roundGbpDisplay(mulQty(unitEx, quantity));
  const lineGross = applyVatInc(lineNet, vatRate);
  const lineVat = roundGbpDisplay({
    minor: lineGross.minor - lineNet.minor,
  });
  return {
    unitEx: moneyToString(unitEx, 4),
    unitExDisplay: moneyToString(roundGbpDisplay(unitEx), 2),
    lineNet: moneyToString(lineNet, 4),
    lineNetDisplay: moneyToString(lineNet, 2),
    lineVat: moneyToString(lineVat, 4),
    lineGross: moneyToString(lineGross, 4),
    hasPrice: true,
    source: resolution.source,
  };
}

async function hydrateBasket(basketId: string, ctx: BasketContext): Promise<PublicBasket> {
  const items = await prisma.basketItem.findMany({
    where: { basketId },
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          product: {
            include: {
              media: {
                orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
                take: 1,
                select: { mediaId: true },
              },
            },
          },
        },
      },
    },
  });

  const variantIds = items.map((item) => item.variantId);
  const stockMap = await loadStockByVariantIds(variantIds);

  const qtyGroups = new Map<number, typeof items>();
  for (const item of items) {
    const list = qtyGroups.get(item.qty) ?? [];
    list.push(item);
    qtyGroups.set(item.qty, list);
  }

  const priceByVariant = new Map<string, TradePriceResolution>();
  const pricing = pricingInputFromContext(ctx);
  for (const [qty, group] of qtyGroups) {
    const resolved = await resolveVariantTradePrices({
      companyId: pricing.companyId,
      priceListId: pricing.priceListId,
      adminTestActive: pricing.adminTestActive,
      quantity: qty,
      variants: group.map((item) => ({
        id: item.variant.id,
        sku: item.variant.sku,
        tradePrice: item.variant.tradePrice,
        vatCode: item.variant.vatCode,
      })),
    });
    for (const [id, price] of resolved) priceByVariant.set(id, price);
  }

  let totalNet = moneyZero();
  let totalVat = moneyZero();
  let totalGross = moneyZero();
  let hasBlockingIssues = false;
  const lines: PublicBasketLine[] = [];

  for (const item of items) {
    const variant = item.variant;
    const product = variant.product;
    const stock = stockMap.get(variant.id);
    const sellableQty = stock?.sellableQty ?? 0;
    const stale = stock?.stale ?? true;
    const availability = stock?.availability ?? null;
    const resolution = priceByVariant.get(variant.id) ?? null;
    const money = lineTotalsFromResolution(resolution, item.qty);
    const issue = assessBasketLineQuantity({
      quantity: item.qty,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty,
      productActive: product.status === "ACTIVE" && product.isActive,
      tradeVisible: product.isTradeVisible,
      orderableByStockPolicy: stock ? isOrderableByStockPolicy({ sellableQty, stale, availability }) : false,
      hasTradePrice: money.hasPrice,
    });
    if (issue !== "VALID") hasBlockingIssues = true;
    const rules = getOrderingRules({ caseQty: variant.caseQty, minimumOrderQty: variant.minOrderQty });
    const caseQty = rules.orderable ? rules.caseQty : null;
    const cases = caseQty != null ? caseCountForQuantity(item.qty, caseQty) : null;
    const copy = publicTradeOrderingCopy(caseQty);
    if (money.hasPrice && issue === "VALID") {
      totalNet = addMoney(totalNet, parseMoney(money.lineNet!)!);
      totalVat = addMoney(totalVat, parseMoney(money.lineVat!)!);
      totalGross = addMoney(totalGross, parseMoney(money.lineGross!)!);
    }
    const imageId = product.media[0]?.mediaId ?? null;
    lines.push({
      id: item.id,
      variantId: variant.id,
      productId: product.id,
      productSlug: product.slug,
      sku: variant.sku,
      name: product.name,
      imageSrc: imageId ? cmsMediaPublicPath(imageId) : null,
      quantity: item.qty,
      caseQty,
      caseCount: cases,
      caseCountLabel: cases != null ? formatCaseCountLabel(cases) : null,
      caseTitle: copy?.title ?? null,
      unitPriceExVat: money.unitEx,
      unitPriceExVatDisplay: money.unitExDisplay,
      lineNet: money.lineNet,
      lineNetDisplay: money.lineNetDisplay,
      lineVat: money.lineVat,
      lineGross: money.lineGross,
      availability,
      issue,
      issueMessage: basketLineIssueMessage(issue),
      canIncrement:
        issue === "VALID" &&
        canIncrementQuantity({
          currentQuantity: item.qty,
          caseQty: variant.caseQty,
          minimumOrderQty: variant.minOrderQty,
          sellableQty,
        }),
      canDecrement:
        issue === "VALID" &&
        canDecrementQuantity({
          currentQuantity: item.qty,
          caseQty: variant.caseQty,
          minimumOrderQty: variant.minOrderQty,
        }),
      priceSource: money.source,
    });
  }

  return {
    id: basketId,
    companyId: ctx.companyId,
    companyName: ctx.companyName,
    adminTest: ctx.kind === "admin_test",
    status: "OPEN",
    lineCount: lines.length,
    unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines,
    totals: moneyBundle(totalNet, totalVat, totalGross),
    currency: "GBP",
    hasBlockingIssues,
  };
}

export async function getBasketSummary(userId: string): Promise<BasketSummary> {
  try {
    const ctx = await resolveBasketContext(userId);
    const basket = await prisma.basket.findFirst({
      where:
        ctx.kind === "company"
          ? { companyId: ctx.companyId, status: "OPEN" }
          : { userId: ctx.userId, companyId: null, status: "OPEN" },
      include: { items: { select: { qty: true } } },
    });
    if (!basket) {
      return { basketId: null, companyId: ctx.companyId, lineCount: 0, unitCount: 0 };
    }
    return {
      basketId: basket.id,
      companyId: ctx.companyId,
      lineCount: basket.items.length,
      unitCount: basket.items.reduce((sum, item) => sum + item.qty, 0),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { basketId: null, companyId: null, lineCount: 0, unitCount: 0 };
    }
    throw error;
  }
}

export async function getBasket(userId: string): Promise<PublicBasket> {
  const ctx = await resolveBasketContext(userId);
  const basket = await getOrCreateOpenBasket(ctx);
  return hydrateBasket(basket.id, ctx);
}

async function loadOrderableVariant(variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          isActive: true,
          isTradeVisible: true,
        },
      },
    },
  });
  if (!variant) {
    throw new AuthError("Product not found", "PRODUCT_NOT_FOUND", 404);
  }
  return variant;
}

export async function addToBasket(userId: string, raw: unknown): Promise<PublicBasket> {
  const input = variantIdSchema.parse(raw);
  const ctx = await requireMutableBasketContext(userId);
  const variant = await loadOrderableVariant(input.variantId);
  if (variant.product.status !== "ACTIVE" || !variant.product.isActive || !variant.product.isTradeVisible) {
    throw new AuthError("This product is not available for ordering", "PRODUCT_UNAVAILABLE", 400);
  }

  const stockMap = await loadStockByVariantIds([variant.id]);
  const stock = stockMap.get(variant.id);
  const sellableQty = stock?.sellableQty ?? 0;
  const orderableByStockPolicy = stock
    ? isOrderableByStockPolicy({
        sellableQty,
        stale: stock.stale,
        availability: stock.availability,
      })
    : false;

  const basket = await getOrCreateOpenBasket(ctx);
  const existing = await prisma.basketItem.findUnique({
    where: { basketId_variantId: { basketId: basket.id, variantId: variant.id } },
  });
  const nextQty = (existing?.qty ?? 0) + input.quantity;

  const validated = validateOrderQuantity({
    requestedQuantity: nextQty,
    caseQty: variant.caseQty,
    minimumOrderQty: variant.minOrderQty,
    sellableQty,
    orderableByStockPolicy,
  });
  if (!validated.ok) {
    throw new AuthError(validated.message, validated.code, 400);
  }

  const pricing = pricingInputFromContext(ctx);
  const priced = await resolveVariantTradePrices({
    companyId: pricing.companyId,
    priceListId: pricing.priceListId,
    adminTestActive: pricing.adminTestActive,
    quantity: nextQty,
    variants: [
      {
        id: variant.id,
        sku: variant.sku,
        tradePrice: variant.tradePrice,
        vatCode: variant.vatCode,
      },
    ],
  });
  const resolution = priced.get(variant.id);
  if (!resolution || resolution.source === "NONE") {
    throw new AuthError("Trade price unavailable for this product", "PRICE_UNAVAILABLE", 400);
  }

  if (existing) {
    await prisma.basketItem.update({
      where: { id: existing.id },
      data: { qty: nextQty },
    });
  } else {
    await prisma.basketItem.create({
      data: {
        basketId: basket.id,
        variantId: variant.id,
        qty: nextQty,
      },
    });
  }

  return hydrateBasket(basket.id, ctx);
}

export async function updateBasketItem(userId: string, raw: unknown): Promise<PublicBasket> {
  const input = itemIdSchema.parse(raw);
  const ctx = await requireMutableBasketContext(userId);
  const item = await prisma.basketItem.findFirst({
    where:
      ctx.kind === "company"
        ? { id: input.itemId, basket: { companyId: ctx.companyId, status: "OPEN" } }
        : { id: input.itemId, basket: { userId: ctx.userId, companyId: null, status: "OPEN" } },
    include: { variant: true, basket: true },
  });
  if (!item) {
    throw new AuthError("Basket item not found", "BASKET_ITEM_NOT_FOUND", 404);
  }

  const stockMap = await loadStockByVariantIds([item.variantId]);
  const stock = stockMap.get(item.variantId);
  const sellableQty = stock?.sellableQty ?? 0;
  const validated = validateOrderQuantity({
    requestedQuantity: input.quantity,
    caseQty: item.variant.caseQty,
    minimumOrderQty: item.variant.minOrderQty,
    sellableQty,
    orderableByStockPolicy: stock
      ? isOrderableByStockPolicy({
          sellableQty,
          stale: stock.stale,
          availability: stock.availability,
        })
      : false,
  });
  if (!validated.ok) {
    throw new AuthError(validated.message, validated.code, 400);
  }

  const pricing = pricingInputFromContext(ctx);
  const priced = await resolveVariantTradePrices({
    companyId: pricing.companyId,
    priceListId: pricing.priceListId,
    adminTestActive: pricing.adminTestActive,
    quantity: input.quantity,
    variants: [
      {
        id: item.variant.id,
        sku: item.variant.sku,
        tradePrice: item.variant.tradePrice,
        vatCode: item.variant.vatCode,
      },
    ],
  });
  if (!priced.get(item.variant.id) || priced.get(item.variant.id)!.source === "NONE") {
    throw new AuthError("Trade price unavailable for this product", "PRICE_UNAVAILABLE", 400);
  }

  await prisma.basketItem.update({
    where: { id: item.id },
    data: { qty: input.quantity },
  });

  return hydrateBasket(item.basketId, ctx);
}

export async function removeBasketItem(userId: string, raw: unknown): Promise<PublicBasket> {
  const input = removeSchema.parse(raw);
  const ctx = await requireMutableBasketContext(userId);
  const item = await prisma.basketItem.findFirst({
    where:
      ctx.kind === "company"
        ? { id: input.itemId, basket: { companyId: ctx.companyId, status: "OPEN" } }
        : { id: input.itemId, basket: { userId: ctx.userId, companyId: null, status: "OPEN" } },
  });
  if (!item) {
    throw new AuthError("Basket item not found", "BASKET_ITEM_NOT_FOUND", 404);
  }
  await prisma.basketItem.delete({ where: { id: item.id } });
  return hydrateBasket(item.basketId, ctx);
}

const ANON_ORDER_REASON = "Sign in with a trade account to order";
const ADMIN_NO_TEST_LEVEL_REASON = ADMIN_NO_TEST_LEVEL;

/** Preview ordering controls for a PDP. Never returns exact sellable qty. */
export async function getProductOrderingPanel(
  userId: string | null,
  raw: unknown,
): Promise<ProductOrderingPanel> {
  const { variantId } = z.object({ variantId: z.string().cuid() }).parse(raw);
  const empty: ProductOrderingPanel = {
    orderable: false,
    reason: ANON_ORDER_REASON,
    caseQty: null,
    caseTitle: null,
    caseSubtitle: null,
    minimumQuantity: null,
    quantity: null,
    caseCount: null,
    caseCountLabel: null,
    unitPriceExVat: null,
    unitPriceExVatDisplay: null,
    lineNetDisplay: null,
    canIncrement: false,
    canDecrement: false,
    canAdd: false,
    insufficientFullCase: false,
  };
  if (!userId) return empty;

  let ctx: BasketContext;
  try {
    ctx = await resolveBasketContext(userId);
  } catch (error) {
    // Authenticated actors must never be told to "Sign in".
    if (error instanceof AuthError) {
      if (error.code === "BASKET_NO_TEST_LEVEL" || error.code === "BASKET_NO_COMPANY") {
        return { ...empty, reason: error.message || ADMIN_NO_TEST_LEVEL_REASON };
      }
      return {
        ...empty,
        reason: error.message || ADMIN_NO_TEST_LEVEL_REASON,
      };
    }
    return { ...empty, reason: ADMIN_NO_TEST_LEVEL_REASON };
  }
  if (!ctx.canMutate) {
    return { ...empty, reason: "Your account can view prices but cannot place orders" };
  }

  const variant = await loadOrderableVariant(variantId);
  const copy = publicTradeOrderingCopy(variant.caseQty);
  const rules = getOrderingRules({ caseQty: variant.caseQty, minimumOrderQty: variant.minOrderQty });
  if (!rules.orderable || !copy) {
    return {
      ...empty,
      reason: "This product is not available for online ordering",
    };
  }
  if (variant.product.status !== "ACTIVE" || !variant.product.isActive || !variant.product.isTradeVisible) {
    return { ...empty, reason: "This product is not available for ordering", caseTitle: copy.title, caseSubtitle: copy.subtitle };
  }

  const stockMap = await loadStockByVariantIds([variant.id]);
  const stock = stockMap.get(variant.id);
  const sellableQty = stock?.sellableQty ?? 0;
  const orderableByStockPolicy = stock
    ? isOrderableByStockPolicy({
        sellableQty,
        stale: stock.stale,
        availability: stock.availability,
      })
    : false;
  const maxQty = maxOrderableQuantity({
    caseQty: rules.caseQty,
    minimumOrderQty: rules.minimumOrderQty,
    sellableQty,
  });
  if (!orderableByStockPolicy || maxQty == null) {
    return {
      orderable: false,
      reason: "Insufficient stock for a full case",
      caseQty: rules.caseQty,
      caseTitle: copy.title,
      caseSubtitle: copy.subtitle,
      minimumQuantity: rules.minimumOrderQty,
      quantity: rules.minimumOrderQty,
      caseCount: rules.minimumOrderQty / rules.caseQty,
      caseCountLabel: formatCaseCountLabel(rules.minimumOrderQty / rules.caseQty),
      unitPriceExVat: null,
      unitPriceExVatDisplay: null,
      lineNetDisplay: null,
      canIncrement: false,
      canDecrement: false,
      canAdd: false,
      insufficientFullCase: true,
    };
  }

  const quantity = rules.minimumOrderQty;
  const pricing = pricingInputFromContext(ctx);
  const priced = await resolveVariantTradePrices({
    companyId: pricing.companyId,
    priceListId: pricing.priceListId,
    adminTestActive: pricing.adminTestActive,
    quantity,
    variants: [
      {
        id: variant.id,
        sku: variant.sku,
        tradePrice: variant.tradePrice,
        vatCode: variant.vatCode,
      },
    ],
  });
  const resolution = priced.get(variant.id);
  const money = lineTotalsFromResolution(resolution ?? null, quantity);
  if (!money.hasPrice) {
    return {
      ...empty,
      reason: "Trade price unavailable",
      caseQty: rules.caseQty,
      caseTitle: copy.title,
      caseSubtitle: copy.subtitle,
    };
  }

  return {
    orderable: true,
    reason: null,
    caseQty: rules.caseQty,
    caseTitle: copy.title,
    caseSubtitle: copy.subtitle,
    minimumQuantity: rules.minimumOrderQty,
    quantity,
    caseCount: quantity / rules.caseQty,
    caseCountLabel: formatCaseCountLabel(quantity / rules.caseQty),
    unitPriceExVat: money.unitEx,
    unitPriceExVatDisplay: money.unitExDisplay,
    lineNetDisplay: money.lineNetDisplay,
    canIncrement: canIncrementQuantity({
      currentQuantity: quantity,
      caseQty: rules.caseQty,
      minimumOrderQty: rules.minimumOrderQty,
      sellableQty,
    }),
    canDecrement: false,
    canAdd: true,
    insufficientFullCase: false,
  };
}

/** Preview a candidate quantity on the PDP without mutating the basket. */
export async function previewProductOrderQuantity(
  userId: string,
  raw: unknown,
): Promise<ProductOrderingPanel> {
  const input = variantIdSchema.parse(raw);
  const panel = await getProductOrderingPanel(userId, { variantId: input.variantId });
  if (!panel.orderable || panel.caseQty == null || panel.minimumQuantity == null) return panel;

  const ctx = await requireMutableBasketContext(userId);
  const variant = await loadOrderableVariant(input.variantId);
  const stockMap = await loadStockByVariantIds([variant.id]);
  const stock = stockMap.get(variant.id);
  const sellableQty = stock?.sellableQty ?? 0;
  const validated = validateOrderQuantity({
    requestedQuantity: input.quantity,
    caseQty: variant.caseQty,
    minimumOrderQty: variant.minOrderQty,
    sellableQty,
    orderableByStockPolicy: stock
      ? isOrderableByStockPolicy({
          sellableQty,
          stale: stock.stale,
          availability: stock.availability,
        })
      : false,
  });
  if (!validated.ok) {
    return {
      ...panel,
      orderable: false,
      reason: validated.message,
      canAdd: false,
      canIncrement: false,
      canDecrement: false,
      insufficientFullCase: validated.code === "INSUFFICIENT_FULL_CASE",
    };
  }

  const pricing = pricingInputFromContext(ctx);
  const priced = await resolveVariantTradePrices({
    companyId: pricing.companyId,
    priceListId: pricing.priceListId,
    adminTestActive: pricing.adminTestActive,
    quantity: input.quantity,
    variants: [
      {
        id: variant.id,
        sku: variant.sku,
        tradePrice: variant.tradePrice,
        vatCode: variant.vatCode,
      },
    ],
  });
  const money = lineTotalsFromResolution(priced.get(variant.id) ?? null, input.quantity);
  return {
    ...panel,
    quantity: input.quantity,
    caseCount: validated.caseCount,
    caseCountLabel: formatCaseCountLabel(validated.caseCount),
    unitPriceExVat: money.unitEx,
    unitPriceExVatDisplay: money.unitExDisplay,
    lineNetDisplay: money.lineNetDisplay,
    canIncrement: canIncrementQuantity({
      currentQuantity: input.quantity,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
      sellableQty,
    }),
    canDecrement: canDecrementQuantity({
      currentQuantity: input.quantity,
      caseQty: variant.caseQty,
      minimumOrderQty: variant.minOrderQty,
    }),
    canAdd: money.hasPrice,
    insufficientFullCase: false,
    reason: null,
    orderable: true,
  };
}

export async function assertBasketOwnedByCompany(userId: string, basketId: string) {
  return loadOwnedBasket(userId, basketId);
}

const emptyOrderingPanel = (reason: string | null = null): ProductOrderingPanel => ({
  orderable: false,
  reason,
  caseQty: null,
  caseTitle: null,
  caseSubtitle: null,
  minimumQuantity: null,
  quantity: null,
  caseCount: null,
  caseCountLabel: null,
  unitPriceExVat: null,
  unitPriceExVatDisplay: null,
  lineNetDisplay: null,
  canIncrement: false,
  canDecrement: false,
  canAdd: false,
  insufficientFullCase: false,
});

export type CatalogueOrderingVariantInput = {
  id: string;
  sku: string;
  tradePrice: unknown;
  vatCode: string;
  caseQty: number | null;
  minOrderQty: number | null;
  product: {
    status: string;
    isActive: boolean;
    isTradeVisible: boolean;
  };
};

/**
 * Batch ordering panels for a catalogue page of variants.
 * One basket-context resolve, one stock batch, one price batch — no per-row DB round trips.
 */
export async function getCatalogueOrderingPanels(
  userId: string | null,
  variants: CatalogueOrderingVariantInput[],
): Promise<Map<string, ProductOrderingPanel>> {
  const out = new Map<string, ProductOrderingPanel>();
  if (!userId || variants.length === 0) return out;

  let ctx: BasketContext;
  try {
    ctx = await resolveBasketContext(userId);
  } catch (error) {
    // No ordering chrome when the actor has no legitimate basket context.
    return out;
  }
  if (!ctx.canMutate) {
    const blocked = emptyOrderingPanel("Your account can view prices but cannot place orders");
    for (const variant of variants) out.set(variant.id, blocked);
    return out;
  }

  const stockMap = await loadStockByVariantIds(variants.map((v) => v.id));
  const pricing = pricingInputFromContext(ctx);

  // First pass: classify orderable candidates and collect MOQ quantities for pricing.
  type Candidate = {
    variant: CatalogueOrderingVariantInput;
    caseQty: number;
    minimumOrderQty: number;
    copy: { title: string; subtitle: string };
    sellableQty: number;
    quantity: number;
  };
  const candidates: Candidate[] = [];

  for (const variant of variants) {
    const copy = publicTradeOrderingCopy(variant.caseQty);
    const rules = getOrderingRules({ caseQty: variant.caseQty, minimumOrderQty: variant.minOrderQty });
    if (!rules.orderable || !copy) {
      out.set(
        variant.id,
        emptyOrderingPanel("This product is not available for online ordering"),
      );
      continue;
    }
    if (variant.product.status !== "ACTIVE" || !variant.product.isActive || !variant.product.isTradeVisible) {
      out.set(variant.id, {
        ...emptyOrderingPanel("This product is not available for ordering"),
        caseTitle: copy.title,
        caseSubtitle: copy.subtitle,
        caseQty: rules.caseQty,
      });
      continue;
    }

    const stock = stockMap.get(variant.id);
    const sellableQty = stock?.sellableQty ?? 0;
    const orderableByStockPolicy = stock
      ? isOrderableByStockPolicy({
          sellableQty,
          stale: stock.stale,
          availability: stock.availability,
        })
      : false;
    const maxQty = maxOrderableQuantity({
      caseQty: rules.caseQty,
      minimumOrderQty: rules.minimumOrderQty,
      sellableQty,
    });
    if (!orderableByStockPolicy || maxQty == null) {
      out.set(variant.id, {
        orderable: false,
        reason: "Insufficient stock for a full case",
        caseQty: rules.caseQty,
        caseTitle: copy.title,
        caseSubtitle: copy.subtitle,
        minimumQuantity: rules.minimumOrderQty,
        quantity: rules.minimumOrderQty,
        caseCount: rules.minimumOrderQty / rules.caseQty,
        caseCountLabel: formatCaseCountLabel(rules.minimumOrderQty / rules.caseQty),
        unitPriceExVat: null,
        unitPriceExVatDisplay: null,
        lineNetDisplay: null,
        canIncrement: false,
        canDecrement: false,
        canAdd: false,
        insufficientFullCase: true,
      });
      continue;
    }

    candidates.push({
      variant,
      caseQty: rules.caseQty,
      minimumOrderQty: rules.minimumOrderQty,
      copy,
      sellableQty,
      quantity: rules.minimumOrderQty,
    });
  }

  // Group candidates by MOQ quantity so QuantityBreak re-resolution stays correct
  // without one pricing call per row. Most catalogue pages share a small set of MOQs.
  const byQty = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const list = byQty.get(candidate.quantity) ?? [];
    list.push(candidate);
    byQty.set(candidate.quantity, list);
  }

  for (const [quantity, group] of byQty) {
    const priced = await resolveVariantTradePrices({
      companyId: pricing.companyId,
      priceListId: pricing.priceListId,
      adminTestActive: pricing.adminTestActive,
      quantity,
      variants: group.map((c) => ({
        id: c.variant.id,
        sku: c.variant.sku,
        tradePrice: c.variant.tradePrice,
        vatCode: c.variant.vatCode,
      })),
    });
    for (const candidate of group) {
      const money = lineTotalsFromResolution(priced.get(candidate.variant.id) ?? null, quantity);
      if (!money.hasPrice) {
        out.set(candidate.variant.id, {
          ...emptyOrderingPanel("Trade price unavailable"),
          caseQty: candidate.caseQty,
          caseTitle: candidate.copy.title,
          caseSubtitle: candidate.copy.subtitle,
        });
        continue;
      }
      out.set(candidate.variant.id, {
        orderable: true,
        reason: null,
        caseQty: candidate.caseQty,
        caseTitle: candidate.copy.title,
        caseSubtitle: candidate.copy.subtitle,
        minimumQuantity: candidate.minimumOrderQty,
        quantity,
        caseCount: quantity / candidate.caseQty,
        caseCountLabel: formatCaseCountLabel(quantity / candidate.caseQty),
        unitPriceExVat: money.unitEx,
        unitPriceExVatDisplay: money.unitExDisplay,
        lineNetDisplay: money.lineNetDisplay,
        canIncrement: canIncrementQuantity({
          currentQuantity: quantity,
          caseQty: candidate.caseQty,
          minimumOrderQty: candidate.minimumOrderQty,
          sellableQty: candidate.sellableQty,
        }),
        canDecrement: false,
        canAdd: true,
        insufficientFullCase: false,
      });
    }
  }

  return out;
}
