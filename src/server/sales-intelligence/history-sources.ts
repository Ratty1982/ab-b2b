/**
 * Sales history sources stay separate until a shared transaction identity exists.
 *
 * Sales Enquiry, Gap Analysis, and rebates read per-customer 561L product lines and
 * ongoing TRM21QC lines. The invoice date is the linked document date, usually from
 * SLRB. Bounded periods omit documents with no date. All Time keeps those rows and
 * does not invent a date. AB orders and legacy 504C stay excluded.
 *
 * All Historical Autopart Sales reads AutopartInvoiceLine only. Those global 561L
 * lines have no reliable invoice date. Upload time and ledger transaction dates are
 * not invoice dates. The lines are included only for Autopart accounts with an
 * explicit companyId link.
 *
 * AutopartLedgerTransaction is not turnover. Payments, receipts, and running
 * balances are not product sales.
 *
 * A commercial invoice can exist in both the global 561L table and the dated
 * company or 504 tables. The natural keys differ (source identity versus
 * company, document, and line). Do not add those tables together.
 */

export const ONGOING_SALES_DATA_SOURCE =
  "Per-customer 561L product lines and ongoing TRM21QC product lines. The same invoice is counted once. SLRB payments and ledger balances are not sales. Retired global invoice files, AB Orders, and retired 504C feeds are not included.";

export const DATED_SALES_ENQUIRY_SOURCE =
  "Sales Enquiry uses per-customer 561L product lines, dated from the imported document when a date exists, and ongoing TRM21QC product lines. Undated history appears in All Time only. An empty result means no counted product sales are recorded.";

export const GLOBAL_AUTOPART_SALES_SOURCE =
  "Historical 561L invoice lines are no longer a sales source. This screen does not show imported history and does not treat it as complete.";

export const GLOBAL_AUTOPART_SALES_PERIOD = {
  key: "ALL_AVAILABLE_HISTORY" as const,
  label: "Ongoing sales only",
  note: "Imported historical purchases are not included. Use Sales Enquiry for ongoing 504 and TRM21QC documents.",
};

export const HISTORY_OVERLAP_NOTE =
  "When imported 561L and TRM21QC describe the same invoice, Sales Enquiry counts one copy. Retired global invoice files are not added.";
