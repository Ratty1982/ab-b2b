/**
 * Canonical authenticated navigation — the product contract for sidebars.
 *
 * Adding a feature should update this file (mark `implemented: true` and set `to`).
 * Do not reorganise, rename, remove or relocate existing items as part of
 * unrelated feature work. Do not duplicate these lists in AppShell or layouts.
 */
import type { PermissionKey } from "@/domain/permissions";
import type { SafeSessionUser } from "@/server/auth/session";

/** Canonical paths used across admin / sales / CRM / portal. */
export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  products: "/products",
  resources: "/resources",

  admin: "/admin",
  adminProducts: "/admin/products",
  adminProduct: (id: string) => `/admin/products/${id}` as const,
  adminBrands: "/admin/brands",
  adminCategories: "/admin/categories",
  adminProductImports: "/admin/products/imports",
  adminProductDocuments: "/admin/products/documents",
  adminProductDocumentsImport: "/admin/products/documents-import",
  adminStockSync: "/admin/products/stock",
  adminCostIntelligence: "/admin/cost-intelligence",
  adminCustomers: "/admin/customers",
  adminCustomer: (id: string) => `/admin/customers/${id}` as const,
  adminAutopartAccounts: "/admin/customers/autopart-accounts",
  adminAutopartImports: "/admin/customers/autopart-imports",
  adminCustomerGroups: "/admin/customers/groups",
  adminCustomerGroup: (id: string) => `/admin/customers/groups/${id}` as const,
  adminApplications: "/admin/applications",
  adminApplication: (id: string) => `/admin/applications/${id}` as const,
  adminPricing: "/admin/pricing",
  adminPriceList: (id: string) => `/admin/pricing/${id}` as const,
  adminRoles: "/admin/roles",
  adminContent: "/admin/content",
  adminCmsPage: (slug: string) => `/admin/content/${slug}` as const,
  adminHomepage: "/admin/content/home",
  adminMedia: "/admin/content/media",
  adminTeam: "/admin/content/team",
  adminSettings: "/admin/settings",
  adminVersionUpdates: "/admin/version-updates",
  adminVersionUpdate: (id: string) => `/admin/version-updates/${id}` as const,
  adminVersionUpdateNew: "/admin/version-updates/new",

  sales: "/sales",
  salesCustomers: "/sales/customers",
  salesCustomer: (id: string) => `/sales/customers/${id}` as const,
  salesQuotes: "/sales/quotes",
  salesQuotesNew: "/sales/quotes/new",
  salesQuote: (id: string) => `/sales/quotes/${id}` as const,

  crm: "/crm",
  crmOverview: "/crm/overview",
  crmLeads: "/crm/leads",
  crmActivities: "/crm/activities",
  crmApplications: "/crm/applications",
  crmManager: "/crm/manager",
  crmTasks: "/crm/tasks",

  portal: "/portal",
  portalBasket: "/portal/basket",
  portalCheckout: "/portal/checkout",
  portalQuickOrder: "/portal/quick-order",
  portalOrders: "/portal/orders",
  portalOrder: (id: string) => `/portal/orders/${id}` as const,
  portalOrderConfirmation: (id: string) => `/portal/orders/${id}/confirmation` as const,
  portalQuotes: "/portal/quotes",
  portalQuote: (id: string) => `/portal/quotes/${id}` as const,
  portalPurchases: "/portal/purchases",
  portalInvoices: "/portal/invoices",
  portalFavourites: "/portal/favourites",
  portalUsers: "/portal/users",
  portalSupport: "/portal/support",

  adminOrders: "/admin/orders",
  adminOrder: (id: string) => `/admin/orders/${id}` as const,

  salesIntelligence: "/sales/sales-intelligence",
  salesIntelligenceDailyBrief: "/sales/sales-intelligence/daily-brief",
  salesIntelligencePortfolio: "/sales/sales-intelligence/portfolio",
  salesIntelligenceGaps: "/sales/sales-intelligence/gaps",
  salesIntelligenceOpportunities: "/sales/sales-intelligence/opportunities",
  salesIntelligenceRebates: "/sales/sales-intelligence/rebates",

  purchasing: "/purchasing",
  purchasingStock: "/purchasing/stock",
  purchasingForecast: "/purchasing/forecast",
  purchasingForecastSku: (sku: string) => `/purchasing/forecast/${encodeURIComponent(sku)}` as const,
  purchasingPlanner: "/purchasing/planner",
  purchasingBackorders: "/purchasing/backorders",
  purchasingOverstock: "/purchasing/overstock",
  purchasingSuppliers: "/purchasing/suppliers",
  purchasingSupplier: (id: string) => `/purchasing/suppliers/${id}` as const,
} as const;

