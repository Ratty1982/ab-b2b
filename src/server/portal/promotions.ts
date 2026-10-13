/**
 * Trade portal promotions list.
 * Reads existing Promotion rows. Does not create, activate, or reprice them.
 */
import { prisma } from "@/infra/database/client";
import {
  customerPromotionCopy,
  customerPromotionOfferLabel,
  customerPromotionScope,
  customerPromotionValidityLabel,
  promotionVisibleToCustomer,
  type CustomerPromotionKind,
  type CustomerPromotionSource,
} from "@/domain/customer-promotions";
import { firstOrderableQuantity } from "@/domain/pricing-management";
import { moneyToString, parseMoney, toCustomerSellUnitPrice } from "@/domain/money";
import { requireTradePortalAccess } from "@/server/rbac/guards";
import { canViewTrade } from "@/server/pricing/trade-price";
import {
  loadPricingActor,
  pricingArgsFromActor,
  resolveVariantTradePrices,
} from "@/server/pricing/resolve-trade-price";

export type CustomerPromotionProduct = {
  sku: string;
  slug: string;
  name: string;
  variantId: string;
  quantity: number;
  /** This customer's resolved unit price ex VAT, only when this promotion is the applied offer. */
  unitPriceLabel: string | null;
};

export type CustomerPromotionView = {
  id: string;
  code: string;
  name: string;
  type: CustomerPromotionKind;
  offerLabel: string;
  validityLabel: string;
  description: string | null;
  imageUrl: string | null;
  scope: "catalogue" | "products";
  products: CustomerPromotionProduct[];
};

export async function listCustomerPromotions(userId: string, at: Date = new Date()) {
  await requireTradePortalAccess(userId);
  const views = await loadCustomerPromotionViews(at);
  return attachResolvedPromotionPrices(userId, views, at);
}

export async function loadCustomerPromotionViews(at: Date): Promise<CustomerPromotionView[]> {
  const rows = await prisma.promotion.findMany({
    orderBy: [{ name: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      value: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      metadata: true,
      description: true,
      imageUrl: true,
    },
  });
  const visible = rows.filter((row) => promotionVisibleToCustomer(toSource(row), at));
  const productsByKey = await loadScopedProducts(visible.map((row) => row.metadata));

  return visible.flatMap((row) => {
    if (row.type === "QUANTITY_DEAL") return [];
    const scope = customerPromotionScope(row.metadata);
    const products = scope.catalogueWide ? [] : productsForScope(scope, productsByKey);
    const copy = customerPromotionCopy(row.metadata, {
      description: row.description,
      imageUrl: row.imageUrl,
    });
    return [
      {
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        offerLabel: customerPromotionOfferLabel(row.type, row.value),
        validityLabel: customerPromotionValidityLabel(row.startsAt, row.endsAt),
        description: copy.description,
        imageUrl: copy.imageUrl,
        scope: scope.catalogueWide ? "catalogue" : "products",
        products: products.map((product) => ({
          sku: product.sku,
          slug: product.slug,
          name: product.name,
          variantId: product.variantId,
          quantity: 1,
          unitPriceLabel: null,
        })),
      },
    ];
  });
}

/**
 * Replace eligible-product stubs with the products whose quantity-1 resolution
 * actually uses that promotion. Prices come from the trade-price engine.
 */
async function attachResolvedPromotionPrices(
  userId: string,
  views: CustomerPromotionView[],
  at: Date,
): Promise<CustomerPromotionView[]> {
  if (!views.length) return views;
  const actor = await loadPricingActor(userId);
  if (!canViewTrade(actor.viewer)) {
    return views.map((view) => ({ ...view, products: [] }));
  }

  const catalogueWide = views.some((view) => view.scope === "catalogue");
  const scopedIds = [
    ...new Set(views.flatMap((view) => (view.scope === "products" ? view.products.map((product) => product.sku) : []))),
  ];
  const variants = await prisma.productVariant.findMany({
    where: catalogueWide
      ? { product: { isActive: true, isTradeVisible: true, status: "ACTIVE" } }
      : { sku: { in: scopedIds }, product: { isActive: true, isTradeVisible: true, status: "ACTIVE" } },
    select: {
      id: true,
      sku: true,
      tradePrice: true,
      vatCode: true,
      caseQty: true,
      minOrderQty: true,
      product: { select: { name: true, slug: true } },
    },
  });
  if (!variants.length) return views.map((view) => ({ ...view, products: [] }));

  const pricing = pricingArgsFromActor(actor);
  const resolved = await resolveVariantTradePrices({
    companyId: pricing.companyId,
    priceListId: pricing.priceListId,
    adminTestActive: pricing.adminTestActive,
    quantity: 1,
    at,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      tradePrice: variant.tradePrice,
      vatCode: variant.vatCode,
    })),
  });

  const byPromotion = new Map<string, CustomerPromotionProduct[]>();
  for (const variant of variants) {
    const resolution = resolved.get(variant.id);
    const appliedId = resolution?.promotionApplied?.id;
    if (!resolution || resolution.source !== "PROMOTION" || !appliedId) continue;
    const commercial = parseMoney(resolution.unitPriceExVat);
    const sell = commercial ? toCustomerSellUnitPrice(commercial) : null;
    const products = byPromotion.get(appliedId) ?? [];
    products.push({
      sku: variant.sku,
      slug: variant.product.slug,
      name: variant.product.name,
      variantId: variant.id,
      quantity: firstOrderableQuantity(Math.max(1, variant.minOrderQty ?? 1), variant.caseQty),
      unitPriceLabel: sell ? `£${moneyToString(sell, 2)}` : null,
    });
    byPromotion.set(appliedId, products);
  }

  return views.map((view) => ({
    ...view,
    products: (byPromotion.get(view.id) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku),
    ),
  }));
}

