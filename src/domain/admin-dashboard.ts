/**
 * Admin Dashboard — pure helpers and real-data-only policy constants.
 *
 * Today's Sales (ordersToday.orderValueIncVat):
 * Sum of `grandTotal` (inc VAT) for B2B orders placed during the current
 * Europe/London civil calendar day, excluding DRAFT and CANCELLED.
 * Count is the matching order count. No trend comparisons are invented.
 */

/** Open (non-terminal) order statuses for operational counts. Excludes DRAFT, DELIVERED, CANCELLED. */
export const DASHBOARD_OPEN_ORDER_STATUSES = [
  "SUBMITTED",
  "CONFIRMED",
  "PICKING",
  "PARTIALLY_DESPATCHED",
  "DISPATCHED",
  "ON_HOLD",
] as const;

/** Orders counted in “Today's Sales” / orders today — placed today, not draft/cancelled. */
export const DASHBOARD_ORDER_VALUE_EXCLUDED_STATUSES = ["DRAFT", "CANCELLED"] as const;

/** Quote statuses treated as open/active for the dashboard card. */
export const DASHBOARD_OPEN_QUOTE_STATUSES = ["DRAFT", "SENT", "VIEWED"] as const;

/** Trade application statuses requiring staff attention. */
export const DASHBOARD_ATTENTION_APPLICATION_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
] as const;

/** Fulfilment states after Autopart CSV export, awaiting 504C / despatch. */
export const DASHBOARD_PROCESSING_ORDER_STATUSES = ["CONFIRMED", "PICKING"] as const;

export const PROTOTYPE_ADMIN_DASHBOARD_STRINGS = [
  "James Whitfield",
  "Priya Nayar",
  "Dee Okafor",
  "Mark Ellison",
  "Rachel Tibbs",
  "Sue Marchant",
  "APP-2026-0409",
  "PM-AUTUMN",
  "Prototype data set",
  "Sales YTD",
  "Open quote value",
  "£1,984,600",
  "£244,250",
  "Mersey Motor Factors",
  "Caldwell Commercials",
  "Penrose Autoparts",
  "Orders held for credit check",
  "Products missing safety data sheets",
] as const;

/**
 * Severity for Needs Attention rows.
 * - critical: operational problem (red)
 * - attention: requires staff action (amber)
 * - info: informational / setup note (neutral/blue)
 */
export type AttentionSeverity = "critical" | "attention" | "info" | "action";

export type AttentionItem = {
  id: string;
  label: string;
  count: number | null;
  href: string;
  severity: AttentionSeverity;
  /** Compact CTA label, e.g. VIEW / REVIEW / FIX */
  actionLabel: string;
};

export type SystemHealthTone =
  | "healthy"
  | "running"
  | "operational"
  | "connected"
  | "attention"
  | "not_configured"
  | "disabled"
  | "no_data";

export type SystemHealthRow = {
  id: string;
  label: string;
  statusLabel: string;
  tone: SystemHealthTone;
  href: string;
};

export type DashboardQuickAction = {
  id: string;
  label: string;
  href: string;
};

export type DashboardGreeting = {
  greeting: "Good morning" | "Good afternoon" | "Good evening";
  displayName: string | null;
  dateLabel: string;
};

export function formatGbpIncVat(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "£0.00";
  const n = Number(amount);
  if (!Number.isFinite(n)) return `£${amount}`;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function stockHealthLabel(input: {
  hasSuccess: boolean;
  status: string | null;
  /** Actionable/fatal issue count — ignored INVALID/DUPLICATE diagnostics must not be included. */
  actionableIssueCount?: number;
  /**
   * @deprecated Ignored for health. Prefer actionableIssueCount.
   * Kept so older call sites compile until updated.
   */
  invalid?: number;
  /** @deprecated Ignored for health. */
  duplicates?: number;
}): "Healthy" | "Attention required" | "No sync yet" {
  if (!input.hasSuccess) return "No sync yet";
  if (input.status === "FAILED") return "Attention required";
  if ((input.actionableIssueCount ?? 0) > 0) return "Attention required";
  return "Healthy";
}

/** Europe/London wall-clock hour (0–23) for greeting. */
export function londonHour(at: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at).find((p) => p.type === "hour")?.value;
  return Number(hour ?? "0");
}