/**
 * Permissions that unlock the /admin layout (must stay aligned with
 * `requireAdminAccess` in src/server/rbac/guards.ts).
 */
export const ADMIN_SHELL_PERMISSIONS: PermissionKey[] = [
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
];

export type NavIconName =
  | "layout-dashboard"
  | "building-2"
  | "clipboard-list"
  | "file-text"
  | "shopping-bag"
  | "receipt"
  | "package"
  | "award"
  | "folders"
  | "tags"
  | "kanban"
  | "user-plus"
  | "briefcase"
  | "activity"
  | "list-todo"
  | "globe"
  | "file-pen"
  | "image"
  | "users"
  | "shield"
  | "files"
  | "bar-chart-3"
  | "scroll-text"
  | "sparkles"
  | "settings"
  | "store"
  | "heart"
  | "life-buoy"
  | "download"
  | "shopping-cart";

export type NavSurface = "backoffice" | "portal";

export type NavCtx = {
  actorType: "INTERNAL" | "TRADE";
  permissions: ReadonlySet<string>;
};

export function navCtxFromUser(user: Pick<SafeSessionUser, "actorType" | "navPermissions">): NavCtx {
  return {
    actorType: user.actorType,
    permissions: new Set(user.navPermissions),
  };
}

export function hasNavPermission(ctx: NavCtx, key: PermissionKey): boolean {
  return ctx.permissions.has(key);
}

export function canUseAdminShell(ctx: NavCtx): boolean {
  if (ctx.actorType !== "INTERNAL") return false;
  return ADMIN_SHELL_PERMISSIONS.some((p) => ctx.permissions.has(p));
}

export type NavItemDef = {
  id: string;
  label: string;
  icon: NavIconName;
  /** Static path when it does not depend on role. */
  to?: string;
  resolveTo?: (ctx: NavCtx) => string;
  resolveLabel?: (ctx: NavCtx) => string;
  exact?: boolean;
  /** Extra path prefixes that keep this item active (child records). */
  matchPrefixes?: string[];
  /** Paths that must NOT count as active for this item. */
  excludePrefixes?: string[];
  permission?: PermissionKey | PermissionKey[];
  /** Hide in the sales/CRM shells when the destination lives under /admin. */
  adminShellOnly?: boolean;
  /**
   * When false the item is part of the IA contract but hidden until the
   * screen exists. Flip to true in the phase that ships it — do not invent
   * a second nav list.
   */
  implemented: boolean;
  children?: NavItemDef[];
};

export type NavSectionDef = {
  id: string;
  label: string;
  items: NavItemDef[];
};

/**
 * Definitive Automotive Brands back-office information architecture.
 * Internal layouts (admin, sales, CRM) all consume this tree.
 */
export const BACK_OFFICE_NAV: NavSectionDef[] = [
{
    id: "home",
    label: "Home",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: "layout-dashboard",
        resolveTo: (ctx) => areaHomePath(ctx),
        exact: true,
        implemented: true,
      },
    ],
  },

