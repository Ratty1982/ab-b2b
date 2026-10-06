/**
 * Super Admin staff activity — human labels and area classification over AuditEvent.
 *
 * Retention (documented; automated pruning deferred):
 * - Security/auth events: retain with existing AuditEvent policy (long-term operational).
 * - Detailed staff business activity: intended useful window ~12 months.
 * - lastLoginAt / lastActiveAt: current User metadata, retained with the account.
 * Do NOT manually delete AuditEvent rows from the Users → Activity UI.
 */

export type StaffActivityArea =
  | "security"
  | "customers"
  | "crm"
  | "sales"
  | "sales_intelligence"
  | "catalogue"
  | "administration"
  | "other";

export type StaffActivityPeriod = "today" | "7d" | "30d" | "90d" | "custom";

export const STAFF_ACTIVITY_AREAS: Array<{ key: StaffActivityArea | "all"; label: string }> = [
  { key: "all", label: "All areas" },
  { key: "security", label: "Security" },
  { key: "customers", label: "Customers" },
  { key: "crm", label: "CRM" },
  { key: "sales", label: "Sales" },
  { key: "sales_intelligence", label: "Sales Intelligence" },
  { key: "catalogue", label: "Catalogue" },
  { key: "administration", label: "Administration" },
];

export const STAFF_ACTIVITY_PERIODS: Array<{ key: StaffActivityPeriod; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "custom", label: "Custom" },
];

/** Machine action → Super Admin display label. */
const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Logged in",
  LOGIN_FAILED: "Login failed",
  LOGOUT: "Logged out",
  LOGIN_MFA_SUCCESS: "MFA challenge succeeded",
  LOGIN_MFA_FAILED: "MFA challenge failed",
  MFA_CHALLENGE_SUCCESS: "MFA challenge succeeded",
  MFA_CHALLENGE_FAILED: "MFA challenge failed",
  PASSWORD_RESET_REQUESTED: "Password reset requested",
  PASSWORD_RESET_COMPLETED: "Password reset completed",
  USER_PASSWORD_RESET: "Password reset by admin",
  ADMIN_PASSWORD_RESET_REQUESTED: "Admin password reset emailed",
  ACCOUNT_ACTIVATED: "Account activated",
  ACCOUNT_DEACTIVATED: "Account deactivated",
  USER_DEACTIVATED: "Account deactivated",
  USER_REACTIVATED: "Account activated",
  USER_UPDATED: "User updated",
  USER_CREATED: "User created",
  ROLE_ASSIGNED: "Role assigned",
  ROLE_REMOVED: "Role removed",
  ACTING_CONTEXT_STARTED: "Started acting as customer",
  ACTING_CONTEXT_ENDED: "Ended acting as customer",
  "company.created": "Created customer",
  "company.updated": "Updated customer",
  "company.status_changed": "Changed customer status",
  "company.sales_rep_changed": "Changed sales assignment",
  "company.deleted": "Deleted customer",
  "company.autopart_account.verified": "Verified Autopart account",
  "company.autopart_account.linked_verified": "Linked Autopart account",
  "contact.created": "Created contact",
  "contact.updated": "Updated contact",
  "contact.deleted": "Deleted contact",
  "address.created": "Created address",
  "address.updated": "Updated address",
  "address.deleted": "Deleted address",
  "crm.lead.created": "Created lead",
  "crm.lead.updated": "Updated lead",
  "crm.lead.lost": "Marked lead lost",
  "crm.lead.converted": "Converted lead",
  "crm.opportunity.created": "Created opportunity",
  "crm.opportunity.won": "Won opportunity",
  "crm.opportunity.lost": "Lost opportunity",
  "crm.opportunity.stage_changed": "Moved opportunity stage",
  "crm.activity.created": "Logged CRM activity",
  "crm.task.created": "Created CRM task",
  "crm.task.completed": "Completed CRM task",
  "sales_followup.created": "Created follow-up",
  "sales_followup.completed": "Completed follow-up",
  "sales_followup.duplicate_override": "Created follow-up (override)",
  "quote.created": "Created quote",
  "quote.edited": "Updated quote",
  "quote.sent": "Sent quote",
  "quote.resent": "Resent quote",
  "quote.viewed": "Quote viewed",
  "quote.declined": "Quote declined",
  "quote.converted": "Converted quote to order",
  "quote.duplicated": "Duplicated quote",
  "quote.deleted": "Deleted quote",
  "quote.price_override": "Override quote price",
  "order.created": "Created order",
  "order.deleted": "Deleted order",
  "order.autopart_export": "Exported order to Autopart",
  "order.autopart_reexport": "Re-exported order to Autopart",
  "order.autopart_batch_export": "Batch-exported orders to Autopart",
  "order.autopart_504c_import": "Imported 504C despatch",
  "application.under_review": "Reviewed trade application",
  "application.more_info_required": "Requested application info",
  "application.approved": "Approved trade application",
  "application.rejected": "Rejected trade application",
  "application.details_updated": "Updated trade application",
  "si.daily_brief.opened": "Opened Daily Sales Brief",
  "si.portfolio.opened": "Opened portfolio",
  "si.enquiry.opened": "Opened sales enquiry",
  "si.gaps.opened": "Opened gap analysis",
  "si.opportunities.opened": "Opened range opportunities",
  "si.rebate.opened": "Opened rebate analysis",
  "product.updated": "Updated product",
  "product.created": "Created product",
  "pricing.updated": "Updated pricing",
  "document.uploaded": "Uploaded document",
  "document.replaced": "Replaced document",
  "catalogue.document_uploaded": "Safety Data Sheet uploaded",
  "catalogue.document_replaced": "Safety Data Sheet replaced",
  "catalogue.document_archived": "Safety Data Sheet archived",
  "catalogue.sds_marked_not_required": "Marked SDS not required",
  "catalogue.sds_requirement_restored": "Restored SDS requirement",
  "catalogue.sds_coverage_exported": "Exported SDS coverage CSV",
};

