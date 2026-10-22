/**
 * Customer-workspace sales import accepts ongoing 504 and TRM21QC reports only.
 * Historical 561L and SLRB files stay retired and are not parsed into sales.
 */

import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";

export type CustomerSalesScope = {
  companyId: string;
  /** Normalised account codes the operator selected for this customer. */
  accountCodes: string[];
};

export type CustomerSalesReportKind = "504" | "TRM21QC" | "HISTORICAL_561L_SLRB" | "UNKNOWN";

export const CUSTOMER_SALES_SOURCE_ASSESSMENT =
  "Customer sales are rebuilt from ongoing 504 invoice and credit reports and TRM21QC product lines. A 504 row is kept only when its AB order, or an existing document, already belongs to the selected customer. A TRM21QC row is kept only when its customer code is the selected verified account. Historical 561L and SLRB files are rejected, and the retired global historical importer is not used.";

export const CUSTOMER_SALES_IMPORT_EFFECTS = [
  "Does not run 504/TRM fulfilment.",
  "Does not change stock or reservations.",
  "Does not send customer email.",
  "Does not create or alter B2B orders, invoices, or payments.",
] as const;

export function classifyCustomerSalesReport(text: string): CustomerSalesReportKind {
  if (isAutopart504Report(text)) return "504";
  if (isAutopartTrm21qcReport(text)) return "TRM21QC";
  const sample = text.replace(/^\uFEFF/, "").slice(0, 8000).toUpperCase();
  if (
    /\b561L\b/.test(sample) ||
    sample.includes("CUSTOMER SALES FOR PART NUMBERS") ||
    /\bSLRB\b/.test(sample) ||
    sample.includes("SALES LEDGER")
  ) {
    return "HISTORICAL_561L_SLRB";
  }
  return "UNKNOWN";
}

export function accountInCustomerScope(account: string, scope: CustomerSalesScope): boolean {
  const key = account.trim().toUpperCase();
  if (!key) return false;
  return scope.accountCodes.some((code) => code.trim().toUpperCase() === key);
}
