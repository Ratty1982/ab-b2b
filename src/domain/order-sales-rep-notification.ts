/**
 * Pure helpers for including the assigned sales representative
 * in ORDER_RECEIVED_INTERNAL recipient sets.
 */

import { emailAddressSchema, normalizeRecipientList } from "@/domain/email-settings";

export type OrderSalesRepNotificationSkipReason =
  | "no_sales_rep_snapshot"
  | "sales_rep_not_found"
  | "sales_rep_inactive"
  | "user_inactive"
  | "email_unusable";

export type OrderSalesRepNotificationResolveResult =
  | { ok: true; email: string; salesRepId: string; displayName: string }
  | { ok: false; reason: OrderSalesRepNotificationSkipReason };

/** Normalise a single address for recipient sets / idempotency keys. */
export function normalizeOrderNotificationEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const parsed = emailAddressSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Merge configured internal recipients with the assigned sales-rep email.
 * Case-insensitive; preserves configured order; sales-rep appended when new.
 */
export function mergeOrderInternalNotificationRecipients(
  configuredRecipients: unknown,
  salesRepEmail: string | null | undefined,
): string[] {
  const base = normalizeRecipientList(
    Array.isArray(configuredRecipients)
      ? configuredRecipients
      : typeof configuredRecipients === "string" && configuredRecipients.trim()
        ? [configuredRecipients]
        : [],
  );
  const seen = new Set(base);
  const rep = normalizeOrderNotificationEmail(salesRepEmail);
  if (rep && !seen.has(rep)) {
    base.push(rep);
    seen.add(rep);
  }
  return base;
}

export function orderReceivedInternalIdempotencyKey(orderId: string, email: string): string {
  const normalised = normalizeOrderNotificationEmail(email) ?? email.trim().toLowerCase();
  return `ORDER_RECEIVED_INTERNAL:${orderId}:${normalised}`;
}

export function orderPlacedByLabel(input: {
  placedByStaffName: string | null | undefined;
  placedByStaffUserId?: string | null | undefined;
}): string {
  const name = input.placedByStaffName?.trim();
  if (name) return `Internal staff (${name})`;
  if (input.placedByStaffUserId) return "Internal staff";
  return "Customer (B2B portal)";
}

export function classifySalesRepNotificationCandidate(input: {
  salesRepIdSnapshot: string | null | undefined;
  salesRep: {
    id: string;
    active: boolean;
    displayName: string | null;
    businessEmail: string | null;
    user: { name: string | null; email: string; status: string };
  } | null;
}): OrderSalesRepNotificationResolveResult {
  if (!input.salesRepIdSnapshot) {
    return { ok: false, reason: "no_sales_rep_snapshot" };
  }
  if (!input.salesRep) {
    return { ok: false, reason: "sales_rep_not_found" };
  }
  if (!input.salesRep.active) {
    return { ok: false, reason: "sales_rep_inactive" };
  }
  if (input.salesRep.user.status !== "ACTIVE") {
    return { ok: false, reason: "user_inactive" };
  }
  const email =
    normalizeOrderNotificationEmail(input.salesRep.businessEmail) ??
    normalizeOrderNotificationEmail(input.salesRep.user.email);
  if (!email) {
    return { ok: false, reason: "email_unusable" };
  }
  const displayName =
    input.salesRep.displayName?.trim() || input.salesRep.user.name?.trim() || email;
  return {
    ok: true,
    email,
    salesRepId: input.salesRep.id,
    displayName,
  };
}