{
    id: "sales",
    label: "Sales",
    items: [
      {
        id: "customers",
        label: "Customers",
        icon: "building-2",
        resolveLabel: (ctx) => (canUseAdminShell(ctx) ? "Customers" : "My Customers"),
        resolveTo: (ctx) =>
          canUseAdminShell(ctx) ? ROUTES.adminCustomers : ROUTES.salesCustomers,
        matchPrefixes: [ROUTES.adminCustomers, ROUTES.salesCustomers],
        permission: ["companies.view", "sales.view_own_accounts"],
        implemented: true,
      },
      {
        id: "trade-applications",
        label: "Trade Applications",
        icon: "clipboard-list",
        resolveTo: (ctx) =>
          canUseAdminShell(ctx) ? ROUTES.adminApplications : ROUTES.crmApplications,
        matchPrefixes: [ROUTES.adminApplications, ROUTES.crmApplications],
        permission: "applications.view",
        implemented: true,
      },
      {
        id: "quotes",
        label: "Quotes",
        icon: "file-text",
        to: ROUTES.salesQuotes,
        permission: "quotes.view",
        implemented: true,
      },
      {
        id: "orders",
        label: "Orders",
        icon: "shopping-bag",
        to: ROUTES.adminOrders,
        permission: "orders.view",
        implemented: true,
      },
      {
        id: "invoices",
        label: "Invoices",
        icon: "receipt",
        to: "/admin/invoices",
        permission: "invoices.view",
        implemented: false,
      },
    ],
  },

  {
    id: "crm",
    label: "CRM",
    items: [
      {
        id: "crm-overview",
        label: "Overview",
        icon: "kanban",
        to: ROUTES.crmOverview,
        matchPrefixes: [ROUTES.crmOverview],
        permission: "crm.view",
        implemented: true,
      },
      {
        id: "crm-leads",
        label: "Leads",
        icon: "user-plus",
        to: ROUTES.crmLeads,
        matchPrefixes: [ROUTES.crmLeads],
        permission: "crm.view",
        implemented: true,
      },
      {
        id: "opportunities",
        label: "Opportunities",
        icon: "briefcase",
        to: ROUTES.crm,
        exact: true,
        permission: "crm.view",
        implemented: true,
      },
      {
        id: "activities",
        label: "Activities",
        icon: "activity",
        to: ROUTES.crmActivities,
        matchPrefixes: [ROUTES.crmActivities],
        permission: ["crm.view", "crm.activities.create"],
        implemented: true,
      },
      {
        id: "tasks",
        label: "Tasks",
        icon: "list-todo",
        to: ROUTES.crmTasks,
        matchPrefixes: [ROUTES.crmTasks],
        permission: "tasks.view",
        implemented: true,
      },
      {
        id: "crm-autopart-imports",
        label: "Autopart Imports",
        icon: "file-text",
        to: ROUTES.adminAutopartImports,
        matchPrefixes: [ROUTES.adminAutopartImports],
        permission: "autopart.import.view",
        implemented: true,
      },
    ],
  },

