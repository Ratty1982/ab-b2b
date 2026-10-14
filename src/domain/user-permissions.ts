/**
 * Per-user permission overrides for internal staff.
 * Roles stay the default template. INHERIT uses the role.
 * ALLOW grants a permission the role does not. DENY removes one the role grants.
 * Trade company access is not edited here.
 */
import { PERMISSIONS, isPermissionKey, type PermissionKey } from "@/domain/permissions";

export const OVERRIDE_EFFECTS = ["INHERIT", "ALLOW", "DENY"] as const;
export type OverrideEffect = (typeof OVERRIDE_EFFECTS)[number];

export type StoredOverride = {
  permissionKey: PermissionKey;
  effect: "ALLOW" | "DENY";
};

export type OverrideMap = Partial<Record<PermissionKey, OverrideEffect>>;

export type MatrixColumn = "view" | "edit" | "manage";

export type PermissionCategory = {
  id: string;
  label: string;
  columns: Partial<Record<MatrixColumn, readonly PermissionKey[]>>;
  /** Individual permissions shown in the advanced section. Includes matrix keys. */
  permissions: readonly PermissionKey[];
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "admin.access": "Admin access",
  "companies.view": "View customers",
  "companies.create": "Create customers",
  "companies.edit": "Edit customers",
  "companies.delete": "Delete customers",
  "companies.manage_users": "Manage customer users",
  "customer_groups.view": "View customer groups",
  "customer_groups.manage": "Manage customer groups",
  "contacts.view": "View contacts",
  "contacts.create": "Create contacts",
  "contacts.edit": "Edit contacts",
  "products.view": "View products",
  "products.create": "Create products",
  "products.edit": "Edit products",
  "products.import": "Import products",
  "products.export": "Export products",
  "products.cost.view": "View product cost",
  "pricing.view": "View pricing",
  "pricing.edit": "Edit pricing",
  "pricing.approve": "Approve customer prices",
  "promotions.submit": "Submit promotions",
  "promotions.approve": "Approve promotions",
  "promotions.report": "Promotion reports",
  "inventory.view": "View inventory",
  "orders.view": "View orders",
  "orders.create": "Create orders",
  "orders.edit": "Edit orders",
  "orders.place_for_customer": "Place orders for customers",
  "quotes.view": "View quotations",
  "quotes.create": "Create quotations",
  "quotes.edit": "Edit quotations",
  "quotes.send": "Send quotations",
  "quotes.accept": "Accept quotations",
  "quotes.override_price": "Override quotation prices",
  "quotes.accept_on_behalf": "Accept quotations for customers",
  "quotes.convert": "Convert quotations",
  "invoices.view": "View invoices",
  "crm.view": "View CRM",
  "crm.manage": "Manage CRM",
  "crm.activities.create": "Log CRM activity",
  "tasks.view": "View tasks",
  "tasks.manage": "Manage tasks",
  "applications.view": "View applications",
  "applications.review": "Review applications",
  "applications.approve": "Approve applications",
  "sales.view_own_accounts": "Own sales accounts",
  "sales.view_team_accounts": "Team sales accounts",
  "sales.view_all_accounts": "All sales accounts",
  "reports.view": "View reports",
  "reports.management": "Management reports",
  "sales_intelligence.view": "View sales intelligence",
  "purchasing.view": "View purchasing",
  "purchasing.manage": "Manage purchasing",
  "cms.view": "View website content",
  "cms.edit": "Edit website content",
  "cms.publish": "Publish website content",
  "cms.page.read": "View pages",
  "cms.page.edit": "Edit pages",
  "cms.page.publish": "Publish pages",
  "cms.media.read": "View media",
  "cms.media.manage": "Manage media",
  "surveys.view": "View surveys",
  "surveys.export": "Export surveys",
  "surveys.delete": "Delete survey responses",
  "surveys.import": "Import surveys",
  "surveys.manage": "Manage the customer survey",
  "users.view": "View users",
  "users.manage": "Manage users",
  "roles.view": "View roles",
  "roles.manage": "Manage roles",
  "audit.view": "View audit log",
  "impersonation.order_for_customer": "Order for a customer",
  "settings.view": "View settings",
  "settings.edit": "Edit settings",
  "integrations.sharepoint.manage": "Manage SharePoint integration",
  "version_updates.manage": "Manage version updates",
  "autopart.import.view": "View Autopart imports",
  "autopart.import.manage": "Manage Autopart imports",
  "autopart.customer.view": "View Autopart customers",
  "autopart.history.view": "View Autopart history",
  "autopart.ledger.view": "View Autopart ledger",
  "autopart.mapping.manage": "Manage Autopart mapping",
  "autopart.portal-access.manage": "Manage Autopart portal access",
};

