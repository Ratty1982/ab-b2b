/**
 * Single source of truth for authenticated application navigation.
 * Layout routes import these lists — do not duplicate path strings in shells.
 */
import type { NavItem } from "@/components/ab/AppShell";
import type { PermissionKey } from "@/domain/permissions";

export type AppNavItem = NavItem & {
  permission?: PermissionKey | PermissionKey[];
  /** Hide from nav until the feature ships (still keep route if present). */
  deferred?: boolean;
};

/** Canonical paths used across admin / sales / CRM / portal. */
export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  products: "/products",
  resources: "/resources",

  admin: "/admin",
  adminProducts: "/admin/products",
  adminCustomers: "/admin/customers",
  adminCustomer: (id: string) => `/admin/customers/${id}` as const,
  adminApplications: "/admin/applications",
  adminApplication: (id: string) => `/admin/applications/${id}` as const,
  adminPricing: "/admin/pricing",
  adminRoles: "/admin/roles",
  adminContent: "/admin/content",
  adminCmsPage: (slug: string) => `/admin/content/${slug}` as const,
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

export const ADMIN_NAV: AppNavItem[] = [
  { label: "Overview", to: ROUTES.admin, exact: true, permission: "admin.access" },
  { label: "Customers", to: ROUTES.adminCustomers, permission: "companies.view" },
  { label: "Trade Applications", to: ROUTES.adminApplications, permission: "applications.view" },
  { label: "Products", to: ROUTES.adminProducts, permission: ["products.view", "products.edit"] },
  { label: "Price Lists", to: ROUTES.adminPricing, permission: "pricing.view" },
  { label: "Sales Team", to: ROUTES.crmManager, permission: "sales.view_team_accounts" },
  { label: "Users & Permissions", to: ROUTES.adminRoles, permission: ["users.view", "roles.view"] },
  {
    label: "Website",
    to: ROUTES.adminContent,
    permission: ["cms.view", "cms.page.read"],
  },
  { label: "Settings", to: ROUTES.adminSettings, permission: "settings.view" },
];

export const SALES_NAV: AppNavItem[] = [
  { label: "Dashboard", to: ROUTES.sales, exact: true },
  { label: "My Customers", to: ROUTES.salesCustomers, permission: "sales.view_own_accounts" },
  { label: "Quotes", to: ROUTES.salesQuotes, permission: "quotes.view" },
  { label: "Trade Applications", to: ROUTES.crmApplications, permission: "applications.view" },
  {
    label: "Manager",
    to: ROUTES.crmManager,
    permission: ["sales.view_team_accounts", "reports.management"],
  },
  { label: "CRM", to: ROUTES.crm, permission: "crm.view" },
  { label: "Admin", to: ROUTES.admin, permission: "admin.access" },
];

export const CRM_NAV: AppNavItem[] = [
  { label: "Dashboard", to: ROUTES.crm, exact: true, permission: "crm.view" },
  { label: "Companies", to: ROUTES.adminCustomers, permission: "companies.view" },
  { label: "Trade Applications", to: ROUTES.crmApplications, permission: "applications.view" },
  { label: "Quotes", to: ROUTES.salesQuotes, permission: "quotes.view" },
  {
    label: "Manager",
    to: ROUTES.crmManager,
    permission: ["sales.view_team_accounts", "reports.management"],
  },
  { label: "Sales", to: ROUTES.sales, permission: "sales.view_own_accounts" },
  { label: "Admin", to: ROUTES.admin, permission: "admin.access" },
];

export const PORTAL_NAV: AppNavItem[] = [
  { label: "Dashboard", to: ROUTES.portal, exact: true },
  { label: "Shop", to: ROUTES.products },
  { label: "Quick Order", to: ROUTES.portalQuickOrder, permission: "orders.create" },
  { label: "Orders", to: ROUTES.portalOrders, permission: "orders.view" },
  { label: "Quotes", to: ROUTES.portalQuotes, permission: "quotes.view" },
  { label: "Invoices & Statements", to: ROUTES.portalInvoices, permission: "invoices.view" },
  { label: "Favourites / Order Lists", to: ROUTES.portalFavourites },
  { label: "Downloads", to: ROUTES.resources },
  { label: "Company & Users", to: ROUTES.portalUsers, permission: "companies.manage_users" },
  { label: "Support", to: ROUTES.portalSupport },
];
