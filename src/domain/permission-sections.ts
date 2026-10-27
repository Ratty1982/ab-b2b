/**
 * Section-level staff permissions.
 * A parent key implies its children at runtime unless the child is explicitly denied.
 * Children are never parents, so one pass is enough.
 */
import type { PermissionKey } from "@/domain/permissions";
import type { OverrideEffect, OverrideMap } from "@/domain/user-permissions";

/** Child key → parent keys. Any effective parent implies the child. */
export const IMPLIED_BY: Readonly<Record<string, readonly PermissionKey[]>> = {
  "sales_intelligence.enquiry.view": ["sales_intelligence.view"],
  "sales_intelligence.daily_brief.view": ["sales_intelligence.view"],
  "sales_intelligence.portfolio.view": ["sales_intelligence.view"],
  "sales_intelligence.gaps.view": ["sales_intelligence.view"],
  "sales_intelligence.opportunities.view": ["sales_intelligence.view"],
  "sales_intelligence.rebates.view": ["sales_intelligence.view"],

  "purchasing.dashboard.view": ["purchasing.view"],
  "purchasing.stock.view": ["purchasing.view"],
  "purchasing.forecast.view": ["purchasing.view"],
  "purchasing.fba_forecast.view": ["purchasing.view", "purchasing.forecast.view"],
  "purchasing.planner.view": ["purchasing.view"],
  "purchasing.backorders.view": ["purchasing.view"],
  "purchasing.overstock.view": ["purchasing.view"],
  "purchasing.suppliers.view": ["purchasing.view"],
  "purchasing.stock.manage": ["purchasing.manage"],
  "purchasing.forecast.manage": ["purchasing.manage"],
  "purchasing.fba_forecast.manage": ["purchasing.manage", "purchasing.forecast.manage"],
  "purchasing.planner.manage": ["purchasing.manage"],
  "purchasing.backorders.manage": ["purchasing.manage"],
  "purchasing.suppliers.manage": ["purchasing.manage"],

  "crm.overview.view": ["crm.view"],
  "crm.leads.view": ["crm.view"],
  "crm.opportunities.view": ["crm.view"],
  "crm.activities.view": ["crm.view"],

  "catalogue.brands.view": ["products.view"],
  "catalogue.brands.edit": ["products.edit"],
  "catalogue.categories.view": ["products.view"],
  "catalogue.categories.edit": ["products.edit"],
  "catalogue.documents.view": ["products.view"],
  "catalogue.documents.edit": ["products.edit"],

  "cms.homepage.view": ["cms.page.read", "cms.view"],
  "cms.homepage.edit": ["cms.page.edit", "cms.edit"],
  "cms.team.view": ["cms.page.read", "cms.view"],
  "cms.team.edit": ["cms.page.edit", "cms.edit"],

  "sales.team.view": [
    "sales.view_team_accounts",
    "sales.view_all_accounts",
    "reports.management",
    "users.manage",
  ],
  "sales.team.manage": ["users.manage"],
};

export function implySectionPermissions(
  effective: ReadonlySet<PermissionKey>,
  denied: ReadonlySet<PermissionKey>,
): Set<PermissionKey> {
  const next = new Set(effective);
  for (const [child, parents] of Object.entries(IMPLIED_BY) as Array<
    [PermissionKey, readonly PermissionKey[]]
  >) {
    if (denied.has(child) || next.has(child)) continue;
    if (parents.some((parent) => next.has(parent))) next.add(child);
  }
  return next;
}

/** Append children of parents already on a role template. Does not reorder existing keys. */
export function expandImpliedRolePermissions(keys: readonly PermissionKey[]): PermissionKey[] {
  const have = new Set<PermissionKey>(keys);
  const extra: PermissionKey[] = [];
  for (const [child, parents] of Object.entries(IMPLIED_BY) as Array<
    [PermissionKey, readonly PermissionKey[]]
  >) {
    if (have.has(child)) continue;
    if (!parents.some((parent) => have.has(parent))) continue;
    have.add(child);
    extra.push(child);
  }
  return extra.length ? [...keys, ...extra] : [...keys];
}

export type PermissionSection = {
  id: string;
  label: string;
  /** Shown instead of action checkboxes when the page cannot be restricted. */
  fixedNote?: string;
  actions: readonly PermissionKey[];
};

export type PermissionTreeCategory = {
  id: string;
  label: string;
  sections: readonly PermissionSection[];
};

