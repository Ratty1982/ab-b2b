/**
 * Domain constants shared across layers (no I/O).
 */
export const APP_NAME = "Automotive Brands";
export const DEFAULT_CURRENCY = "GBP";
export const DEFAULT_VAT_RATE = 0.2;

/** Public catalogue presentation policy (Phase 0 / ongoing). */
export const PUBLIC_CATALOGUE_POLICY = {
  showRrp: true,
  showTradePrice: false,
  showAvailabilityLabel: true,
  showExactStockQty: false,
} as const;

/** Customer quantity policy. Implementation belongs in Phase 6, not the PDP. */
export const FULL_CASE_ORDERING_POLICY = {
  fullCaseOnly: true,
  customerIncrement: "caseQty",
} as const;