const CUSTOMERS: readonly PermissionKey[] = [
  "companies.view",
  "companies.create",
  "companies.edit",
  "companies.delete",
  "companies.manage_users",
  "customer_groups.view",
  "customer_groups.manage",
  "contacts.view",
  "contacts.create",
  "contacts.edit",
  "crm.view",
  "crm.manage",
  "crm.activities.create",
  "tasks.view",
  "tasks.manage",
  "sales.view_own_accounts",
  "sales.view_team_accounts",
  "sales.view_all_accounts",
];

const ORDERS: readonly PermissionKey[] = [
  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.place_for_customer",
  "impersonation.order_for_customer",
];

const QUOTES: readonly PermissionKey[] = [
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.send",
  "quotes.accept",
  "quotes.override_price",
  "quotes.accept_on_behalf",
  "quotes.convert",
];

const PRODUCTS: readonly PermissionKey[] = [
  "products.view",
  "products.create",
  "products.edit",
  "products.import",
  "products.export",
  "products.cost.view",
];

const PRICING: readonly PermissionKey[] = [
  "pricing.view",
  "pricing.edit",
  "pricing.approve",
  "promotions.submit",
  "promotions.approve",
  "promotions.report",
];

const SURVEYS: readonly PermissionKey[] = [
  "surveys.view",
  "surveys.export",
  "surveys.delete",
  "surveys.import",
  "surveys.manage",
];

const CMS: readonly PermissionKey[] = [
  "cms.view",
  "cms.edit",
  "cms.publish",
  "cms.page.read",
  "cms.page.edit",
  "cms.page.publish",
  "cms.media.read",
  "cms.media.manage",
];

const APPLICATIONS: readonly PermissionKey[] = [
  "applications.view",
  "applications.review",
  "applications.approve",
];

const AUTOPART: readonly PermissionKey[] = [
  "autopart.import.view",
  "autopart.import.manage",
  "autopart.customer.view",
  "autopart.history.view",
  "autopart.ledger.view",
  "autopart.mapping.manage",
  "autopart.portal-access.manage",
  "integrations.sharepoint.manage",
];