{
    id: "sales-intelligence",
    label: "Sales Intelligence",
    items: [
      {
        id: "sales-enquiry",
        label: "Sales Enquiry",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligence,
        matchPrefixes: [ROUTES.salesIntelligence],
        excludePrefixes: [
          ROUTES.salesIntelligenceDailyBrief,
          ROUTES.salesIntelligencePortfolio,
          ROUTES.salesIntelligenceGaps,
          ROUTES.salesIntelligenceOpportunities,
          ROUTES.salesIntelligenceRebates,
        ],
        permission: "sales_intelligence.view",
        implemented: true,
      },
      {
        id: "sales-daily-brief",
        label: "Daily Brief",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligenceDailyBrief,
        matchPrefixes: [ROUTES.salesIntelligenceDailyBrief],
        permission: "sales_intelligence.view",
        implemented: true,
      },
      {
        id: "sales-rep-portfolio",
        label: "Sales Rep Portfolio",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligencePortfolio,
        matchPrefixes: [ROUTES.salesIntelligencePortfolio],
        permission: "sales_intelligence.view",
        implemented: true,
      },
      {
        id: "sales-gap-analysis",
        label: "Gap Analysis",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligenceGaps,
        matchPrefixes: [ROUTES.salesIntelligenceGaps],
        permission: "sales_intelligence.view",
        implemented: true,
      },
      {
        id: "sales-range-opportunities",
        label: "Range Opportunities",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligenceOpportunities,
        matchPrefixes: [ROUTES.salesIntelligenceOpportunities],
        permission: "sales_intelligence.view",
        implemented: true,
      },
      {
        id: "sales-rebate-analysis",
        label: "Rebate Analysis",
        icon: "bar-chart-3",
        to: ROUTES.salesIntelligenceRebates,
        matchPrefixes: [ROUTES.salesIntelligenceRebates],
        permission: "sales_intelligence.view",
        implemented: true,
      },
    ],
  },

  {
    id: "purchasing",
    label: "Purchasing",
    items: [
      {
        id: "purchasing-dashboard",
        label: "Dashboard",
        icon: "layout-dashboard",
        to: ROUTES.purchasing,
        exact: true,
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-stock",
        label: "Stock Overview",
        icon: "package",
        to: ROUTES.purchasingStock,
        matchPrefixes: [ROUTES.purchasingStock],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-forecast",
        label: "Stock Forecast",
        icon: "bar-chart-3",
        to: ROUTES.purchasingForecast,
        matchPrefixes: [ROUTES.purchasingForecast],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-planner",
        label: "Purchase Planner",
        icon: "clipboard-list",
        to: ROUTES.purchasingPlanner,
        matchPrefixes: [ROUTES.purchasingPlanner],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-backorders",
        label: "Backorders",
        icon: "list-todo",
        to: ROUTES.purchasingBackorders,
        matchPrefixes: [ROUTES.purchasingBackorders],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-overstock",
        label: "Overstock",
        icon: "package",
        to: ROUTES.purchasingOverstock,
        matchPrefixes: [ROUTES.purchasingOverstock],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "purchasing-suppliers",
        label: "Suppliers",
        icon: "building-2",
        to: ROUTES.purchasingSuppliers,
        matchPrefixes: [ROUTES.purchasingSuppliers],
        permission: "purchasing.view",
        implemented: true,
      },
      {
        id: "cost-intelligence",
        label: "Cost Intelligence",
        icon: "activity",
        to: ROUTES.adminCostIntelligence,
        matchPrefixes: [ROUTES.adminCostIntelligence],
        permission: ["products.cost.view", "admin.access"],
        adminShellOnly: true,
        implemented: true,
      },
    ],
  },