const AREA_BY_ACTION: Record<string, StaffActivityArea> = {
  LOGIN_SUCCESS: "security",
  LOGIN_FAILED: "security",
  LOGOUT: "security",
  LOGIN_MFA_SUCCESS: "security",
  LOGIN_MFA_FAILED: "security",
  PASSWORD_RESET_REQUESTED: "security",
  PASSWORD_RESET_COMPLETED: "security",
  USER_PASSWORD_RESET: "security",
  ADMIN_PASSWORD_RESET_REQUESTED: "security",
  ACCOUNT_ACTIVATED: "security",
  ACCOUNT_DEACTIVATED: "security",
  USER_DEACTIVATED: "security",
  USER_REACTIVATED: "security",
  MFA_ENABLED: "security",
  MFA_DISABLED: "security",
  MFA_ENROLLMENT_STARTED: "security",
  "company.created": "customers",
  "company.updated": "customers",
  "company.status_changed": "customers",
  "company.sales_rep_changed": "customers",
  "company.deleted": "customers",
  "company.autopart_account.verified": "customers",
  "company.autopart_account.linked_verified": "customers",
  "contact.created": "customers",
  "contact.updated": "customers",
  "contact.deleted": "customers",
  "address.created": "customers",
  "address.updated": "customers",
  "address.deleted": "customers",
  "customer_group.created": "customers",
  "customer_group.updated": "customers",
  "crm.lead.created": "crm",
  "crm.lead.updated": "crm",
  "crm.lead.lost": "crm",
  "crm.lead.converted": "crm",
  "crm.opportunity.created": "crm",
  "crm.opportunity.won": "crm",
  "crm.opportunity.lost": "crm",
  "crm.opportunity.stage_changed": "crm",
  "crm.activity.created": "crm",
  "crm.task.created": "crm",
  "crm.task.completed": "crm",
  "quote.created": "sales",
  "quote.edited": "sales",
  "quote.sent": "sales",
  "quote.resent": "sales",
  "quote.viewed": "sales",
  "quote.declined": "sales",
  "quote.converted": "sales",
  "quote.duplicated": "sales",
  "quote.deleted": "sales",
  "quote.price_override": "sales",
  "order.created": "sales",
  "order.deleted": "sales",
  "order.autopart_export": "sales",
  "order.autopart_reexport": "sales",
  "order.autopart_batch_export": "sales",
  "order.autopart_504c_import": "sales",
  "application.under_review": "sales",
  "application.more_info_required": "sales",
  "application.approved": "sales",
  "application.rejected": "sales",
  "application.details_updated": "sales",
  "sales_followup.created": "sales_intelligence",
  "sales_followup.completed": "sales_intelligence",
  "sales_followup.duplicate_override": "sales_intelligence",
  "si.daily_brief.opened": "sales_intelligence",
  "si.portfolio.opened": "sales_intelligence",
  "si.enquiry.opened": "sales_intelligence",
  "si.gaps.opened": "sales_intelligence",
  "si.opportunities.opened": "sales_intelligence",
  "si.rebate.opened": "sales_intelligence",
  "product.updated": "catalogue",
  "product.created": "catalogue",
  "pricing.updated": "catalogue",
  "document.uploaded": "catalogue",
  "document.replaced": "catalogue",
  USER_CREATED: "administration",
  USER_UPDATED: "administration",
  ROLE_ASSIGNED: "administration",
  ROLE_REMOVED: "administration",
  ACTING_CONTEXT_STARTED: "administration",
  ACTING_CONTEXT_ENDED: "administration",
};

