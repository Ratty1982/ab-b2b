/**
 * Per-user permission overrides for internal staff.
 * Roles stay the default template. INHERIT uses the role.
 * ALLOW grants a permission the role does not. DENY removes one the role grants.
 * Trade company access is not edited here.
 */
import { PERMISSIONS, isPermissionKey, type PermissionKey } from "@/domain/permissions";
import { STAFF_PERMISSION_TREE, implySectionPermissions } from "@/domain/permission-sections";

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
  "sales_intelligence.enquiry.view": "View sales enquiry",
  "sales_intelligence.daily_brief.view": "View daily brief",
  "sales_intelligence.portfolio.view": "View sales rep portfolio",
  "sales_intelligence.gaps.view": "View gap analysis",
  "sales_intelligence.opportunities.view": "View range opportunities",
  "sales_intelligence.rebates.view": "View rebate analysis",
  "purchasing.dashboard.view": "View purchasing dashboard",
  "purchasing.stock.view": "View stock overview",
  "purchasing.forecast.view": "View stock forecast",
  "purchasing.planner.view": "View purchase planner",
  "purchasing.backorders.view": "View backorders",
  "purchasing.overstock.view": "View overstock",
  "purchasing.suppliers.view": "View suppliers",
  "purchasing.stock.manage": "Manage stock imports",
  "purchasing.forecast.manage": "Manage forecast coverage",
  "purchasing.planner.manage": "Manage purchase planner",
  "purchasing.backorders.manage": "Manage backorder imports",
  "purchasing.suppliers.manage": "Manage suppliers",
  "crm.overview.view": "View CRM overview",
  "crm.leads.view": "View CRM leads",
  "crm.opportunities.view": "View CRM opportunities",
  "crm.activities.view": "View CRM activities",
  "catalogue.brands.view": "View brands",
  "catalogue.brands.edit": "Edit brands",
  "catalogue.categories.view": "View categories",
  "catalogue.categories.edit": "Edit categories",
  "catalogue.documents.view": "View documents",
  "catalogue.documents.edit": "Edit documents",
  "cms.homepage.view": "View homepage",
  "cms.homepage.edit": "Edit homepage",
  "cms.team.view": "View team page",
  "cms.team.edit": "Edit team page",
  "sales.team.view": "View sales team",
  "sales.team.manage": "Manage sales team",
};

export const PERMISSION_CATEGORIES: readonly PermissionCategory[] = STAFF_PERMISSION_TREE.map(
  (category) => ({
    id: category.id,
    label: category.label,
    columns: {},
    permissions: category.sections.flatMap((section) => section.actions),
  }),
);

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
  return { effective: implySectionPermissions(effective, denied), denied };
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
