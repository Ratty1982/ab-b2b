/**
 * Trade portal promotions list.
 * Reads existing Promotion rows. Does not create, activate, or reprice them.
 */
import { prisma } from "@/infra/database/client";
import {
  customerPromotionOfferLabel,
  customerPromotionScope,
  customerPromotionValidityLabel,
  promotionVisibleToCustomer,
  type CustomerPromotionKind,
  type CustomerPromotionSource,
} from "@/domain/customer-promotions";
import { requireTradePortalAccess } from "@/server/rbac/guards";

export type CustomerPromotionProduct = {
  sku: string;
  name: string;
};

export type CustomerPromotionView = {
  id: string;
  code: string;
  name: string;
  type: CustomerPromotionKind;
  offerLabel: string;
  validityLabel: string;
  scope: "catalogue" | "products";
  products: CustomerPromotionProduct[];
};

export async function listCustomerPromotions(userId: string, at: Date = new Date()) {
  await requireTradePortalAccess(userId);
  return loadCustomerPromotionViews(at);
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
    },
  });
  const visible = rows.filter((row) => promotionVisibleToCustomer(toSource(row), at));
  const productsByKey = await loadScopedProducts(visible.map((row) => row.metadata));

  return visible.flatMap((row) => {
    if (row.type === "QUANTITY_DEAL") return [];
    const scope = customerPromotionScope(row.metadata);
    const products = scope.catalogueWide ? [] : productsForScope(scope, productsByKey);
    return [
      {
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        offerLabel: customerPromotionOfferLabel(row.type, row.value),
        validityLabel: customerPromotionValidityLabel(row.startsAt, row.endsAt),
        scope: scope.catalogueWide ? "catalogue" : "products",
        products,
      },
    ];
  });
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
    select: { id: true, sku: true, product: { select: { name: true } } },
    orderBy: { sku: "asc" },
  });
  const byKey = new Map<string, CustomerPromotionProduct & { id: string }>();
  for (const variant of variants) {
    const product = { id: variant.id, sku: variant.sku, name: variant.product.name };
    byKey.set(variant.id, product);
    byKey.set(variant.sku, product);
  }
  return byKey;
}

function productsForScope(
  scope: { variantIds: string[]; skus: string[] },
  productsByKey: Map<string, CustomerPromotionProduct & { id: string }>,
): CustomerPromotionProduct[] {
  const seen = new Set<string>();
  const products: CustomerPromotionProduct[] = [];
  for (const key of [...scope.variantIds, ...scope.skus]) {
    const product = productsByKey.get(key);
    if (!product || seen.has(product.sku)) continue;
    seen.add(product.sku);
    products.push({ sku: product.sku, name: product.name });
  }
  products.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  return products;
}
