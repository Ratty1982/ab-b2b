/**
 * CRM domain helpers — labels, sources, stages, money display.
 * No demo data. Opportunity value is a salesperson estimate unless a linked quote is shown separately.
 */

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONVERTED",
] as const;
export type CrmLeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  "TRADE_APPLICATION",
  "WEBSITE",
  "PHONE",
  "EMAIL",
  "REFERRAL",
  "SALES_REP",
  "TRADE_SHOW",
  "MOTORSPORT_PARTNERSHIP",
  "CALLBACK",
  "OTHER",
] as const;

export const LEAD_LOST_REASONS = [
  "No response",
  "Not suitable",
  "Not interested",
  "Duplicate",
  "Other",
] as const;

/** Preserve existing OpportunityStage enum; active pipeline excludes WON/LOST. */
export const OPPORTUNITY_STAGES = [
  "NEW_LEAD",
  "QUALIFIED",
  "CONTACTED",
  "MEETING",
  "QUOTE_REQUIRED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type CrmOpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPEN_OPPORTUNITY_STAGES = OPPORTUNITY_STAGES.filter(
  (s) => s !== "WON" && s !== "LOST",
);

export const OPPORTUNITY_LOST_REASONS = [
  "No response",
  "Price",
  "Competitor",
  "Not ready",
  "Not suitable",
  "Other",
] as const;

export const CALL_OUTCOMES = [
  "Connected",
  "No Answer",
  "Left Message",
  "Follow Up Required",
  "Other",
] as const;

export const TASK_TYPES = ["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "GENERAL"] as const;
export type CrmTaskType = (typeof TASK_TYPES)[number];

export function leadStatusLabel(status: string): string {
  switch (status) {
    case "NEW":
      return "New";
    case "CONTACTED":
      return "Contacted";
    case "QUALIFIED":
      return "Qualified";
    case "DISQUALIFIED":
      return "Lost";
    case "CONVERTED":
      return "Converted";
    default:
      return status;
  }
}

export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  switch (source) {
    case "TRADE_APPLICATION":
      return "Trade Application";
    case "WEBSITE":
      return "Website";
    case "PHONE":
      return "Phone";
    case "EMAIL":
      return "Email";
    case "REFERRAL":
      return "Referral";
    case "SALES_REP":
      return "Sales Rep";
    case "TRADE_SHOW":
      return "Trade Show";
    case "MOTORSPORT_PARTNERSHIP":
      return "Motorsport";
    case "CALLBACK":
      return "Callback";
    case "OTHER":
      return "Other";
    default:
      return source;
  }
}

export function opportunityStageLabel(stage: string): string {
  switch (stage) {
    case "NEW_LEAD":
      return "Identified";
    case "QUALIFIED":
      return "Qualified";
    case "CONTACTED":
      return "Contacted";
    case "MEETING":
      return "Meeting";
    case "QUOTE_REQUIRED":
      return "Quote required";
    case "QUOTE_SENT":
      return "Quote sent";
    case "NEGOTIATION":
      return "Negotiation";
    case "WON":
      return "Won";
    case "LOST":
      return "Lost";
    default:
      return stage;
  }
}

export function activityTypeLabel(type: string): string {
  switch (type) {
    case "CALL":
      return "Call";
    case "EMAIL":
      return "Email logged";
    case "MEETING":
      return "Meeting";
    case "VISIT":
      return "Visit";
    case "NOTE":
      return "Note";
    case "TASK":
      return "Task";
    case "FOLLOW_UP":
      return "Follow-up";
    case "SYSTEM":
      return "System";
    case "CALLBACK_REQUEST":
      return "Callback";
    default:
      return type;
  }
}

export function taskTypeLabel(type: string | null | undefined): string {
  if (!type) return "General";
  switch (type) {
    case "CALL":
      return "Call";
    case "EMAIL":
      return "Email";
    case "MEETING":
      return "Meeting";
    case "FOLLOW_UP":
      return "Follow-up";
    case "GENERAL":
      return "General";
    default:
      return type;
  }
}

/** Format optional opportunity estimate — never invent £0 for null. */
export function formatOpportunityValue(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatGbpExact(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