const USERS_ADMIN: readonly PermissionKey[] = [
  "admin.access",
  "users.view",
  "users.manage",
  "roles.view",
  "roles.manage",
  "version_updates.manage",
];

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = [
  {
    id: "reporting",
    label: "Dashboard and Reporting",
    columns: {
      view: ["reports.view"],
      manage: ["reports.management"],
    },
    permissions: ["reports.view", "reports.management"],
  },
  {
    id: "customers",
    label: "Customers and CRM",
    columns: {
      view: ["companies.view", "customer_groups.view", "contacts.view", "crm.view", "tasks.view"],
      edit: ["companies.create", "companies.edit", "contacts.create", "contacts.edit", "crm.activities.create"],
      manage: [
        "companies.delete",
        "companies.manage_users",
        "customer_groups.manage",
        "crm.manage",
        "tasks.manage",
      ],
    },
    permissions: CUSTOMERS,
  },
  {
    id: "orders",
    label: "Sales Orders and Order Entry",
    columns: {
      view: ["orders.view"],
      edit: ["orders.create", "orders.edit"],
      manage: ["orders.place_for_customer", "impersonation.order_for_customer"],
    },
    permissions: ORDERS,
  },
  {
    id: "quotes",
    label: "Quotations",
    columns: {
      view: ["quotes.view"],
      edit: ["quotes.create", "quotes.edit", "quotes.send"],
      manage: ["quotes.accept", "quotes.override_price", "quotes.accept_on_behalf", "quotes.convert"],
    },
    permissions: QUOTES,
  },
  {
    id: "products",
    label: "Products and Catalogue",
    columns: {
      view: ["products.view", "products.cost.view"],
      edit: ["products.create", "products.edit"],
      manage: ["products.import", "products.export"],
    },
    permissions: PRODUCTS,
  },
  {
    id: "pricing",
    label: "Pricing and Promotions",
    columns: {
      view: ["pricing.view", "promotions.report"],
      edit: ["pricing.edit", "promotions.submit"],
      manage: ["pricing.approve", "promotions.approve"],
    },
    permissions: PRICING,
  },
  {
    id: "inventory",
    label: "Inventory",
    columns: { view: ["inventory.view"] },
    permissions: ["inventory.view"],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    columns: {
      view: ["purchasing.view"],
      manage: ["purchasing.manage"],
    },
    permissions: ["purchasing.view", "purchasing.manage"],
  },
  {
    id: "invoices",
    label: "Invoices and Accounts",
    columns: { view: ["invoices.view"] },
    permissions: ["invoices.view"],
  },
  {
    id: "sales-intelligence",
    label: "Sales Intelligence",
    columns: { view: ["sales_intelligence.view"] },
    permissions: ["sales_intelligence.view"],
  },
  {
    id: "surveys",
    label: "Customer Surveys",
    columns: {
      view: ["surveys.view"],
      edit: ["surveys.export", "surveys.import"],
      manage: ["surveys.delete", "surveys.manage"],
    },
    permissions: SURVEYS,
  },
  {
    id: "cms",
    label: "Content and CMS",
    columns: {
      view: ["cms.view", "cms.page.read", "cms.media.read"],
      edit: ["cms.edit", "cms.page.edit"],
      manage: ["cms.publish", "cms.page.publish", "cms.media.manage"],
    },
    permissions: CMS,
  },
  {
    id: "applications",
    label: "Applications",
    columns: {
      view: ["applications.view"],
      edit: ["applications.review"],
      manage: ["applications.approve"],
    },
    permissions: APPLICATIONS,
  },
  {
    id: "autopart",
    label: "Autopart Imports and Integration",
    columns: {
      view: [
        "autopart.import.view",
        "autopart.customer.view",
        "autopart.history.view",
        "autopart.ledger.view",
      ],
      manage: [
        "autopart.import.manage",
        "autopart.mapping.manage",
        "autopart.portal-access.manage",
        "integrations.sharepoint.manage",
      ],
    },
    permissions: AUTOPART,
  },
  {
    id: "users",
    label: "Users and Administration",
    columns: {
      view: ["users.view", "roles.view"],
      manage: ["users.manage", "roles.manage", "admin.access", "version_updates.manage"],
    },
    permissions: USERS_ADMIN,
  },
  {
    id: "settings",
    label: "Settings and Audit",
    columns: {
      view: ["settings.view", "audit.view"],
      edit: ["settings.edit"],
    },
    permissions: ["settings.view", "settings.edit", "audit.view"],
  },
];

/** Changes to these keys need an explicit confirmation. */
export const SENSITIVE_PERMISSIONS: readonly PermissionKey[] = [
  "admin.access",
  "users.manage",
  "roles.manage",
  "settings.edit",
  "sales.view_all_accounts",
  "sales.view_team_accounts",
  "impersonation.order_for_customer",
  "companies.delete",
  "surveys.delete",
  "version_updates.manage",
  "pricing.approve",
  "promotions.approve",
  "autopart.import.manage",
  "autopart.portal-access.manage",
  "integrations.sharepoint.manage",
];

const SENSITIVE = new Set<PermissionKey>(SENSITIVE_PERMISSIONS);

export function cataloguePermissionKeys(): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const category of PERMISSION_CATEGORIES) {
    keys.push(...category.permissions);
  }
  return keys;
}

export function isEffective(
  roleGrants: boolean,
  effect: OverrideEffect | undefined,
): boolean {
  if (effect === "ALLOW") return true;
  if (effect === "DENY") return false;
  return roleGrants;
}

/** Match the role when the desired grant is already the role default. */
export function effectForDesiredGrant(roleGrants: boolean, wantGranted: boolean): OverrideEffect {
  if (wantGranted === roleGrants) return "INHERIT";
  return wantGranted ? "ALLOW" : "DENY";
}

