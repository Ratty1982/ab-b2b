/**
 * Shared Sales Intelligence helpers.
 *
 * The global 561L invoice dashboard, search, and CSV export are retired.
 * Ongoing customer and product sales are read from unified-sales.ts.
 * This module must not query the retired invoice-line table or return a zero
 * sales total in place of that history.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import { loadIntelligenceByMatchKeys } from "@/server/stock/autopart-products";

const ADMIN_SHELL_PERMISSIONS = [
  "admin.access",
  "cms.view",
  "cms.edit",
  "cms.publish",
  "cms.page.read",
  "cms.page.edit",
  "cms.page.publish",
  "cms.media.read",
  "cms.media.manage",
  "products.create",
  "products.edit",
  "pricing.edit",
  "users.manage",
  "roles.manage",
  "settings.edit",
] as const;

export type ProductAggregate = {
  partNumber: string;
  description: string | null;
  lines: number;
  qty: Prisma.Decimal;
  grossSales: Prisma.Decimal;
  credits: Prisma.Decimal;
  netSales: Prisma.Decimal;
};

export function decimalString(value: unknown, places: number): string {
  if (
    value != null &&
    typeof value === "object" &&
    "toFixed" in value &&
    typeof value.toFixed === "function"
  ) {
    return value.toFixed(places);
  }
  return new Prisma.Decimal(value == null || value === "" ? 0 : String(value)).toFixed(places);
}

export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function csvSafe(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function canOpenAdmin(profile: LoadedAccessProfile): boolean {
  return ADMIN_SHELL_PERMISSIONS.some((key) => hasPermission(profile, key));
}

export function customer360Href(profile: LoadedAccessProfile, companyId: string): string {
  return canOpenAdmin(profile) ? `/admin/customers/${companyId}` : `/sales/customers/${companyId}`;
}

export function productWorkspaceHref(
  profile: LoadedAccessProfile,
  productId: string | null,
  sku: string,
  inCatalogue: boolean,
): string | null {
  if (!inCatalogue) return null;
  if (canOpenAdmin(profile) && productId) return `/admin/products/${productId}`;
  return `/products/${encodeURIComponent(sku)}`;
}

export async function requireSalesIntelligence(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.enquiry.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

export async function loadScope(profile: LoadedAccessProfile) {
  return resolveSalesIntelligenceCompanyScope(profile);
}

export async function assertCompanyInScope(profile: LoadedAccessProfile, companyId: string) {
  const scope = await loadScope(profile);
  if (scope !== "all" && !scope.includes(companyId)) {
    throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      accountNumber: true,
      autopartCustomerCode: true,
      assignments: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: {
          salesRep: {
            select: {
              id: true,
              code: true,
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  return { scope, company };
}

function priceCurrent(row: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (row.startsAt && row.startsAt > now) return false;
  if (row.endsAt && row.endsAt < now) return false;
  return true;
}

export async function enrichProducts(
  profile: LoadedAccessProfile,
  rows: ProductAggregate[],
  companyId: string | null,
) {
  const canPrice = hasPermission(profile, "pricing.view");
  const canStock = hasPermission(profile, "inventory.view");
  const skus = rows.map((row) => row.partNumber);
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: { OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
        select: {
          id: true,
          sku: true,
          productId: true,
          tradePrice: true,
          product: {
            select: {
              name: true,
              status: true,
              isActive: true,
              brand: { select: { name: true } },
              category: { select: { name: true } },
            },
          },
        },
      })
    : [];
  const variantBySku = new Map(variants.map((variant) => [variant.sku.trim().toUpperCase(), variant]));
  const prices =
    canPrice && companyId && variants.length
      ? await prisma.customerPrice.findMany({
          where: { companyId, variantId: { in: variants.map((variant) => variant.id) } },
          select: { variantId: true, unitPrice: true, startsAt: true, endsAt: true },
        })
      : [];
  const now = new Date();
  const priceByVariant = new Map(
    prices.filter((price) => priceCurrent(price, now)).map((price) => [price.variantId, price.unitPrice]),
  );
  const stock = canStock ? await loadIntelligenceByMatchKeys(skus) : null;
  return rows.map((row) => {
    const key = row.partNumber.trim().toUpperCase();
    const variant = variantBySku.get(key);
    const inCatalogue = Boolean(variant?.product && variant.product.status === "ACTIVE" && variant.product.isActive);
    const info = stock?.get(key);
    const customerPrice = variant ? priceByVariant.get(variant.id) : undefined;
    return {
      sku: variant?.sku ?? row.partNumber,
      description: variant?.product?.name ?? row.description ?? row.partNumber,
      sourceDescription: row.description,
      lines: Number(row.lines),
      units: decimalString(row.qty, 3),
      grossSales: decimalString(row.grossSales, 2),
      credits: decimalString(row.credits, 2),
      netSales: decimalString(row.netSales, 2),
      inCatalogue,
      catalogueStatus: inCatalogue ? "In catalogue" : "Not in the current catalogue",
      productId: variant?.productId ?? null,
      productHref: productWorkspaceHref(profile, variant?.productId ?? null, variant?.sku ?? row.partNumber, inCatalogue),
      brandName: variant?.product?.brand?.name ?? null,
      categoryName: variant?.product?.category?.name ?? null,
      tradePrice: canPrice && variant?.tradePrice != null ? decimalString(variant.tradePrice, 2) : null,
      customerPrice: canPrice && customerPrice != null ? decimalString(customerPrice, 2) : null,
      studleyAvailableQty: canStock ? (info?.availQty ?? null) : null,
      studleyIncomingQty: canStock ? (info?.incomingQty ?? null) : null,
      studleyAvailability: canStock ? (info?.availLine ?? null) : null,
    };
  });
}
