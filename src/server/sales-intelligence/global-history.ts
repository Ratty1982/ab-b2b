/**
 * All Historical Autopart Sales.
 *
 * Reads global AutopartInvoiceLine rows only, and only through an explicit
 * AutopartAccount.companyId link. Dated AutopartSalesLine / AutopartSalesDocument
 * totals, 504 / TRM21QC feeds, and ledger balances are not added in.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { resolveSalesIntelligenceCompanyScope } from "@/server/sales-intelligence/scope";
import { buildCsv } from "@/domain/sales-intelligence";
import { loadIntelligenceByMatchKeys } from "@/server/stock/autopart-products";
import {
  GLOBAL_AUTOPART_SALES_PERIOD,
  GLOBAL_AUTOPART_SALES_SOURCE,
  HISTORY_OVERLAP_NOTE,
} from "@/server/sales-intelligence/history-sources";

const AUTOPART_SOURCE = "AUTOPART";
const EXPORT_PAGE_CAP = 40;

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

const filterSchema = z.object({
  companyId: z.string().min(1).optional().nullable(),
  customerGroupId: z.string().min(1).optional().nullable(),
  salesRepId: z.string().min(1).optional().nullable(),
  accountCode: z.string().max(40).optional().nullable(),
  q: z.string().max(200).optional().nullable(),
  sku: z.string().max(120).optional().nullable(),
  brandId: z.string().min(1).optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sort: z.enum(["NET_SALES", "QTY", "LINES", "NAME_AZ"]).optional(),
});

type Filters = {
  companyId: string | null;
  customerGroupId: string | null;
  salesRepId: string | null;
  accountCode: string | null;
  q: string | null;
  sku: string | null;
  brandId: string | null;
  page: number;
  pageSize: number;
  sort: "NET_SALES" | "QTY" | "LINES" | "NAME_AZ";
};

type AccountLookup =
  | { state: "unknown"; accountCode: string }
  | { state: "unlinked"; accountCode: string }
  | { state: "restricted"; accountCode: string }
  | {
      state: "linked";
      accountCode: string;
      companyId: string;
      companyName: string;
      companyStatus: string;
    };

export type GlobalSalesSummary = {
  netSales: string;
  grossSales: string;
  credits: string;
  lineCount: number;
  invoiceCount: number;
  productCount: number;
  units: string;
  customersRepresented: number;
  customersWithoutLinkedHistory: number;
};

function cleanFilters(raw: z.infer<typeof filterSchema>): Filters {
  return {
    companyId: raw.companyId?.trim() || null,
    customerGroupId: raw.customerGroupId?.trim() || null,
    salesRepId: raw.salesRepId?.trim() || null,
    accountCode: raw.accountCode?.trim() || null,
    q: raw.q?.trim() || null,
    sku: raw.sku?.trim() || null,
    brandId: raw.brandId?.trim() || null,
    page: raw.page ?? 1,
    pageSize: raw.pageSize ?? 25,
    sort: raw.sort ?? "NET_SALES",
  };
}

function decimalString(value: unknown, places: number): string {
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

function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function sqlAnd(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

function scopedIds(scope: string[] | "all", column: Prisma.Sql): Prisma.Sql {
  if (scope === "all") return Prisma.sql`TRUE`;
  if (scope.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} IN (${Prisma.join(scope)})`;
}

function brandExists(brandId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "ProductVariant" v
    INNER JOIN "Product" p ON p.id = v."productId"
    WHERE p."brandId" = ${brandId}
      AND UPPER(TRIM(v.sku)) = UPPER(TRIM(l."partNumber"))
  )`;
}

function lineFilters(input: Filters, scope: string[] | "all"): Prisma.Sql {
  const parts: Prisma.Sql[] = [scopedIds(scope, Prisma.sql`a."companyId"`)];
  if (input.companyId) parts.push(Prisma.sql`a."companyId" = ${input.companyId}`);
  if (input.customerGroupId) parts.push(Prisma.sql`c."customerGroupId" = ${input.customerGroupId}`);
  if (input.salesRepId) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "CompanyAssignment" ca
      WHERE ca."companyId" = a."companyId" AND ca."salesRepId" = ${input.salesRepId}
    )`);
  }
  if (input.accountCode) parts.push(Prisma.sql`a."accountCode" = ${input.accountCode}`);
  if (input.brandId) parts.push(brandExists(input.brandId));
  if (input.sku) {
    parts.push(Prisma.sql`UPPER(TRIM(l."partNumber")) = UPPER(TRIM(${input.sku}))`);
  }
  if (input.q && !input.sku) {
    const pattern = likeContains(input.q);
    parts.push(Prisma.sql`(
      l."partNumber" ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(l."description", '') ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  if (input.q && input.sku) {
    const pattern = likeContains(input.q);
    parts.push(Prisma.sql`(
      c."name" ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(c."tradingName", '') ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  return sqlAnd(parts);
}

function companyFilters(input: Filters, scope: string[] | "all"): Prisma.Sql {
  const parts: Prisma.Sql[] = [scopedIds(scope, Prisma.sql`c.id`)];
  if (input.companyId) parts.push(Prisma.sql`c.id = ${input.companyId}`);
  if (input.customerGroupId) parts.push(Prisma.sql`c."customerGroupId" = ${input.customerGroupId}`);
  if (input.salesRepId) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "CompanyAssignment" ca
      WHERE ca."companyId" = c.id AND ca."salesRepId" = ${input.salesRepId}
    )`);
  }
  if (input.accountCode) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "AutopartAccount" linked
      WHERE linked."companyId" = c.id
        AND linked."sourceSystem" = ${AUTOPART_SOURCE}
        AND linked."accountCode" = ${input.accountCode}
    )`);
  }
  if (input.q && input.sku) {
    const pattern = likeContains(input.q);
    parts.push(Prisma.sql`(
      c."name" ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(c."tradingName", '') ILIKE ${pattern} ESCAPE '\\'
    )`);
  }
  return sqlAnd(parts);
}

function invoiceFrom(filters: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM "AutopartInvoiceLine" l
    INNER JOIN "AutopartAccount" a
      ON a."accountCode" = l."accountCode"
     AND a."sourceSystem" = ${AUTOPART_SOURCE}
     AND a."companyId" IS NOT NULL
    INNER JOIN "Company" c ON c.id = a."companyId"
    WHERE l."salesMeasure" = 'NET_EX_VAT'
      AND ${filters}
  `;
}

function productOrder(sort: Filters["sort"]): Prisma.Sql {
  switch (sort) {
    case "QTY":
      return Prisma.sql`qty DESC, "partNumber" ASC`;
    case "LINES":
      return Prisma.sql`lines DESC, "partNumber" ASC`;
    case "NAME_AZ":
      return Prisma.sql`"partNumber" ASC`;
    default:
      return Prisma.sql`"netSales" DESC, "partNumber" ASC`;
  }
}

function customerOrder(sort: Filters["sort"]): Prisma.Sql {
  switch (sort) {
    case "QTY":
      return Prisma.sql`qty DESC, "companyName" ASC`;
    case "LINES":
      return Prisma.sql`lines DESC, "companyName" ASC`;
    case "NAME_AZ":
      return Prisma.sql`"companyName" ASC`;
    default:
      return Prisma.sql`"netSales" DESC, "companyName" ASC`;
  }
}

function csvSafe(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function canOpenAdmin(profile: LoadedAccessProfile): boolean {
  return ADMIN_SHELL_PERMISSIONS.some((key) => hasPermission(profile, key));
}

function customer360Href(profile: LoadedAccessProfile, companyId: string): string {
  return canOpenAdmin(profile) ? `/admin/customers/${companyId}` : `/sales/customers/${companyId}`;
}

function productWorkspaceHref(
  profile: LoadedAccessProfile,
  productId: string | null,
  sku: string,
  inCatalogue: boolean,
): string | null {
  if (!inCatalogue) return null;
  if (canOpenAdmin(profile) && productId) return `/admin/products/${productId}`;
  return `/products/${encodeURIComponent(sku)}`;
}

async function requireSalesIntelligence(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(actorUserId, "sales_intelligence.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Sales Intelligence is internal only", "FORBIDDEN", 403);
  }
  return profile;
}

async function loadScope(profile: LoadedAccessProfile) {
  return resolveSalesIntelligenceCompanyScope(profile);
}

async function assertCompanyInScope(profile: LoadedAccessProfile, companyId: string) {
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

async function describeAccountCode(
  code: string | null,
  scope: string[] | "all",
): Promise<AccountLookup | null> {
  if (!code) return null;
  const account = await prisma.autopartAccount.findUnique({
    where: { sourceSystem_accountCode: { sourceSystem: AUTOPART_SOURCE, accountCode: code } },
    select: {
      accountCode: true,
      companyId: true,
      company: { select: { id: true, name: true, status: true } },
    },
  });
  if (!account) return { state: "unknown", accountCode: code };
  if (!account.companyId || !account.company) return { state: "unlinked", accountCode: code };
  if (scope !== "all" && !scope.includes(account.companyId)) {
    return { state: "restricted", accountCode: code };
  }
  return {
    state: "linked",
    accountCode: code,
    companyId: account.company.id,
    companyName: account.company.name,
    companyStatus: account.company.status,
  };
}

async function summarize(filters: Prisma.Sql, companyLevel: Prisma.Sql): Promise<GlobalSalesSummary> {
  const from = invoiceFrom(filters);
  const [metrics, invoices, missing] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        netSales: Prisma.Decimal;
        grossSales: Prisma.Decimal;
        credits: Prisma.Decimal;
        lineCount: number;
        productCount: number;
        units: Prisma.Decimal;
        customers: number;
      }>
    >`
      SELECT
        COALESCE(SUM(l."salesAmount"), 0) AS "netSales",
        COALESCE(SUM(CASE WHEN l."salesAmount" > 0 THEN l."salesAmount" ELSE 0 END), 0) AS "grossSales",
        COALESCE(SUM(CASE WHEN l."salesAmount" < 0 THEN l."salesAmount" ELSE 0 END), 0) AS "credits",
        COUNT(*)::int AS "lineCount",
        COUNT(DISTINCT UPPER(TRIM(l."partNumber")))::int AS "productCount",
        COALESCE(SUM(l."quantity"), 0) AS "units",
        COUNT(DISTINCT a."companyId")::int AS "customers"
      ${from}
    `,
    prisma.$queryRaw<Array<{ invoices: number }>>`
      SELECT COUNT(*)::int AS invoices
      FROM (
        SELECT 1
        ${from}
          AND l."documentReference" IS NOT NULL
          AND btrim(l."documentReference") <> ''
        GROUP BY a."accountCode", COALESCE(l."documentType", ''), l."documentReference"
      ) docs
    `,
    prisma.$queryRaw<Array<{ missing: number }>>`
      SELECT COUNT(*)::int AS missing
      FROM "Company" c
      WHERE ${companyLevel}
        AND NOT EXISTS (
          SELECT 1
          FROM "AutopartAccount" a
          INNER JOIN "AutopartInvoiceLine" l
            ON l."accountCode" = a."accountCode"
           AND l."salesMeasure" = 'NET_EX_VAT'
          WHERE a."companyId" = c.id
            AND a."sourceSystem" = ${AUTOPART_SOURCE}
        )
    `,
  ]);
  const row = metrics[0];
  return {
    netSales: decimalString(row?.netSales, 2),
    grossSales: decimalString(row?.grossSales, 2),
    credits: decimalString(row?.credits, 2),
    lineCount: Number(row?.lineCount ?? 0),
    invoiceCount: Number(invoices[0]?.invoices ?? 0),
    productCount: Number(row?.productCount ?? 0),
    units: decimalString(row?.units, 3),
    customersRepresented: Number(row?.customers ?? 0),
    customersWithoutLinkedHistory: Number(missing[0]?.missing ?? 0),
  };
}

const provenance = {
  source: GLOBAL_AUTOPART_SALES_SOURCE,
  overlapNote: HISTORY_OVERLAP_NOTE,
  period: GLOBAL_AUTOPART_SALES_PERIOD,
};

export async function getGlobalAutopartSalesDashboard(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = cleanFilters(filterSchema.parse(raw ?? {}));
  const scope = input.companyId
    ? (await assertCompanyInScope(profile, input.companyId)).scope
    : await loadScope(profile);
  const [summary, account, brands] = await Promise.all([
    summarize(lineFilters(input, scope), companyFilters(input, scope)),
    describeAccountCode(input.accountCode, scope),
    prisma.brand.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  return {
    ...provenance,
    summary,
    account,
    brands,
    pricingPermitted: hasPermission(profile, "pricing.view"),
    studleyStockPermitted: hasPermission(profile, "inventory.view"),
  };
}

type ProductAggregate = {
  partNumber: string;
  description: string | null;
  lines: number;
  qty: Prisma.Decimal;
  grossSales: Prisma.Decimal;
  credits: Prisma.Decimal;
  netSales: Prisma.Decimal;
};

async function queryProducts(filters: Prisma.Sql, input: Filters) {
  const from = invoiceFrom(filters);
  const offset = (input.page - 1) * input.pageSize;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<ProductAggregate[]>`
      SELECT *
      FROM (
        SELECT
          MIN(l."partNumber") AS "partNumber",
          MAX(l."description") AS description,
          COUNT(*)::int AS lines,
          COALESCE(SUM(l."quantity"), 0) AS qty,
          COALESCE(SUM(CASE WHEN l."salesAmount" > 0 THEN l."salesAmount" ELSE 0 END), 0) AS "grossSales",
          COALESCE(SUM(CASE WHEN l."salesAmount" < 0 THEN l."salesAmount" ELSE 0 END), 0) AS credits,
          COALESCE(SUM(l."salesAmount"), 0) AS "netSales"
        ${from}
        GROUP BY UPPER(TRIM(l."partNumber"))
      ) products
      ORDER BY ${productOrder(input.sort)}
      LIMIT ${input.pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT 1
        ${from}
        GROUP BY UPPER(TRIM(l."partNumber"))
      ) products
    `,
  ]);
  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

function priceCurrent(row: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (row.startsAt && row.startsAt > now) return false;
  if (row.endsAt && row.endsAt < now) return false;
  return true;
}

async function enrichProducts(
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

async function crossSell(companyId: string, profile: LoadedAccessProfile) {
  const rows = await prisma.$queryRaw<
    Array<{ sku: string; name: string; productId: string; brandName: string }>
  >`
    WITH purchased AS (
      SELECT DISTINCT UPPER(TRIM(l."partNumber")) AS key
      FROM "AutopartInvoiceLine" l
      INNER JOIN "AutopartAccount" a
        ON a."accountCode" = l."accountCode"
       AND a."sourceSystem" = ${AUTOPART_SOURCE}
       AND a."companyId" = ${companyId}
      WHERE l."salesMeasure" = 'NET_EX_VAT'
    )
    SELECT v.sku AS sku, p.name AS name, p.id AS "productId", b.name AS "brandName"
    FROM "ProductVariant" v
    INNER JOIN "Product" p ON p.id = v."productId"
    INNER JOIN "Brand" b ON b.id = p."brandId"
    WHERE p.status::text = 'ACTIVE'
      AND p."isActive" = true
      AND v."isActive" = true
      AND p."categoryId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM purchased pu
        INNER JOIN "ProductVariant" sv ON UPPER(TRIM(sv.sku)) = pu.key
        INNER JOIN "Product" sp ON sp.id = sv."productId"
        WHERE sp."brandId" = p."brandId"
          AND sp."categoryId" = p."categoryId"
          AND sp."categoryId" IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM purchased pu WHERE pu.key = UPPER(TRIM(v.sku))
      )
    ORDER BY v.sku ASC
    LIMIT 8
  `;
  return {
    note: "Same brand and category in the current catalogue. Stored related-SKU lists are not used. Undated 561L history does not show that a customer has stopped buying a product.",
    items: rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      productId: row.productId,
      brandName: row.brandName,
      productHref: productWorkspaceHref(profile, row.productId, row.sku, true),
    })),
  };
}

export async function getGlobalCustomerSalesEnquiry(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = cleanFilters(filterSchema.parse(raw ?? {}));
  if (!input.companyId) throw new AuthError("Choose a customer", "VALIDATION", 400);
  const { scope, company } = await assertCompanyInScope(profile, input.companyId);
  const filters = lineFilters(input, scope);
  const [summary, products, accounts, top] = await Promise.all([
    summarize(filters, companyFilters(input, scope)),
    queryProducts(filters, input),
    prisma.autopartAccount.findMany({
      where: { companyId: company.id, sourceSystem: AUTOPART_SOURCE },
      select: { accountCode: true },
      orderBy: { accountCode: "asc" },
    }),
    queryProducts(filters, { ...input, page: 1, pageSize: 10, sort: "NET_SALES" }),
  ]);
  const { recordStaffWorkspaceOpen } = await import("@/server/audit/staff-workspace-open");
  void recordStaffWorkspaceOpen({
    actorUserId: profile.userId,
    action: "si.global_history.opened",
    detail: "Opened all historical Autopart sales",
  });
  const rep = company.assignments[0]?.salesRep;
  const items = await enrichProducts(profile, products.rows, company.id);
  const topItems = await enrichProducts(profile, top.rows, company.id);
  return {
    ...provenance,
    company: {
      id: company.id,
      name: company.name,
      tradingName: company.tradingName,
      status: company.status,
      accountNumber: company.accountNumber,
      autopartCustomerCode: company.autopartCustomerCode,
      customer360Href: customer360Href(profile, company.id),
      linkedAccountCodes: accounts.map((account) => account.accountCode),
      salesperson: rep
        ? {
            id: rep.id,
            code: rep.code,
            name: rep.displayName || rep.user.name || rep.user.email,
          }
        : null,
    },
    summary,
    products: { items, page: input.page, pageSize: input.pageSize, total: products.total },
    topProducts: topItems,
    purchasedSkus: topItems.map((item) => item.sku),
    crossSell: await crossSell(company.id, profile),
    pricingPermitted: hasPermission(profile, "pricing.view"),
    studleyStockPermitted: hasPermission(profile, "inventory.view"),
  };
}

type CustomerAggregate = {
  companyId: string;
  companyName: string;
  status: string;
  autopartCustomerCode: string | null;
  repCode: string | null;
  salespersonName: string | null;
  lines: number;
  qty: Prisma.Decimal;
  grossSales: Prisma.Decimal;
  credits: Prisma.Decimal;
  netSales: Prisma.Decimal;
};

async function queryCustomers(filters: Prisma.Sql, input: Filters) {
  const offset = (input.page - 1) * input.pageSize;
  const from = invoiceFrom(filters);
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<CustomerAggregate[]>`
      SELECT *
      FROM (
        SELECT
          c.id AS "companyId",
          c.name AS "companyName",
          c.status::text AS status,
          c."autopartCustomerCode" AS "autopartCustomerCode",
          rep.code AS "repCode",
          rep."salespersonName" AS "salespersonName",
          COUNT(*)::int AS lines,
          COALESCE(SUM(l."quantity"), 0) AS qty,
          COALESCE(SUM(CASE WHEN l."salesAmount" > 0 THEN l."salesAmount" ELSE 0 END), 0) AS "grossSales",
          COALESCE(SUM(CASE WHEN l."salesAmount" < 0 THEN l."salesAmount" ELSE 0 END), 0) AS credits,
          COALESCE(SUM(l."salesAmount"), 0) AS "netSales"
        FROM "AutopartInvoiceLine" l
        INNER JOIN "AutopartAccount" a
          ON a."accountCode" = l."accountCode"
         AND a."sourceSystem" = ${AUTOPART_SOURCE}
         AND a."companyId" IS NOT NULL
        INNER JOIN "Company" c ON c.id = a."companyId"
        LEFT JOIN LATERAL (
          SELECT sr.code AS code,
                 COALESCE(NULLIF(sr."displayName", ''), u.name, u.email) AS "salespersonName"
          FROM "CompanyAssignment" ca
          INNER JOIN "SalesRep" sr ON sr.id = ca."salesRepId"
          INNER JOIN "User" u ON u.id = sr."userId"
          WHERE ca."companyId" = c.id
          ORDER BY ca."isPrimary" DESC, ca."createdAt" ASC
          LIMIT 1
        ) rep ON TRUE
        WHERE l."salesMeasure" = 'NET_EX_VAT'
          AND ${filters}
        GROUP BY c.id, c.name, c.status, c."autopartCustomerCode", rep.code, rep."salespersonName"
      ) customers
      ORDER BY ${customerOrder(input.sort)}
      LIMIT ${input.pageSize} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT c.id
        ${from}
        GROUP BY c.id
      ) customers
    `,
  ]);
  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

export async function getGlobalProductSalesEnquiry(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = cleanFilters(filterSchema.parse(raw ?? {}));
  if (!input.sku) throw new AuthError("Choose a product", "VALIDATION", 400);
  const scope = await loadScope(profile);
  const filters = lineFilters(input, scope);
  const [summary, customers, variant] = await Promise.all([
    summarize(filters, companyFilters(input, scope)),
    queryCustomers(filters, input),
    prisma.productVariant.findFirst({
      where: { sku: { equals: input.sku, mode: "insensitive" } },
      select: {
        id: true,
        sku: true,
        productId: true,
        product: {
          select: {
            name: true,
            status: true,
            isActive: true,
            brand: { select: { name: true } },
          },
        },
      },
    }),
  ]);
  const inCatalogue = Boolean(
    variant?.product && variant.product.status === "ACTIVE" && variant.product.isActive,
  );
  return {
    ...provenance,
    product: {
      sku: variant?.sku ?? input.sku,
      name: variant?.product?.name ?? input.sku,
      inCatalogue,
      catalogueStatus: inCatalogue ? "In catalogue" : "Not in the current catalogue",
      productId: variant?.productId ?? null,
      productHref: productWorkspaceHref(profile, variant?.productId ?? null, variant?.sku ?? input.sku, inCatalogue),
      brandName: variant?.product?.brand?.name ?? null,
    },
    summary,
    customers: {
      items: customers.rows.map((row) => ({
        companyId: row.companyId,
        name: row.companyName,
        status: row.status,
        autopartCustomerCode: row.autopartCustomerCode,
        salespersonName: row.salespersonName,
        salespersonCode: row.repCode,
        lines: Number(row.lines),
        units: decimalString(row.qty, 3),
        grossSales: decimalString(row.grossSales, 2),
        credits: decimalString(row.credits, 2),
        netSales: decimalString(row.netSales, 2),
        customer360Href: customer360Href(profile, row.companyId),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total: customers.total,
    },
    scopeNote:
      "Totals and customers include only CRM companies in your sales scope. Unlinked Autopart accounts are omitted.",
  };
}

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function searchGlobalAutopartSales(actorUserId: string, raw: unknown) {
  const profile = await requireSalesIntelligence(actorUserId);
  const input = searchSchema.parse(raw ?? {});
  const q = input.q?.trim() ?? "";
  const limit = input.limit ?? 15;
  if (q.length < 1) {
    return { companies: [], products: [], account: null };
  }
  const scope = await loadScope(profile);
  const pattern = likeContains(q);
  const companyScope = scopedIds(scope, Prisma.sql`c.id`);
  const lineScope = scopedIds(scope, Prisma.sql`a."companyId"`);
  const [companies, historicProducts, catalogue, account] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        tradingName: string | null;
        accountNumber: string | null;
        autopartCustomerCode: string | null;
        status: string;
        accountCodes: string | null;
        salespersonName: string | null;
      }>
    >`
      SELECT
        c.id,
        c.name,
        c."tradingName" AS "tradingName",
        c."accountNumber" AS "accountNumber",
        c."autopartCustomerCode" AS "autopartCustomerCode",
        c.status::text AS status,
        (
          SELECT string_agg(a."accountCode", ', ' ORDER BY a."accountCode")
          FROM "AutopartAccount" a
          WHERE a."companyId" = c.id AND a."sourceSystem" = ${AUTOPART_SOURCE}
        ) AS "accountCodes",
        (
          SELECT COALESCE(NULLIF(sr."displayName", ''), u.name, u.email)
          FROM "CompanyAssignment" ca
          INNER JOIN "SalesRep" sr ON sr.id = ca."salesRepId"
          INNER JOIN "User" u ON u.id = sr."userId"
          WHERE ca."companyId" = c.id
          ORDER BY ca."isPrimary" DESC, ca."createdAt" ASC
          LIMIT 1
        ) AS "salespersonName"
      FROM "Company" c
      WHERE ${companyScope}
        AND (
          c.name ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(c."tradingName", '') ILIKE ${pattern} ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM "AutopartAccount" a
            WHERE a."companyId" = c.id
              AND a."sourceSystem" = ${AUTOPART_SOURCE}
              AND (
                a."accountCode" = ${q}
                OR a."originalName" ILIKE ${pattern} ESCAPE '\\'
              )
          )
        )
      ORDER BY c.name ASC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<Array<{ partNumber: string; description: string | null }>>`
      SELECT DISTINCT ON (UPPER(TRIM(l."partNumber")))
        l."partNumber" AS "partNumber",
        l."description" AS description
      FROM "AutopartInvoiceLine" l
      INNER JOIN "AutopartAccount" a
        ON a."accountCode" = l."accountCode"
       AND a."sourceSystem" = ${AUTOPART_SOURCE}
       AND a."companyId" IS NOT NULL
      WHERE ${lineScope}
        AND (
          l."partNumber" ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(l."description", '') ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY UPPER(TRIM(l."partNumber")), l."partNumber"
      LIMIT ${limit}
    `,
    prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { product: { name: { contains: q, mode: "insensitive" } } },
          { product: { brand: { name: { contains: q, mode: "insensitive" } } } },
        ],
      },
      select: {
        sku: true,
        product: { select: { name: true, brand: { select: { name: true } } } },
      },
      take: limit,
      orderBy: { sku: "asc" },
    }),
    describeAccountCode(q, scope),
  ]);
  const products: Array<{ sku: string; name: string; inCatalogue: boolean; brandName: string | null }> = [];
  const seen = new Set<string>();
  for (const variant of catalogue) {
    const key = variant.sku.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      sku: variant.sku,
      name: variant.product.name,
      inCatalogue: true,
      brandName: variant.product.brand?.name ?? null,
    });
  }
  for (const row of historicProducts) {
    const key = row.partNumber.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      sku: row.partNumber,
      name: row.description?.trim() || row.partNumber,
      inCatalogue: false,
      brandName: null,
    });
    if (products.length >= limit) break;
  }
  return {
    companies: companies.map((company) => ({
      id: company.id,
      name: company.name,
      tradingName: company.tradingName,
      accountNumber: company.accountNumber,
      autopartCustomerCode: company.autopartCustomerCode,
      status: company.status,
      accountCodes: company.accountCodes,
      salespersonName: company.salespersonName,
    })),
    products: products.slice(0, limit),
    account: account?.state === "unknown" ? null : account,
  };
}

export async function exportGlobalAutopartSalesCsv(actorUserId: string, raw: unknown) {
  const input = z
    .object({ kind: z.enum(["summary", "customer", "product"]) })
    .passthrough()
    .parse(raw ?? {});
  if (input.kind === "customer") {
    const filters = cleanFilters(filterSchema.parse(raw ?? {}));
    const items = [];
    let page = 1;
    let total = Infinity;
    let meta: Awaited<ReturnType<typeof getGlobalCustomerSalesEnquiry>> | null = null;
    while (items.length < total && page <= EXPORT_PAGE_CAP) {
      const next = await getGlobalCustomerSalesEnquiry(actorUserId, { ...filters, page, pageSize: 100 });
      meta = next;
      total = next.products.total;
      items.push(...next.products.items);
      if (next.products.items.length === 0) break;
      page += 1;
    }
    const headers = [
      "Period",
      "Customer",
      "Status",
      "Linked Autopart accounts",
      "SKU",
      "Description",
      "Catalogue",
      "Lines",
      "Units",
      "Gross sales",
      "Credits",
      "Net sales",
    ];
    const rows = items.map((item) => [
      GLOBAL_AUTOPART_SALES_PERIOD.label,
      meta?.company.name ?? "",
      meta?.company.status ?? "",
      meta?.company.linkedAccountCodes.join(" ") ?? "",
      item.sku,
      item.description,
      item.catalogueStatus,
      item.lines,
      item.units,
      item.grossSales,
      item.credits,
      item.netSales,
    ]);
    return {
      filename: `all-historical-autopart-sales-${meta?.company.id ?? "customer"}.csv`,
      csv: buildCsv(headers, rows.map((row) => row.map(csvSafe))),
      truncated: items.length < total,
    };
  }
  if (input.kind === "product") {
    const filters = cleanFilters(filterSchema.parse(raw ?? {}));
    const items = [];
    let page = 1;
    let total = Infinity;
    let sku = filters.sku ?? "product";
    while (items.length < total && page <= EXPORT_PAGE_CAP) {
      const next = await getGlobalProductSalesEnquiry(actorUserId, { ...filters, page, pageSize: 100 });
      sku = next.product.sku;
      total = next.customers.total;
      items.push(...next.customers.items);
      if (next.customers.items.length === 0) break;
      page += 1;
    }
    const headers = [
      "Period",
      "SKU",
      "Customer",
      "Status",
      "Autopart code",
      "Salesperson",
      "Lines",
      "Units",
      "Gross sales",
      "Credits",
      "Net sales",
    ];
    const rows = items.map((item) => [
      GLOBAL_AUTOPART_SALES_PERIOD.label,
      sku,
      item.name,
      item.status,
      item.autopartCustomerCode ?? "",
      item.salespersonName ?? "",
      item.lines,
      item.units,
      item.grossSales,
      item.credits,
      item.netSales,
    ]);
    return {
      filename: `all-historical-autopart-sales-${sku.replace(/[^\w.-]+/g, "_")}.csv`,
      csv: buildCsv(headers, rows.map((row) => row.map(csvSafe))),
      truncated: items.length < total,
    };
  }
  const dashboard = await getGlobalAutopartSalesDashboard(actorUserId, raw);
  const headers = ["Metric", "Value"];
  const rows = [
    ["Period", dashboard.period.label],
    ["Net sales ex VAT", dashboard.summary.netSales],
    ["Gross positive sales", dashboard.summary.grossSales],
    ["Credits and negative sales", dashboard.summary.credits],
    ["Product lines", dashboard.summary.lineCount],
    ["Distinct invoices", dashboard.summary.invoiceCount],
    ["Distinct products", dashboard.summary.productCount],
    ["Signed units", dashboard.summary.units],
    ["Customers represented", dashboard.summary.customersRepresented],
    ["Customers without linked history", dashboard.summary.customersWithoutLinkedHistory],
  ];
  return {
    filename: "all-historical-autopart-sales-summary.csv",
    csv: buildCsv(headers, rows.map((row) => row.map(csvSafe))),
    truncated: false,
  };
}