export const STAFF_PERMISSION_TREE: readonly PermissionTreeCategory[] = [
  {
    id: "home",
    label: "Home",
    sections: [
      {
        id: "dashboard",
        label: "Dashboard",
        fixedNote: "The dashboard stays available to every signed-in staff user.",
        actions: [],
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    sections: [
      {
        id: "customers",
        label: "Customers",
        actions: [
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
          "sales.view_own_accounts",
          "sales.view_team_accounts",
          "sales.view_all_accounts",
        ],
      },
      {
        id: "trade-applications",
        label: "Trade Applications",
        actions: ["applications.view", "applications.review", "applications.approve"],
      },
      {
        id: "quotes",
        label: "Quotes",
        actions: [
          "quotes.view",
          "quotes.create",
          "quotes.edit",
          "quotes.send",
          "quotes.accept",
          "quotes.override_price",
          "quotes.accept_on_behalf",
          "quotes.convert",
        ],
      },
      {
        id: "promotions",
        label: "Promotions",
        actions: ["promotions.submit", "promotions.approve", "promotions.report"],
      },
      {
        id: "sales-order-entry",
        label: "Order entry",
        actions: ["orders.place_for_customer", "orders.create", "impersonation.order_for_customer"],
      },
      {
        id: "orders",
        label: "Orders",
        actions: ["orders.view", "orders.edit", "invoices.view"],
      },
    ],
  },
  {
    id: "crm",
    label: "CRM",
    sections: [
      {
        id: "crm-overview",
        label: "Overview",
        actions: ["crm.overview.view", "crm.view", "crm.manage"],
      },
      { id: "crm-leads", label: "Leads", actions: ["crm.leads.view"] },
      { id: "opportunities", label: "Opportunities", actions: ["crm.opportunities.view"] },
      {
        id: "activities",
        label: "Activities",
        actions: ["crm.activities.view", "crm.activities.create"],
      },
      { id: "tasks", label: "Tasks", actions: ["tasks.view", "tasks.manage"] },
    ],
  },
  {
    id: "sales-intelligence",
    label: "Sales Intelligence",
    sections: [
      {
        id: "sales-enquiry",
        label: "Sales Enquiry",
        actions: ["sales_intelligence.enquiry.view", "sales_intelligence.view"],
      },
      { id: "sales-daily-brief", label: "Daily Brief", actions: ["sales_intelligence.daily_brief.view"] },
      { id: "sales-rep-portfolio", label: "Sales Rep Portfolio", actions: ["sales_intelligence.portfolio.view"] },
      { id: "sales-gap-analysis", label: "Gap Analysis", actions: ["sales_intelligence.gaps.view"] },
      {
        id: "sales-range-opportunities",
        label: "Range Opportunities",
        actions: ["sales_intelligence.opportunities.view"],
      },
      { id: "sales-rebate-analysis", label: "Rebate Analysis", actions: ["sales_intelligence.rebates.view"] },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    sections: [
      {
        id: "purchasing-dashboard",
        label: "Dashboard",
        actions: ["purchasing.dashboard.view", "purchasing.view", "purchasing.manage"],
      },
      {
        id: "purchasing-stock",
        label: "Stock Overview",
        actions: ["purchasing.stock.view", "purchasing.stock.manage"],
      },
      {
        id: "purchasing-forecast",
        label: "Stock Forecast",
        actions: ["purchasing.forecast.view", "purchasing.forecast.manage"],
      },
      {
        id: "purchasing-fba-forecast",
        label: "FBA Forecast",
        actions: ["purchasing.fba_forecast.view", "purchasing.fba_forecast.manage"],
      },
      {
        id: "purchasing-planner",
        label: "Purchase Planner",
        actions: ["purchasing.planner.view", "purchasing.planner.manage"],
      },
      {
        id: "purchasing-backorders",
        label: "Backorders",
        actions: ["purchasing.backorders.view", "purchasing.backorders.manage"],
      },
      { id: "purchasing-overstock", label: "Overstock", actions: ["purchasing.overstock.view"] },
      {
        id: "purchasing-suppliers",
        label: "Suppliers",
        actions: ["purchasing.suppliers.view", "purchasing.suppliers.manage"],
      },
      { id: "cost-intelligence", label: "Cost Intelligence", actions: ["products.cost.view"] },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    sections: [
      { id: "products", label: "Products", actions: ["products.view", "products.create", "products.edit"] },
      { id: "brands", label: "Brands", actions: ["catalogue.brands.view", "catalogue.brands.edit"] },
      {
        id: "categories",
        label: "Categories",
        actions: ["catalogue.categories.view", "catalogue.categories.edit"],
      },
      { id: "product-imports", label: "Imports", actions: ["products.import", "products.export"] },
      { id: "autopart-stock", label: "Autopart Stock", actions: ["inventory.view"] },
      {
        id: "price-lists",
        label: "Price Lists",
        actions: ["pricing.view", "pricing.edit", "pricing.approve"],
      },
    ],
  },
  {
    id: "website",
    label: "Website",
    sections: [
      {
        id: "customer-surveys",
        label: "Customer Surveys",
        actions: ["surveys.view", "surveys.export", "surveys.delete", "surveys.import", "surveys.manage"],
      },
      {
        id: "website-pages",
        label: "Pages",
        actions: ["cms.view", "cms.edit", "cms.publish", "cms.page.read", "cms.page.edit", "cms.page.publish"],
      },
      {
        id: "website-homepage",
        label: "Homepage",
        actions: ["cms.homepage.view", "cms.homepage.edit"],
      },
      { id: "website-team", label: "Team", actions: ["cms.team.view", "cms.team.edit"] },
      { id: "website-media", label: "Media", actions: ["cms.media.read", "cms.media.manage"] },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    sections: [
      {
        id: "sales-team",
        label: "Sales Team",
        actions: ["sales.team.view", "sales.team.manage", "reports.view", "reports.management"],
      },
      {
        id: "users",
        label: "Users",
        actions: ["users.view", "users.manage", "roles.view", "roles.manage", "admin.access"],
      },
      {
        id: "documents",
        label: "Documents",
        actions: ["catalogue.documents.view", "catalogue.documents.edit", "integrations.sharepoint.manage"],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    sections: [
      {
        id: "integrations-autopart-imports",
        label: "Autopart data imports",
        actions: [
          "autopart.import.view",
          "autopart.import.manage",
          "autopart.customer.view",
          "autopart.history.view",
          "autopart.ledger.view",
          "autopart.mapping.manage",
          "autopart.portal-access.manage",
        ],
      },
    ],
  },
  {
    id: "system",
    label: "System",
    sections: [
      { id: "version-updates", label: "Version Updates", actions: ["version_updates.manage"] },
      {
        id: "settings",
        label: "Settings",
        actions: ["settings.view", "settings.edit", "audit.view"],
      },
    ],
  },
];

export function sectionById(id: string): PermissionSection | undefined {
  for (const category of STAFF_PERMISSION_TREE) {
    const section = category.sections.find((item) => item.id === id);
    if (section) return section;
  }
  return undefined;
}

export function keysInSection(id: string): PermissionKey[] {
  return [...(sectionById(id)?.actions ?? [])];
}

export function keysInCategory(id: string): PermissionKey[] {
  const category = STAFF_PERMISSION_TREE.find((item) => item.id === id);
  return category ? category.sections.flatMap((section) => [...section.actions]) : [];
}

export function treePermissionKeys(): PermissionKey[] {
  return STAFF_PERMISSION_TREE.flatMap((category) => category.sections.flatMap((section) => [...section.actions]));
}

/**
 * Catalogue and website section keys open /admin only when the umbrella
 * permission is absent. A sales role that already has products.view keeps
 * the implied brand key without gaining the admin shell.
 */
const DEDICATED_ADMIN_UNLOCK: ReadonlyArray<readonly [PermissionKey, PermissionKey]> = [
  ["catalogue.brands.view", "products.view"],
  ["catalogue.brands.edit", "products.edit"],
  ["catalogue.categories.view", "products.view"],
  ["catalogue.categories.edit", "products.edit"],
  ["catalogue.documents.view", "products.view"],
  ["catalogue.documents.edit", "products.edit"],
  ["cms.homepage.view", "cms.page.read"],
  ["cms.homepage.edit", "cms.page.edit"],
  ["cms.team.view", "cms.page.read"],
  ["cms.team.edit", "cms.page.edit"],
];

export function dedicatedAdminSectionUnlock(permissions: ReadonlySet<string>): boolean {
  return DEDICATED_ADMIN_UNLOCK.some(
    ([section, umbrella]) => permissions.has(section) && !permissions.has(umbrella),
  );
}

export function mergePermissionOverrides(
  current: OverrideMap,
  changes: readonly { permissionKey: PermissionKey; effect: OverrideEffect }[],
): OverrideMap {
  const next: OverrideMap = { ...current };
  for (const change of changes) {
    if (change.effect === "INHERIT") delete next[change.permissionKey];
    else next[change.permissionKey] = change.effect;
  }
  return next;
}

export function selectionState(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): "on" | "off" | "mixed" | "empty" {
  if (keys.length === 0) return "empty";
  const count = keys.filter((key) => selected.has(key)).length;
  if (count === 0) return "off";
  if (count === keys.length) return "on";
  return "mixed";
}