function toSource(row: {
  id: string;
  code: string;
  name: string;
  type: CustomerPromotionSource["type"];
  value: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  metadata: unknown;
}): CustomerPromotionSource {
  return row;
}

async function loadScopedProducts(metadataRows: unknown[]) {
  const variantIds = new Set<string>();
  const skus = new Set<string>();
  for (const metadata of metadataRows) {
    const scope = customerPromotionScope(metadata);
    if (scope.catalogueWide) continue;
    for (const id of scope.variantIds) variantIds.add(id);
    for (const sku of scope.skus) skus.add(sku);
  }
  if (variantIds.size === 0 && skus.size === 0) return new Map<string, CustomerPromotionProduct & { id: string }>();

  const or = [
    ...(variantIds.size ? [{ id: { in: [...variantIds] } }] : []),
    ...(skus.size ? [{ sku: { in: [...skus] } }] : []),
  ];
  const variants = await prisma.productVariant.findMany({
    where: {
      OR: or,
      product: { isActive: true, isTradeVisible: true, status: "ACTIVE" },
    },
    select: { id: true, sku: true, product: { select: { name: true, slug: true } } },
    orderBy: { sku: "asc" },
  });
  const byKey = new Map<string, CustomerPromotionProduct & { id: string }>();
  for (const variant of variants) {
    const product = {
      id: variant.id,
      sku: variant.sku,
      slug: variant.product.slug,
      name: variant.product.name,
      variantId: variant.id,
      quantity: 1,
      unitPriceLabel: null,
    };
    byKey.set(variant.id, product);
    byKey.set(variant.sku, product);
  }
  return byKey;
}

function productsForScope(
  scope: { variantIds: string[]; skus: string[] },
  productsByKey: Map<string, CustomerPromotionProduct & { id: string }>,
): Array<Pick<CustomerPromotionProduct, "sku" | "slug" | "name" | "variantId">> {
  const seen = new Set<string>();
  const products: Array<Pick<CustomerPromotionProduct, "sku" | "slug" | "name" | "variantId">> = [];
  for (const key of [...scope.variantIds, ...scope.skus]) {
    const product = productsByKey.get(key);
    if (!product || seen.has(product.sku)) continue;
    seen.add(product.sku);
    products.push({
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      variantId: product.variantId,
    });
  }
  products.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  return products;
}
