/**
 * Sales Intelligence → CRM follow-up bridge.
 *
 * Human-initiated only. Reuses the existing CRM Task model with an additive
 * source-context snapshot. No automatic leads/opportunities/emails.
 */

export const SI_FOLLOWUP_SOURCE_MODULES = [
  "SALES_ENQUIRY",
  "GAP_ANALYSIS",
  "RANGE_OPPORTUNITY",
  "REBATE_ANALYSIS",
  "PORTFOLIO",
] as const;

export type SiFollowupSourceModule = (typeof SI_FOLLOWUP_SOURCE_MODULES)[number];

export const SI_FOLLOWUP_REASONS = [
  "STOPPED",
  "DECREASED",
  "INCREASED",
  "NEW",
  "RANGE_GAP",
  "NET_SPEND_REVIEW",
  "CUSTOMER",
  "PRODUCT",
  "PURCHASE_GAP",
  "DORMANT",
  "DECLINING",
  "CROSS_SELL",
] as const;

export type SiFollowupReason = (typeof SI_FOLLOWUP_REASONS)[number];

export type SiFollowupDuePreset = "TODAY" | "TOMORROW" | "IN_3_DAYS" | "IN_1_WEEK" | "CUSTOM";

export type SiFollowupSnapshot = {
  sourceModule: SiFollowupSourceModule;
  sourceReason: SiFollowupReason;
  companyId: string;
  companyName: string;
  autopartCustomerCode: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  brandName: string | null;
  categoryName: string | null;
  historicOnly: boolean;
  productKindLabel?: string | null;
  selectedPeriod: { from: string | null; to: string | null; label: string };
  comparisonPeriod: { from: string | null; to: string | null; label: string } | null;
  metrics: Record<string, string | number | null>;
  deepLinkPath: string;
  capturedAt: string;
};

export function isSiFollowupSourceModule(v: unknown): v is SiFollowupSourceModule {
  return typeof v === "string" && (SI_FOLLOWUP_SOURCE_MODULES as readonly string[]).includes(v);
}

export function isSiFollowupReason(v: unknown): v is SiFollowupReason {
  return typeof v === "string" && (SI_FOLLOWUP_REASONS as readonly string[]).includes(v);
}

export function siFollowupSourceLabel(module: SiFollowupSourceModule): string {
  switch (module) {
    case "SALES_ENQUIRY":
      return "Sales Enquiry";
    case "GAP_ANALYSIS":
      return "Gap Analysis";
    case "RANGE_OPPORTUNITY":
      return "Range Opportunity";
    case "REBATE_ANALYSIS":
      return "Rebate Analysis";
    case "PORTFOLIO":
      return "Sales Rep Portfolio";
  }
}

export function siFollowupReasonLabel(reason: SiFollowupReason): string {
  switch (reason) {
    case "STOPPED":
      return "Stopped Buying";
    case "DECREASED":
      return "Decreased";
    case "INCREASED":
      return "Increased";
    case "NEW":
      return "New";
    case "RANGE_GAP":
      return "Range Opportunity";
    case "NET_SPEND_REVIEW":
      return "Net Spend Review";
    case "CUSTOMER":
      return "Customer follow-up";
    case "PRODUCT":
      return "Product follow-up";
    case "PURCHASE_GAP":
      return "Purchasing gap";
    case "DORMANT":
      return "Dormant customer";
    case "DECLINING":
      return "Sales decline";
    case "CROSS_SELL":
      return "Cross-sell opportunity";
  }
}

export function defaultFollowupSubject(input: {
  reason: SiFollowupReason;
  productName?: string | null;
  sku?: string | null;
  companyName?: string | null;
}): string {
  const product = (input.productName || input.sku || "").trim();
  switch (input.reason) {
    case "STOPPED":
    case "DECREASED":
    case "INCREASED":
    case "NEW":
    case "PRODUCT":
      return product ? `Follow up — ${product}` : "Follow up";
    case "RANGE_GAP":
      return product ? `Range opportunity — ${product}` : "Range opportunity follow-up";
    case "NET_SPEND_REVIEW":
      return input.companyName
        ? `Net spend review — ${input.companyName}`
        : "Net spend review";
    case "CUSTOMER":
      return input.companyName ? `Follow up — ${input.companyName}` : "Follow up";
    case "PURCHASE_GAP":
      return "Follow up — purchasing gap";
    case "DORMANT":
      return "Follow up — dormant customer";
    case "DECLINING":
      return "Follow up — sales decline";
    case "CROSS_SELL":
      return product ? `Follow up — range opportunity (${product})` : "Follow up — range opportunity";
  }
}

/** Europe/London date-only → dueAt Date at UTC noon (date-only convention). */
export function dueAtFromDateOnly(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function resolveFollowupDueDate(input: {
  preset: SiFollowupDuePreset;
  customDate?: string | null;
  today: string;
}): string {
  switch (input.preset) {
    case "TODAY":
      return input.today;
    case "TOMORROW":
      return addDaysIso(input.today, 1);
    case "IN_3_DAYS":
      return addDaysIso(input.today, 3);
    case "IN_1_WEEK":
      return addDaysIso(input.today, 7);
    case "CUSTOM": {
      const c = input.customDate?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c)) {
        throw new Error("Custom due date is required (YYYY-MM-DD).");
      }
      return c;
    }
  }
}

export function formatFollowupDescription(snapshot: SiFollowupSnapshot, notes?: string | null): string {
  const lines = [
    `Source: Sales Intelligence · ${siFollowupSourceLabel(snapshot.sourceModule)}`,
    `Reason: ${siFollowupReasonLabel(snapshot.sourceReason)}`,
    `Customer: ${snapshot.companyName}`,
  ];
  if (snapshot.productName || snapshot.sku) {
    lines.push(`Product: ${snapshot.productName ?? snapshot.sku}${snapshot.sku ? ` (${snapshot.sku})` : ""}`);
  }
  lines.push(`Period: ${snapshot.selectedPeriod.label}`);
  if (snapshot.comparisonPeriod) {
    lines.push(`Comparison: ${snapshot.comparisonPeriod.label}`);
  }
  for (const [k, v] of Object.entries(snapshot.metrics)) {
    if (v == null || v === "") continue;
    lines.push(`${k}: ${v}`);
  }
  if (notes?.trim()) {
    lines.push("", "Notes:", notes.trim());
  }
  return lines.join("\n");
}