export function applyUserPermissionOverrides(
  rolePermissions: Iterable<PermissionKey>,
  overrides: readonly StoredOverride[],
): { effective: Set<PermissionKey>; denied: Set<PermissionKey> } {
  const effective = new Set<PermissionKey>(rolePermissions);
  const denied = new Set<PermissionKey>();
  for (const override of overrides) {
    if (!isPermissionKey(override.permissionKey)) continue;
    if (override.effect === "DENY") {
      effective.delete(override.permissionKey);
      denied.add(override.permissionKey);
      continue;
    }
    if (override.effect === "ALLOW") {
      denied.delete(override.permissionKey);
      effective.add(override.permissionKey);
    }
  }
  return { effective, denied };
}

/**
 * Listed permissions are alternatives. admin.access is only a fallback.
 * An explicit DENY of any specific permission blocks that fallback.
 * A directly granted permission that is not denied still allows the action.
 */
export function grantsFromSession(
  user: { navPermissions: readonly string[]; navDenies?: readonly string[] },
  keys: readonly string[],
): boolean {
  return allowsListedPermissions(new Set(user.navPermissions), new Set(user.navDenies ?? []), keys);
}

export function allowsListedPermissions(
  effective: ReadonlySet<string>,
  denied: ReadonlySet<string>,
  keys: readonly string[],
): boolean {
  const specifics = keys.filter((key) => key !== "admin.access");
  const shortcut = keys.includes("admin.access");
  for (const key of specifics) {
    if (denied.has(key)) continue;
    if (effective.has(key)) return true;
  }
  if (!shortcut || denied.has("admin.access")) return false;
  if (specifics.some((key) => denied.has(key))) return false;
  return effective.has("admin.access");
}

export function overrideMapFromStored(overrides: readonly StoredOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const override of overrides) {
    map[override.permissionKey] = override.effect;
  }
  return map;
}

export function storedFromOverrideMap(map: OverrideMap): StoredOverride[] {
  const stored: StoredOverride[] = [];
  for (const key of PERMISSIONS) {
    const effect = map[key];
    if (effect === "ALLOW" || effect === "DENY") {
      stored.push({ permissionKey: key, effect });
    }
  }
  return stored;
}

export function withPermissionEffects(
  current: OverrideMap,
  keys: readonly PermissionKey[],
  roleGranted: ReadonlySet<PermissionKey>,
  mode: "grant" | "clear" | "reset",
): OverrideMap {
  const next: OverrideMap = { ...current };
  for (const key of keys) {
    if (mode === "reset") {
      delete next[key];
      continue;
    }
    const effect = effectForDesiredGrant(roleGranted.has(key), mode === "grant");
    if (effect === "INHERIT") delete next[key];
    else next[key] = effect;
  }
  return next;
}

export type ColumnCheck = "on" | "off" | "mixed" | "empty";

export function columnCheckState(
  keys: readonly PermissionKey[],
  roleGranted: ReadonlySet<PermissionKey>,
  overrides: OverrideMap,
): ColumnCheck {
  if (keys.length === 0) return "empty";
  const granted = keys.map((key) => isEffective(roleGranted.has(key), overrides[key]));
  if (granted.every(Boolean)) return "on";
  if (granted.some(Boolean)) return "mixed";
  return "off";
}

export function sensitivePermissionChanges(before: OverrideMap, after: OverrideMap): PermissionKey[] {
  const keys = new Set<PermissionKey>([...PERMISSIONS]);
  const changed: PermissionKey[] = [];
  for (const key of keys) {
    if (!SENSITIVE.has(key)) continue;
    const left = before[key] ?? "INHERIT";
    const right = after[key] ?? "INHERIT";
    if (left !== right) changed.push(key);
  }
  return changed;
}

export function accessSummary(
  effective: ReadonlySet<PermissionKey>,
): string[] {
  return PERMISSION_CATEGORIES.filter((category) =>
    category.permissions.some((key) => effective.has(key)),
  ).map((category) => category.label);
}

/**
 * True when this save would leave no active Super Admin who can still manage users.
 */
export function removesLastEffectiveSuperAdmin(input: {
  targetHasSuperAdminRole: boolean;
  targetKeepsUsersManage: boolean;
  otherEffectiveSuperAdmins: number;
}): boolean {
  if (!input.targetHasSuperAdminRole) return false;
  if (input.targetKeepsUsersManage) return false;
  return input.otherEffectiveSuperAdmins < 1;
}
