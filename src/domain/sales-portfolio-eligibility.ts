/**
 * Sales Rep Portfolio — eligible customer population.
 *
 * Company.status must be ACTIVE for every portfolio path.
 * Trade vs retail/internal uses AutopartAccount.classification only
 * (407EXP master import). Company names are never used to infer type.
 *
 * Mapping (existing AutopartAccountClassification):
 * - RETAIL_INTERNAL: INTERNAL | CASH | STAFF
 *   (INTERNAL covers Amazon/FBA/Automotive Brands house accounts from 407EXP rules)
 * - TRADE: ACTIVE companies with no linked AutopartAccount classification in
 *   PORTFOLIO_TRADE_EXCLUDED_CLASSIFICATIONS
 *   (excludes INTERNAL/CASH/STAFF and OBSOLETE/DO_NOT_USE; keeps TRADE_CANDIDATE /
 *   REQUIRES_REVIEW / UNIDENTIFIED, and ACTIVE companies with no AutopartAccount
 *   row yet — e.g. newly activated trade customers)
 * - ALL: every ACTIVE company in CRM/RBAC scope (still excludes non-ACTIVE statuses)
 *
 * OBSOLETE / DO_NOT_USE are excluded from TRADE and from RETAIL_INTERNAL; they only
 * appear under ALL when Company.status is ACTIVE.
 *
 * Pure helper and Prisma selection MUST use the same classification sets below.
 */

import type { AutopartAccountClassification } from "@prisma/client";

export type PortfolioAccountClass = "TRADE" | "RETAIL_INTERNAL" | "ALL";

/** Autopart classifications treated as retail / internal / non-trade house accounts. */
export const PORTFOLIO_RETAIL_INTERNAL_CLASSIFICATIONS = [
  "INTERNAL",
  "CASH",
  "STAFF",
] as const satisfies readonly AutopartAccountClassification[];

/**
 * Autopart classifications that disqualify a company from the TRADE portfolio view.
 * Includes retail/internal house accounts plus obsolete / do-not-use codes.
 */
export const PORTFOLIO_TRADE_EXCLUDED_CLASSIFICATIONS = [
  "INTERNAL",
  "CASH",
  "STAFF",
  "OBSOLETE",
  "DO_NOT_USE",
] as const satisfies readonly AutopartAccountClassification[];

export const PORTFOLIO_ACCOUNT_CLASS_DEFAULT: PortfolioAccountClass = "TRADE";

export const PORTFOLIO_ACCOUNT_CLASS_OPTIONS: Array<{
  value: PortfolioAccountClass;
  label: string;
}> = [
  { value: "TRADE", label: "Trade customers" },
  { value: "RETAIL_INTERNAL", label: "Retail / internal accounts" },
  { value: "ALL", label: "All active accounts" },
];

export function parsePortfolioAccountClass(raw: unknown): PortfolioAccountClass {
  if (raw === "TRADE" || raw === "RETAIL_INTERNAL" || raw === "ALL") return raw;
  return PORTFOLIO_ACCOUNT_CLASS_DEFAULT;
}

export function isRetailInternalAutopartClassification(
  classification: AutopartAccountClassification | null | undefined,
): boolean {
  if (!classification) return false;
  return (PORTFOLIO_RETAIL_INTERNAL_CLASSIFICATIONS as readonly string[]).includes(classification);
}

export function isTradeExcludedAutopartClassification(
  classification: AutopartAccountClassification | null | undefined,
): boolean {
  if (!classification) return false;
  return (PORTFOLIO_TRADE_EXCLUDED_CLASSIFICATIONS as readonly string[]).includes(classification);
}

/**
 * Pure eligibility check once Company.status and linked Autopart classifications are known.
 * `linkedClassifications` empty means no AutopartAccount rows for the company.
 * Must stay equivalent to the Prisma filter in selectEligiblePortfolioCompanyIds.
 */
export function companyMatchesPortfolioAccountClass(input: {
  companyStatus: string;
  accountClass: PortfolioAccountClass;
  linkedClassifications: readonly AutopartAccountClassification[];
}): boolean {
  if (input.companyStatus !== "ACTIVE") return false;
  if (input.accountClass === "ALL") return true;
  const hasRetailInternal = input.linkedClassifications.some((c) =>
    isRetailInternalAutopartClassification(c),
  );
  if (input.accountClass === "RETAIL_INTERNAL") return hasRetailInternal;
  // TRADE — exclude retail/internal and obsolete/do-not-use Autopart links; keep unlinked ACTIVE.
  const hasTradeExcluded = input.linkedClassifications.some((c) =>
    isTradeExcludedAutopartClassification(c),
  );
  return !hasTradeExcluded;
}

export const PORTFOLIO_ELIGIBILITY_METHODOLOGY =
  "Portfolio includes Company.status = ACTIVE only (prospects, pending, on-hold, suspended, and closed are excluded). Trade vs retail/internal uses AutopartAccount.classification from the 407EXP master (INTERNAL/CASH/STAFF = retail/internal; OBSOLETE/DO_NOT_USE are excluded from trade; otherwise trade, including ACTIVE companies with no AutopartAccount yet). Company names are never used to classify accounts. Active customers with zero sales in the period remain listed; dormant requires invoice cadence history and is never applied without it.";