/** Actions counted as "meaningful business actions" (excludes pure auth noise for the 30d tally). */
export const MEANINGFUL_STAFF_ACTIONS = Object.keys(ACTION_LABELS).filter(
  (action) => AREA_BY_ACTION[action] !== "security" || action.startsWith("ACTING_"),
);

export const SECURITY_STAFF_ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "LOGIN_MFA_SUCCESS",
  "LOGIN_MFA_FAILED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "USER_PASSWORD_RESET",
  "ADMIN_PASSWORD_RESET_REQUESTED",
  "ACCOUNT_ACTIVATED",
  "ACCOUNT_DEACTIVATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "MFA_ENROLLMENT_STARTED",
] as const;

export const LOGIN_SUCCESS_ACTIONS = ["LOGIN_SUCCESS", "LOGIN_MFA_SUCCESS"] as const;

export function staffActivityAreaForAction(action: string): StaffActivityArea {
  if (AREA_BY_ACTION[action]) return AREA_BY_ACTION[action]!;
  if (action.startsWith("si.") || action.startsWith("sales_followup.")) return "sales_intelligence";
  if (action.startsWith("crm.")) return "crm";
  if (action.startsWith("company.") || action.startsWith("contact.") || action.startsWith("address.")) {
    return "customers";
  }
  if (action.startsWith("quote.") || action.startsWith("order.") || action.startsWith("application.")) {
    return "sales";
  }
  if (
    action.startsWith("product.") ||
    action.startsWith("pricing.") ||
    action.startsWith("document.") ||
    action.startsWith("catalogue.") ||
    action.startsWith("stock.")
  ) {
    return "catalogue";
  }
  if (
    action.startsWith("LOGIN") ||
    action.startsWith("LOGOUT") ||
    action.startsWith("PASSWORD") ||
    action.startsWith("MFA") ||
    action.startsWith("ACCOUNT_")
  ) {
    return "security";
  }
  if (action.startsWith("USER_") || action.startsWith("ROLE_") || action.startsWith("ACTING_")) {
    return "administration";
  }
  return "other";
}

export function staffActivityAreaLabel(area: StaffActivityArea | "all"): string {
  return STAFF_ACTIVITY_AREAS.find((row) => row.key === area)?.label ?? area;
}

export function humanStaffActivityAction(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]!;
  return action
    .replace(/^[a-z]+\./, "")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Breakdown categories for the 30-day summary cards. */
export const STAFF_ACTIVITY_BREAKDOWN = [
  {
    key: "followups_created",
    label: "CRM follow-ups created",
    actions: ["sales_followup.created", "sales_followup.duplicate_override", "crm.task.created"],
  },
  {
    key: "followups_completed",
    label: "CRM follow-ups completed",
    actions: ["sales_followup.completed", "crm.task.completed"],
  },
  {
    key: "customers_updated",
    label: "Customers updated",
    actions: ["company.updated", "company.status_changed", "company.sales_rep_changed", "contact.updated"],
  },
  {
    key: "quotes_created",
    label: "Quotes created",
    actions: ["quote.created"],
  },
  {
    key: "orders_created",
    label: "Orders created",
    actions: ["order.created"],
  },
  {
    key: "sales_intelligence",
    label: "Sales Intelligence sessions",
    actions: [
      "si.daily_brief.opened",
      "si.portfolio.opened",
      "si.enquiry.opened",
      "si.gaps.opened",
      "si.opportunities.opened",
      "si.rebate.opened",
    ],
  },
] as const;

export type StaffActivityBreakdownKey = (typeof STAFF_ACTIVITY_BREAKDOWN)[number]["key"];