{
    id: "catalogue",
    label: "Catalogue",
    items: [
      {
        id: "products",
        label: "Products",
        icon: "package",
        to: ROUTES.adminProducts,
        matchPrefixes: [ROUTES.adminProducts],
        excludePrefixes: [
          ROUTES.adminProductImports,
          ROUTES.adminProductDocuments,
          ROUTES.adminProductDocumentsImport,
        ],
        permission: ["products.view", "products.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "brands",
        label: "Brands",
        icon: "award",
        to: ROUTES.adminBrands,
        permission: ["products.view", "products.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "categories",
        label: "Categories",
        icon: "folders",
        to: ROUTES.adminCategories,
        permission: ["products.view", "products.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "product-imports",
        label: "Imports",
        icon: "download",
        to: ROUTES.adminProductImports,
        matchPrefixes: [ROUTES.adminProductImports],
        permission: ["products.import", "products.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "autopart-stock",
        label: "Autopart Stock",
        icon: "package",
        to: ROUTES.adminStockSync,
        matchPrefixes: [ROUTES.adminStockSync],
        permission: ["inventory.view", "products.import", "products.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "price-lists",
        label: "Price Lists",
        icon: "tags",
        to: ROUTES.adminPricing,
        permission: "pricing.view",
        adminShellOnly: true,
        implemented: true,
      },
    ],
  },

{
    id: "website",
    label: "Website",
    items: [
      {
        id: "website-pages",
        label: "Pages",
        icon: "globe",
        to: ROUTES.adminContent,
        excludePrefixes: [ROUTES.adminHomepage, ROUTES.adminMedia, ROUTES.adminTeam],
        matchPrefixes: [ROUTES.adminContent],
        permission: ["cms.view", "cms.page.read"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "website-homepage",
        label: "Homepage",
        icon: "file-pen",
        to: ROUTES.adminHomepage,
        matchPrefixes: [ROUTES.adminHomepage],
        permission: ["cms.view", "cms.page.read", "cms.page.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "website-team",
        label: "Team",
        icon: "users",
        to: ROUTES.adminTeam,
        matchPrefixes: [ROUTES.adminTeam],
        permission: ["cms.view", "cms.page.read", "cms.page.edit"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "website-media",
        label: "Media",
        icon: "image",
        to: ROUTES.adminMedia,
        matchPrefixes: [ROUTES.adminMedia],
        permission: ["cms.media.read", "cms.media.manage", "cms.page.read"],
        adminShellOnly: true,
        implemented: true,
      },
    ],
  },

{
    id: "operations",
    label: "Operations",
    items: [
      {
        id: "sales-team",
        label: "Sales Team",
        icon: "users",
        to: ROUTES.crmManager,
        permission: [
          "sales.view_team_accounts",
          "sales.view_all_accounts",
          "reports.management",
          "users.manage",
        ],
        implemented: true,
      },
      {
        id: "users",
        label: "Users",
        icon: "shield",
        to: ROUTES.adminRoles,
        permission: ["users.view", "roles.view"],
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "documents",
        label: "Documents",
        icon: "files",
        to: ROUTES.adminProductDocuments,
        matchPrefixes: [ROUTES.adminProductDocuments, ROUTES.adminProductDocumentsImport],
        permission: "products.view",
        adminShellOnly: true,
        implemented: true,
      },
    ],
  },

{
    id: "system",
    label: "System",
    items: [
      {
        id: "reports",
        label: "Reports",
        icon: "bar-chart-3",
        to: "/admin/reports",
        permission: ["reports.view", "reports.management"],
        implemented: false,
      },
      {
        id: "audit-log",
        label: "Audit Log",
        icon: "scroll-text",
        to: "/admin/audit",
        permission: "audit.view",
        implemented: false,
      },
      {
        id: "version-updates",
        label: "Version Updates",
        icon: "sparkles",
        to: ROUTES.adminVersionUpdates,
        permission: "version_updates.manage",
        adminShellOnly: true,
        implemented: true,
      },
      {
        id: "settings",
        label: "Settings",
        icon: "settings",
        to: ROUTES.adminSettings,
        permission: "settings.view",
        adminShellOnly: true,
        implemented: true,
      },
    ],
  },
];

export const TRADE_PORTAL_NAV: NavSectionDef[] = [
  {
    id: "portal-home",
    label: "Account",
    items: [
      {
        id: "portal-dashboard",
        label: "Dashboard",
        icon: "layout-dashboard",
        to: ROUTES.portal,
        exact: true,
        implemented: true,
      },
      {
        id: "portal-shop",
        label: "Shop",
        icon: "store",
        to: ROUTES.products,
        implemented: true,
      },
      {
        id: "portal-basket",
        label: "Basket",
        icon: "shopping-cart",
        to: ROUTES.portalBasket,
        permission: "orders.view",
        implemented: true,
      },
      {
        id: "portal-quick-order",
        label: "Quick Order",
        icon: "clipboard-list",
        to: ROUTES.portalQuickOrder,
        permission: "orders.create",
        implemented: false,
      },
      {
        id: "portal-orders",
        label: "Orders",
        icon: "shopping-bag",
        to: ROUTES.portalOrders,
        permission: "orders.view",
        implemented: true,
      },
      {
        id: "portal-quotes",
        label: "Quotes",
        icon: "file-text",
        to: ROUTES.portalQuotes,
        permission: "quotes.view",
        implemented: true,
      },
      {
        id: "portal-invoices",
        label: "Invoices & Statements",
        icon: "receipt",
        to: ROUTES.portalInvoices,
        permission: "invoices.view",
        implemented: false,
      },
      {
        id: "portal-purchases",
        label: "Purchase history",
        icon: "package",
        to: ROUTES.portalPurchases,
        permission: "orders.view",
        implemented: true,
      },
      {
        id: "portal-favourites",
        label: "Favourites / Order Lists",
        icon: "heart",
        to: ROUTES.portalFavourites,
        implemented: false,
      },
      {
        id: "portal-downloads",
        label: "Downloads",
        icon: "download",
        to: ROUTES.resources,
        implemented: false,
      },
      {
        id: "portal-users",
        label: "Company & Users",
        icon: "users",
        to: ROUTES.portalUsers,
        permission: "companies.manage_users",
        implemented: false,
      },
      {
        id: "portal-support",
        label: "Support",
        icon: "life-buoy",
        to: ROUTES.portalSupport,
        implemented: true,
      },
    ],
  },
];

export function areaHomePath(ctx: NavCtx): string {
  if (ctx.actorType === "TRADE") return ROUTES.portal;
  if (hasNavPermission(ctx, "admin.access") || canUseAdminShell(ctx)) return ROUTES.admin;
  if (
    hasNavPermission(ctx, "sales.view_own_accounts") ||
    hasNavPermission(ctx, "sales.view_team_accounts") ||
    hasNavPermission(ctx, "sales.view_all_accounts")
  ) {
    return ROUTES.sales;
  }
  if (hasNavPermission(ctx, "crm.view")) return ROUTES.crm;
  return ROUTES.admin;
}

export function areaHomeLabel(ctx: NavCtx): string {
  if (ctx.actorType === "TRADE") return "Trade Portal";
  if (hasNavPermission(ctx, "admin.access") || canUseAdminShell(ctx)) return "Internal Admin";
  if (
    hasNavPermission(ctx, "sales.view_own_accounts") ||
    hasNavPermission(ctx, "sales.view_team_accounts") ||
    hasNavPermission(ctx, "sales.view_all_accounts")
  ) {
    return "Sales";
  }
  if (hasNavPermission(ctx, "crm.view")) return "CRM";
  return "Automotive Brands";
}

function permissionOk(item: NavItemDef, ctx: NavCtx): boolean {
  if (!item.permission) return true;
  const required = Array.isArray(item.permission) ? item.permission : [item.permission];
  return required.some((p) => ctx.permissions.has(p));
}

export function itemPath(item: NavItemDef, ctx: NavCtx): string {
  if (item.resolveTo) return item.resolveTo(ctx);
  return item.to ?? "#";
}

export function itemLabel(item: NavItemDef, ctx: NavCtx): string {
  if (item.resolveLabel) return item.resolveLabel(ctx);
  return item.label;
}

export function itemVisible(item: NavItemDef, ctx: NavCtx): boolean {
  if (!item.implemented) return false;
  if (item.adminShellOnly && !canUseAdminShell(ctx)) return false;
  return permissionOk(item, ctx);
}

export type VisibleNavItem = {
  id: string;
  label: string;
  icon: NavIconName;
  to: string;
  exact: boolean;
  matchPrefixes: string[];
  excludePrefixes: string[];
  children: VisibleNavItem[];
};

export type VisibleNavSection = {
  id: string;
  label: string;
  items: VisibleNavItem[];
};

function toVisible(item: NavItemDef, ctx: NavCtx): VisibleNavItem | null {
  if (!itemVisible(item, ctx)) {
    const kids = (item.children ?? []).map((c) => toVisible(c, ctx)).filter((c): c is VisibleNavItem => Boolean(c));
    if (!kids.length) return null;
  }
  const children = (item.children ?? [])
    .map((c) => toVisible(c, ctx))
    .filter((c): c is VisibleNavItem => Boolean(c));
  if (!itemVisible(item, ctx) && children.length) {
    return {
      id: item.id,
      label: itemLabel(item, ctx),
      icon: item.icon,
      to: itemPath(item, ctx),
      exact: item.exact ?? false,
      matchPrefixes: item.matchPrefixes ?? [],
      excludePrefixes: item.excludePrefixes ?? [],
      children,
    };
  }
  if (!itemVisible(item, ctx)) return null;
  return {
    id: item.id,
    label: itemLabel(item, ctx),
    icon: item.icon,
    to: itemPath(item, ctx),
    exact: item.exact ?? false,
    matchPrefixes: item.matchPrefixes ?? [],
    excludePrefixes: item.excludePrefixes ?? [],
    children,
  };
}

export function visibleNav(sections: NavSectionDef[], ctx: NavCtx): VisibleNavSection[] {
  return sections
    .map((section) => ({
      id: section.id,
      label: section.label,
      items: section.items.map((item) => toVisible(item, ctx)).filter((i): i is VisibleNavItem => Boolean(i)),
    }))
    .filter((section) => section.items.length > 0);
}

export function backOfficeNavForUser(user: SafeSessionUser): VisibleNavSection[] {
  return visibleNav(BACK_OFFICE_NAV, navCtxFromUser(user));
}

export function portalNavForUser(user: SafeSessionUser): VisibleNavSection[] {
  return visibleNav(TRADE_PORTAL_NAV, navCtxFromUser(user));
}

export function flattenVisible(sections: VisibleNavSection[]): VisibleNavItem[] {
  const out: VisibleNavItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      out.push(item);
      out.push(...item.children);
    }
  }
  return out;
}

function pathMatches(pathname: string, prefix: string, exact: boolean): boolean {
  const normalised = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const base = prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  if (exact) return normalised === base;
  return normalised === base || normalised.startsWith(`${base}/`);
}

export function isItemActive(item: VisibleNavItem, pathname: string): boolean {
  for (const excluded of item.excludePrefixes) {
    if (pathMatches(pathname, excluded, false)) return false;
  }
  if (item.matchPrefixes.length) {
    return item.matchPrefixes.some((p) => pathMatches(pathname, p, item.exact));
  }
  return pathMatches(pathname, item.to, item.exact);
}

export function findActiveItem(
  sections: VisibleNavSection[],
  pathname: string,
): { section: VisibleNavSection; item: VisibleNavItem } | null {
  let fallback: { section: VisibleNavSection; item: VisibleNavItem } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const kids = [item, ...item.children];
      for (const candidate of kids) {
        if (!isItemActive(candidate, pathname)) continue;
        if (candidate.exact || candidate.matchPrefixes.length) {
          return { section, item: candidate };
        }
        fallback = { section, item: candidate };
      }
    }
  }
  return fallback;
}

export type NavCrumb = { label: string; to?: string };

export function breadcrumbsForPath(
  pathname: string,
  ctx: NavCtx,
  extra?: NavCrumb[],
): NavCrumb[] {
  const sections = visibleNav(
    ctx.actorType === "TRADE" ? TRADE_PORTAL_NAV : BACK_OFFICE_NAV,
    ctx,
  );
  const hit = findActiveItem(sections, pathname);
  if (!hit) {
    return extra?.length ? extra : [{ label: "Dashboard", to: areaHomePath(ctx) }];
  }
  const crumbs: NavCrumb[] = [{ label: hit.section.label }, { label: hit.item.label, to: hit.item.to }];
  if (extra) crumbs.push(...extra);
  return crumbs;
}

export function collectNavDefs(sections: NavSectionDef[]): NavItemDef[] {
  const out: NavItemDef[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      out.push(item);
      if (item.children) out.push(...item.children);
    }
  }
  return out;
}

export function implementedBackOfficeIds(): string[] {
  return collectNavDefs(BACK_OFFICE_NAV)
    .filter((i) => i.implemented)
    .map((i) => i.id);
}
