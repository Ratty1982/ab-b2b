import {
  ALL_PERMISSIONS,
  type PermissionKey,
  type SystemRoleKey,
  type TradeAccessKey,
} from "./permissions";

/**
 * Default permission maps for seeded system roles.
 * Trade company access is ALSO scoped by CompanyUser — these keys alone are insufficient.
 */

const MANAGEMENT_PERMS: PermissionKey[] = [
  "companies.view",
  "companies.create",
  "companies.edit",
  "companies.delete",
  "companies.manage_users",
  "contacts.view",
  "contacts.create",
  "contacts.edit",
  "products.view",
  "products.import",
  "products.export",
  "pricing.view",
  "inventory.view",
  "orders.view",
  "quotes.view",
  "invoices.view",
  "crm.view",
  "crm.manage",
  "crm.activities.create",
  "tasks.view",
  "tasks.manage",
  "applications.view",
  "applications.review",
  "applications.approve",
  "sales.view_all_accounts",
  "reports.view",
  "reports.management",
  "cms.view",
  "cms.page.read",
  "credit.view",
  "audit.view",
  "settings.view",
  "settings.edit",
];

const SALES_MANAGER_PERMS: PermissionKey[] = [
  "companies.view",
  "contacts.view",
  "contacts.create",
  "contacts.edit",
  "products.view",
  "pricing.view",
  "inventory.view",
  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.place_for_customer",
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.send",
  "invoices.view",
  "crm.view",
  "crm.manage",
  "crm.activities.create",
  "tasks.view",
  "tasks.manage",
  "applications.view",
  "applications.review",
  "sales.view_team_accounts",
  "sales.view_own_accounts",
  "reports.view",
  "impersonation.order_for_customer",
];

const SALES_REP_PERMS: PermissionKey[] = [
  "companies.view",
  "contacts.view",
  "contacts.create",
  "contacts.edit",
  "products.view",
  "pricing.view",
  "inventory.view",
  "orders.view",
  "orders.create",
  "orders.place_for_customer",
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.send",
  "crm.view",
  "crm.activities.create",
  "tasks.view",
  "tasks.manage",
  "applications.view",
  "sales.view_own_accounts",
  "impersonation.order_for_customer",
];

const CUSTOMER_SERVICE_PERMS: PermissionKey[] = [
  "companies.view",
  "contacts.view",
  "products.view",
  "pricing.view",
  "inventory.view",
  "orders.view",
  "orders.edit",
  "quotes.view",
  "invoices.view",
  "applications.view",
  "tasks.view",
  "tasks.manage",
];

const ACCOUNTS_PERMS: PermissionKey[] = [
  "companies.view",
  "contacts.view",
  "orders.view",
  "invoices.view",
  "applications.view",
  "applications.review",
  "credit.view",
  "credit.edit",
  "reports.view",
];

const MARKETING_PERMS: PermissionKey[] = [
  "products.view",
  "products.create",
  "products.edit",
  "products.import",
  "products.export",
  "cms.view",
  "cms.edit",
  "cms.publish",
  "cms.page.read",
  "cms.page.edit",
  "cms.page.publish",
  "cms.media.read",
  "cms.media.manage",
];

/** Company-scoped trade permissions (still require CompanyUser membership). */
export const TRADE_ROLE_PERMISSIONS: Record<TradeAccessKey, PermissionKey[]> = {
  TRADE_ACCOUNT_ADMIN: [
    "companies.view",
    "companies.edit",
    "companies.manage_users",
    "pricing.view",
    "products.view",
    "inventory.view",
    "orders.view",
    "orders.create",
    "quotes.view",
    "quotes.accept",
    "invoices.view",
  ],
  TRADE_BUYER: [
    "companies.view",
    "pricing.view",
    "products.view",
    "inventory.view",
    "orders.view",
    "orders.create",
    "quotes.view",
    "quotes.accept",
  ],
  TRADE_ACCOUNTS: ["companies.view", "orders.view", "invoices.view", "quotes.view"],
  TRADE_READ_ONLY: [
    "companies.view",
    "pricing.view",
    "products.view",
    "inventory.view",
    "orders.view",
    "quotes.view",
    "invoices.view",
  ],
};

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  MANAGEMENT: MANAGEMENT_PERMS,
  SALES_MANAGER: SALES_MANAGER_PERMS,
  SALES_REPRESENTATIVE: SALES_REP_PERMS,
  CUSTOMER_SERVICE: CUSTOMER_SERVICE_PERMS,
  ACCOUNTS: ACCOUNTS_PERMS,
  MARKETING: MARKETING_PERMS,
};

export const SYSTEM_ROLE_META: Record<SystemRoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full system access. All actions must be audit-visible. MFA required (planned).",
  },
  MANAGEMENT: {
    name: "Management",
    description:
      "Broad reporting, companies, CRM and sales visibility without security administration.",
  },
  SALES_MANAGER: {
    name: "Sales Manager",
    description: "Team customers, pipeline, quotes, orders, CRM and sales reporting.",
  },
  SALES_REPRESENTATIVE: {
    name: "Sales Representative",
    description: "Assigned customers only; CRM activity, quotes, order-for-customer.",
  },
  CUSTOMER_SERVICE: {
    name: "Customer Service",
    description: "Customer/order/product/stock visibility for support operations.",
  },
  ACCOUNTS: {
    name: "Accounts",
    description: "Invoices, credit, payment terms. MFA required when editing credit (planned).",
  },
  MARKETING: {
    name: "Marketing",
    description: "CMS, brands, product content, downloads and promotions.",
  },
};