export function greetingForLondonHour(
  hour: number,
): DashboardGreeting["greeting"] {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Prefer first token of display name; never invent a name. */
export function firstNameFromDisplayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

/** Long UK date, e.g. Thursday, 1 October 2026 (Europe/London). */
export function formatLondonLongDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
}

export function buildDashboardGreeting(input: {
  name: string | null | undefined;
  at?: Date;
}): DashboardGreeting {
  const at = input.at ?? new Date();
  return {
    greeting: greetingForLondonHour(londonHour(at)),
    displayName: firstNameFromDisplayName(input.name),
    dateLabel: formatLondonLongDate(at),
  };
}

/** Map attention id → CTA verb. */
export function attentionActionLabel(id: string): string {
  switch (id) {
    case "applications":
      return "REVIEW";
    case "export-blocked":
    case "email-failures":
    case "stock-issues":
    case "504c-not-configured":
      return "FIX";
    case "callbacks":
    case "quotes-expiring":
    case "export-ready":
    default:
      return "VIEW";
  }
}

/** Normalise legacy "action" severity into critical/attention for UI. */
export function resolveAttentionTone(
  severity: AttentionSeverity,
  id: string,
): "critical" | "attention" | "info" {
  if (severity === "critical") return "critical";
  if (severity === "info") return "info";
  if (severity === "attention") return "attention";
  // Legacy "action" — classify by id
  if (id === "export-blocked" || id === "email-failures" || id === "stock-issues") {
    return "critical";
  }
  return "attention";
}

export function emailHealthFromState(input: {
  configured: boolean;
  enabled: boolean;
  recentFailures: number;
}): { statusLabel: string; tone: SystemHealthTone } {
  if (input.recentFailures > 0) {
    return { statusLabel: "Failures", tone: "attention" };
  }
  if (!input.configured) {
    return { statusLabel: "Not configured", tone: "not_configured" };
  }
  if (!input.enabled) {
    return { statusLabel: "Disabled", tone: "disabled" };
  }
  return { statusLabel: "Operational", tone: "operational" };
}

export function feed504cHealthFromState(input: {
  configured: boolean;
  enabled: boolean;
  statusLabel: string;
}): { statusLabel: string; tone: SystemHealthTone } {
  if (!input.configured) {
    return { statusLabel: "Not configured", tone: "not_configured" };
  }
  if (!input.enabled || input.statusLabel === "DISABLED") {
    return { statusLabel: "Disabled", tone: "disabled" };
  }
  return { statusLabel: "Running", tone: "running" };
}

export function stockHealthTone(
  statusLabel: "Healthy" | "Attention required" | "No sync yet",
): SystemHealthTone {
  if (statusLabel === "Healthy") return "healthy";
  if (statusLabel === "Attention required") return "attention";
  return "no_data";
}

/**
 * Ongoing sales feed health from freshness/settings only.
 * Never "Healthy" merely because configured — requires a successful import.
 */
export function ongoingSalesHealthFromState(input: {
  configured: boolean;
  enabled: boolean;
  salesDataUpdatedAt: string | null;
  feedsAligned: boolean;
}): { statusLabel: string; tone: SystemHealthTone } {
  if (!input.configured) {
    return { statusLabel: "Not configured", tone: "not_configured" };
  }
  if (!input.salesDataUpdatedAt) {
    return { statusLabel: "No data yet", tone: "no_data" };
  }
  if (!input.feedsAligned) {
    return { statusLabel: "Attention", tone: "attention" };
  }
  if (!input.enabled) {
    return { statusLabel: "Idle", tone: "disabled" };
  }
  return { statusLabel: "Healthy", tone: "healthy" };
}

/**
 * SharePoint SDS — Connected only when Graph credentials, folder resolution,
 * and a successful connection test are all true.
 */
export function sharePointSdsHealthFromState(input: {
  configured: boolean;
  connected: boolean;
  lastConnectionTestOk: boolean | null;
}): { statusLabel: string; tone: SystemHealthTone } {
  if (!input.configured) {
    return { statusLabel: "Not configured", tone: "not_configured" };
  }
  if (input.connected) {
    return { statusLabel: "Connected", tone: "connected" };
  }
  if (input.lastConnectionTestOk === false) {
    return { statusLabel: "Connection failed", tone: "attention" };
  }
  return { statusLabel: "Not verified", tone: "no_data" };
}
