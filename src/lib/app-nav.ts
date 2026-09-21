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
  adminCustomers: "/admin/customers",
  adminCustomer: (id: string) => `/admin/customers/${id}` as const,
  adminApplications: "/admin/applications",
  adminApplication: (id: string) => `/admin/applications/${id}` as const,
  adminPricing: "/admin/pricing",
  adminPriceList: (id: string) => `/admin/pricing/${id}` as const,
  adminRoles: "/admin/roles",
  adminContent: "/admin/content",
  adminCmsPage: (slug: string) => `/admin/content/${slug}` as const,
  adminHomepage: "/admin/content/home",
  adminMedia: "/admin/content/media",
  adminSettings: "/admin/settings",

  sales: "/sales",
  salesCustomers: "/sales/customers",
  salesCustomer: (id: string) => `/sales/customers/${id}` as const,
  salesQuotes: "/sales/quotes",
  salesQuotesNew: "/sales/quotes/new",

  crm: "/crm",
  crmApplications: "/crm/applications",
  crmManager: "/crm/manager",

  portal: "/portal",
  portalQuickOrder: "/portal/quick-order",
  portalOrders: "/portal/orders",
  portalQuotes: "/portal/quotes",
  portalInvoices: "/portal/invoices",
  portalFavourites: "/portal/favourites",
  portalUsers: "/portal/users",
  portalSupport: "/portal/support",
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
  "credit.edit",
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
  | "settings"
  | "store"
  | "heart"
  | "life-buoy"
  | "download";

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
        to: "/admin/orders",
        permission: "orders.view",
        implemented: false,
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
    id: "catalogue",
    label: "Catalogue",
    items: [
      {
        id: "products",
        label: "Products",
        icon: "package",
        to: ROUTES.adminProducts,
        matchPrefixes: [ROUTES.adminProducts],
        excludePrefixes: [ROUTES.adminProductImports],
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
    id: "crm",
    label: "CRM",
    items: [
      {
        id: "crm-overview",
        label: "Overview",
        icon: "kanban",
        to: "/crm/overview",
        permission: "crm.view",
        implemented: false,
      },
      {
        id: "crm-leads",
        label: "Leads",
        icon: "user-plus",
        to: "/crm/leads",
        permission: "crm.view",
        implemented: false,
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
        to: "/crm/activities",
        permission: ["crm.view", "crm.activities.create"],
        implemented: false,
      },
      {
        id: "tasks",
        label: "Tasks",
        icon: "list-todo",
        to: "/crm/tasks",
        permission: "tasks.view",
        implemented: false,
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
        excludePrefixes: [ROUTES.adminHomepage, ROUTES.adminMedia],
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
        permission: ["sales.view_team_accounts", "sales.view_all_accounts", "reports.management"],
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
        to: "/admin/documents",
        permission: "products.view",
        adminShellOnly: true,
        implemented: false,
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
        id: "portal-quick-order",
        label: "Quick Order",
        icon: "clipboard-list",
        to: ROUTES.portalQuickOrder,
        permission: "orders.create",
        implemented: true,
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
        implemented: true,
      },
      {
        id: "portal-favourites",
        label: "Favourites / Order Lists",
        icon: "heart",
        to: ROUTES.portalFavourites,
        implemented: true,
      },
      {
        id: "portal-downloads",
        label: "Downloads",
        icon: "download",
        to: ROUTES.resources,
        implemented: true,
      },
      {
        id: "portal-users",
        label: "Company & Users",
        icon: "users",
        to: ROUTES.portalUsers,
        permission: "companies.manage_users",
        implemented: true,
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
