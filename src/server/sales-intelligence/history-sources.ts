/**
 * Sales history sources stay separate until a shared transaction identity exists.
 *
 * Dated Sales Enquiry, Gap Analysis, rebates, portfolio, and the daily brief read
 * AutopartSalesLine + AutopartSalesDocument. Those rows carry document dates from
 * historic company 561L/SLRB imports and from ongoing 504 / TRM21QC feeds. AB orders
 * and legacy 504C are already excluded there so an AB order is not counted again
 * when the Autopart invoice arrives. Bounded periods omit documents with no date.
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

export const DATED_SALES_ENQUIRY_SOURCE =
  "Sales Enquiry uses ongoing TRM21QC product lines and 504 invoice headers. Historical 561L and SLRB purchases are not included. An empty result means no ongoing sales are recorded.";

export const GLOBAL_AUTOPART_SALES_SOURCE =
  "Historical 561L invoice lines are no longer a sales source. This screen does not show imported history and does not treat it as complete.";

export const GLOBAL_AUTOPART_SALES_PERIOD = {
  key: "ALL_AVAILABLE_HISTORY" as const,
  label: "Ongoing sales only",
  note: "Imported historical purchases are not included. Use Sales Enquiry for ongoing 504 and TRM21QC documents.",
};

export const HISTORY_OVERLAP_NOTE =
  "Global 561L lines are not added to Sales Enquiry. Ongoing 504 and TRM21QC rows are the supported sales source.";
