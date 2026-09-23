import { prisma } from "@/infra/database/client";
import { loadAccessProfile } from "@/server/rbac/access";
import { viewerFromAccess, type PriceViewer } from "@/server/pricing/trade-price";
import { inValidityWindow, resolveTradePriceFromFacts, type PriceResolutionFacts } from "@/domain/trade-price-resolution";

export type PricingActor = {
  viewer: PriceViewer;
  /** Real trade company (membership). Null for anonymous, internal base, and admin test. */
  companyId: string | null;
  /**
   * INTERNAL admin Trade Test Level — a real PriceList id from the user's
   * persisted setting. Never accepted from the browser on price/basket calls.
   */
  adminTestPriceListId: string | null;
};

export async function loadPricingActor(userId: string | null): Promise<PricingActor> {
  if (!userId) {
    return { viewer: { kind: "anonymous" }, companyId: null, adminTestPriceListId: null };
  }
  const profile = await loadAccessProfile(userId);
  if (!profile) {
    return { viewer: { kind: "anonymous" }, companyId: null, adminTestPriceListId: null };
  }
  const viewer = viewerFromAccess({
    signedIn: true,
    actorType: profile.actorType,
    permissions: profile.permissions,
  });

  if (profile.actorType === "INTERNAL") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tradeTestPriceListId: true },
    });
    return {
      viewer,
      companyId: null,
      adminTestPriceListId: user?.tradeTestPriceListId ?? null,
    };
  }

  const membership =
    profile.companyMemberships.find((m) => m.isDefault) ?? profile.companyMemberships[0];
  return {
    viewer,
    companyId: membership?.companyId ?? null,
    adminTestPriceListId: null,
  };
}

function promoScope(metadata: unknown): { variantIds: string[] | null; skus: string[] | null } {
  if (!metadata || typeof metadata !== "object") return { variantIds: null, skus: null };
  const rec = metadata as Record<string, unknown>;
  const variantIds = Array.isArray(rec["variantIds"])
    ? rec["variantIds"].filter((id): id is string => typeof id === "string")
    : null;
  const skus = Array.isArray(rec["skus"]) ? rec["skus"].filter((id): id is string => typeof id === "string") : null;
  return {
    variantIds: variantIds && variantIds.length ? variantIds : null,
    skus: skus && skus.length ? skus : null,
  };
}

export type VariantPriceInput = {
  id: string;
  sku: string;
  tradePrice: unknown;
  vatCode: string | null;
};

/**
 * One company lookup + one item/break/customer/promotion query set for the whole page.
 *
 * Admin test mode: pass `priceListId` without `companyId`. That loads PriceListItem
 * rows only — never CustomerPrice (which is company-scoped).
 */
export async function loadTradePriceFactsForVariants(input: {
  variants: VariantPriceInput[];
  companyId: string | null;
  /** Explicit PriceList for admin trade-test context (no company). */
  priceListId?: string | null;
  quantity?: number;
  at?: Date;
}): Promise<Map<string, PriceResolutionFacts>> {
  const at = input.at ?? new Date();
  const quantity = input.quantity ?? 1;
  const variants = input.variants;
  const ids = variants.map((v) => v.id);
  const empty = new Map<string, PriceResolutionFacts>();
  if (!ids.length) return empty;

  const company = input.companyId
    ? await prisma.company.findUnique({
        where: { id: input.companyId },
        select: {
          id: true,
          taxStatus: true,
          priceListId: true,
          priceList: { select: { id: true, name: true } },
        },
      })
    : null;

  // Company list wins when a real company context exists. Admin test list only
  // applies when there is no company (never blend with CustomerPrice).
  const effectivePriceListId = company?.priceListId ?? input.priceListId ?? null;

  const adminTestList =
    !company && input.priceListId
      ? await prisma.priceList.findUnique({
          where: { id: input.priceListId },
          select: { id: true, name: true },
        })
      : null;

  const [listItems, customerPrices, quantityBreaks, promotions] = await Promise.all([
    effectivePriceListId
      ? prisma.priceListItem.findMany({
          where: { priceListId: effectivePriceListId, variantId: { in: ids } },
          select: {
            id: true,
            variantId: true,
            unitPrice: true,
            priceListId: true,
            priceList: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // CustomerPrice is company-scoped — never load for admin test context.
    company
      ? prisma.customerPrice.findMany({
          where: { companyId: company.id, variantId: { in: ids } },
        })
      : Promise.resolve([]),
    prisma.quantityBreak.findMany({
      where: { variantId: { in: ids } },
      select: { id: true, variantId: true, minQty: true, unitPrice: true },
    }),
    prisma.promotion.findMany({
      where: { isActive: true },
    }),
  ]);

  const listByVariant = new Map(listItems.map((row) => [row.variantId, row]));
  const customerByVariant = new Map(
    customerPrices
      .filter((row) => inValidityWindow(at, row.startsAt, row.endsAt))
      .map((row) => [row.variantId, row]),
  );
  const breaksByVariant = new Map<string, typeof quantityBreaks>();
  for (const row of quantityBreaks) {
    const list = breaksByVariant.get(row.variantId) ?? [];
    list.push(row);
    breaksByVariant.set(row.variantId, list);
  }

  const promoFacts = promotions.map((p) => {
    const scope = promoScope(p.metadata);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type as "PERCENT" | "FIXED" | "QUANTITY_DEAL",
      value: p.value,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      isActive: p.isActive,
      variantIds: scope.variantIds,
      skus: scope.skus,
    };
  });

  const out = new Map<string, PriceResolutionFacts>();
  for (const variant of variants) {
    const list = listByVariant.get(variant.id);
    const customer = customerByVariant.get(variant.id);
    out.set(variant.id, {
      variantId: variant.id,
      sku: variant.sku,
      baseTradePrice: variant.tradePrice,
      vatCode: variant.vatCode,
      quantity,
      at,
      company: company
        ? {
            id: company.id,
            taxStatus: company.taxStatus,
            priceListId: company.priceListId,
            priceListName: company.priceList?.name ?? null,
          }
        : adminTestList
          ? {
              // Synthetic STANDARD tax — never inherits a real customer's exemption.
              id: `admin-test:${adminTestList.id}`,
              taxStatus: "STANDARD",
              priceListId: adminTestList.id,
              priceListName: adminTestList.name,
            }
          : null,
      customerPrice: customer
        ? {
            id: customer.id,
            unitPrice: customer.unitPrice,
            startsAt: customer.startsAt,
            endsAt: customer.endsAt,
          }
        : null,
      priceListItem: list
        ? {
            id: list.id,
            unitPrice: list.unitPrice,
            priceListId: list.priceListId,
            priceListName: list.priceList.name,
          }
        : null,
      quantityBreaks: (breaksByVariant.get(variant.id) ?? []).map((row) => ({
        id: row.id,
        minQty: row.minQty,
        unitPrice: row.unitPrice,
      })),
      promotions: promoFacts,
    });
  }
  return out;
}

export async function resolveVariantTradePrices(input: {
  variants: VariantPriceInput[];
  companyId: string | null;
  priceListId?: string | null;
  quantity?: number;
  at?: Date;
}) {
  const facts = await loadTradePriceFactsForVariants(input);
  return new Map(
    [...facts.entries()].map(([id, row]) => [id, resolveTradePriceFromFacts(row)] as const),
  );
}

/** Helper for callers that already have a PricingActor. */
export function pricingArgsFromActor(actor: PricingActor): {
  companyId: string | null;
  priceListId: string | null;
} {
  return {
    companyId: actor.companyId,
    priceListId: actor.adminTestPriceListId,
  };
}
