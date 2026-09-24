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

  "contacts.view",
  "contacts.create",
  "contacts.edit",

  "products.view",
  "products.create",
  "products.edit",
  "products.import",
  "products.export",

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

  "credit.view",
  "credit.edit",

  "audit.view",

  "impersonation.order_for_customer",

  "settings.view",
  "settings.edit",
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
