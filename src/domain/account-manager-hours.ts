/**
 * Shared account-manager / trade desk hours for portal Support and public Contact.
 * Keep a single source so weekday hours and cut-offs cannot drift.
 */
export const ACCOUNT_MANAGER_HOURS = {
  heading: "Account manager hours",
  /** Full weekday line used on the portal Support card. */
  weekdayLine: "Monday to Friday · 08:00 – 16:00",
  /** Compact weekday label used on the public Contact teams list. */
  weekdayCompact: "Mon–Fri 08:00–16:00",
  /** Same-day order cut-off line (Support card). */
  orderCutoffLine: "Same-day order cut-off · 13:00",
} as const;

/** Ordered body lines for the Support hours card (no Saturday). */
export const ACCOUNT_MANAGER_HOURS_LINES = [
  ACCOUNT_MANAGER_HOURS.weekdayLine,
  ACCOUNT_MANAGER_HOURS.orderCutoffLine,
] as const;
