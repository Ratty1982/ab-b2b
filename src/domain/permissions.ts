/**
 * Stable machine-readable permission keys.
 * Enforcement is always server-side — never trust client claims.
 */

export const PERMISSIONS = [
  "admin.access",

  "companies.view",
  "companies.create",
  "companies.edit",
  "companies.delete",
  "companies.manage_users",

  /// Internal Customer Group reporting (aggregation layer above Company).
  "customer_groups.view",
  /// Create/rename/deactivate groups and manage Company membership.
  "customer_groups.manage",

  "contacts.view",
  "contacts.create",
  "contacts.edit",

  "products.view",
  "products.create",
  "products.edit",
  "products.import",
  "products.export",
  /// Internal Autopart Latest Cost / cost history (never for trade portal).
  "products.cost.view",

  "pricing.view",
  "pricing.edit",

  "inventory.view",

  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.place_for_customer",

  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.send",
  "quotes.accept",
  "quotes.override_price",
  "quotes.accept_on_behalf",
  "quotes.convert",

  "invoices.view",

  "crm.view",
  "crm.manage",
  "crm.activities.create",

  "tasks.view",
  "tasks.manage",

  "applications.view",
  "applications.review",
  "applications.approve",

  "sales.view_own_accounts",
  "sales.view_team_accounts",
  "sales.view_all_accounts",

  "reports.view",
  "reports.management",

  /// Internal Sales Intelligence (Sales Enquiry). Never for trade portal.
  "sales_intelligence.view",

  /// Internal Purchasing Intelligence (never for trade portal).
  "purchasing.view",
  "purchasing.manage",

  "cms.view",
  "cms.edit",
  "cms.publish",
  "cms.page.read",
  "cms.page.edit",
  "cms.page.publish",
  "cms.media.read",
  "cms.media.manage",

  "users.view",
  "users.manage",

  "roles.view",
  "roles.manage",

  "audit.view",

  "impersonation.order_for_customer",

  "settings.view",
  "settings.edit",

  /**
   * Microsoft Graph / SharePoint SDS integration administration:
   * credentials, source folder resolve, enable/disable, connection test.
   * Broader than ordinary product document upload (products.edit).
   */
  "integrations.sharepoint.manage",

  /// Super Admin only — manage Version Updates / What's New (via ALL_PERMISSIONS).
  "version_updates.manage",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Internal system roles (UserRole → Role.key) */
export const SYSTEM_ROLE_KEYS = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "SALES_MANAGER",
  "SALES_REPRESENTATIVE",
  "CUSTOMER_SERVICE",
  "ACCOUNTS",
  "MARKETING",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * Trade company access levels stored on CompanyUser.role.
 * Product name TRADE_ACCOUNT_ADMIN maps to Prisma enum TRADE_ADMIN.
 */
export const TRADE_ACCESS_KEYS = [
  "TRADE_ACCOUNT_ADMIN",
  "TRADE_BUYER",
  "TRADE_ACCOUNTS",
  "TRADE_READ_ONLY",
] as const;

export type TradeAccessKey = (typeof TRADE_ACCESS_KEYS)[number];

export const ALL_PERMISSIONS: PermissionKey[] = [...PERMISSIONS];
