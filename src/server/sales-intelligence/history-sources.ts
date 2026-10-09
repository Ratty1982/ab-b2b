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
  "Dated Sales Enquiry uses Autopart sales documents and lines that have invoice dates, including ongoing 504 and TRM21QC feeds.";

export const GLOBAL_AUTOPART_SALES_SOURCE =
  "All Historical Autopart Sales uses undated global 561L invoice lines for Autopart accounts explicitly linked to a CRM company.";

export const GLOBAL_AUTOPART_SALES_PERIOD = {
  key: "ALL_AVAILABLE_HISTORY" as const,
  label: "All Available History",
  note: "Global 561L invoice lines have no reliable invoice date. This is undated source history. It is not used for last 30 days, this month, last year, year on year, monthly trends, or customer inactivity.",
};

export const HISTORY_OVERLAP_NOTE =
  "Global 561L lines are not added to dated Sales Enquiry totals. The same commercial invoice can also exist on a dated company import or a 504 feed, and those tables do not share a transaction identity.";
