/**
 * Gates for the one-time pre-launch wipe of imported Autopart sales.
 *
 * Historical 561L/SLRB and ongoing 504/TRM21QC rows are both removed.
 * Customers, prices, stock, orders, and configuration stay.
 * Dry-run is the default. Execute is refused until backup, restore, database
 * name, and the confirmation phrase all pass.
 */

import {
  validateBackupProof,
  type BackupProof,
} from "@/domain/customer-data-reset";

export type { BackupProof };

export const IMPORTED_SALES_RESET_CONFIRMATION = "RESET PRELAUNCH IMPORTED SALES";

export const IMPORTED_SALES_PRESERVED = [
  { name: "Company, Contact, Address, Active customers and prospects", reason: "The customer master stays, including every Active and Prospect company." },
  { name: "AutopartAccount", reason: "407EXP master accounts and customer mappings stay." },
  { name: "AutopartCustomerAccountAlias and Company.autopartCustomerCode", reason: "Verified Autopart IDs and aliases stay." },
  { name: "CustomerPrice, PriceList, Product, Supplier, Inventory", reason: "Pricing, catalogue, suppliers, and stock stay." },
  { name: "User, Role, Permission", reason: "Staff, authentication, and permissions stay." },
  { name: "Order, OrderItem, Invoice, OrderStockReservation, OrderFulfilmentEvent", reason: "Legitimate B2B orders, invoices, fulfilment, and stock reservations stay." },
  { name: "Autopart504cImportRun", reason: "Operational invoices can point at a 504C run. Those runs are not imported sales documents." },
  { name: "AutopartImportBatch of kind CUSTOMER_MASTER", reason: "Customer-master import history is not a sales dataset." },
  { name: "CMS, configuration, and AuditEvent", reason: "Site content and audit history stay." },
] as const;

export const IMPORTED_SALES_REMOVED = [
  { name: "AutopartSalesDocument", reason: "Every imported invoice, credit, payment, and unmatched header, including historical 561L/SLRB and ongoing 504/TRM21QC." },
  { name: "AutopartSalesLine", reason: "Every imported product line, historical and ongoing." },
  { name: "AutopartCustomerImportRun and AutopartImportDiagnostic", reason: "Historical and ongoing sales import runs, diagnostics, and processing state." },
  { name: "AutopartHistoryAllImport and its staged documents, lines, reviews, and gaps", reason: "Obsolete historical staging. Original report bytes are copied to the archive first." },
  { name: "AutopartInvoiceLine, AutopartLedgerTransaction, AutopartDocumentMatch", reason: "Bulk historical sales and ledger copies." },
  { name: "AutopartImportBatch of kind INVOICE_LINES or LEDGER, and their issues", reason: "Sales import batches only. Customer-master batches stay." },
  { name: "StockEmailReceipt keys beginning ongoing-hash:", reason: "Duplicate-detection receipts that would block a clean 504/TRM21QC reimport. Other mailbox receipts stay." },
  { name: "CustomerSalesCutover", reason: "Cutover state is cleared so history must be imported again before ongoing sales are stored." },
] as const;

export const IMPORTED_SALES_EFFECTS = [
  "B2B orders, invoices, fulfilment events, and stock reservations are not deleted or changed.",
  "A sales document that names an AB order is removed. The order, its items, and its fulfilment events stay.",
  "Customer prices, products, suppliers, warehouse stock, and purchasing settings stay.",
  "Automatic 504/TRM21QC importing is switched off during execute and is left off.",
  "Original 561L, SLRB, and sales-batch files are copied to the archive before their database rows are deleted. The archive is not deleted.",
  "Dry-run does not delete rows, copy files, or change the feed switch.",
] as const;

export const IMPORTED_SALES_APPROVAL_GATES = [
  "Take a fresh production backup and restore it to a different database.",
  "Query the restored database and confirm the backup checksum, size, source name, and restore time.",
  "Run bun scripts/imported-sales-reset.ts with no --execute flag and read the before-reset counts.",
  "Run the same command with --execute against the restored copy before production.",
  "Set AB_RESET_CONFIRM to RESET PRELAUNCH IMPORTED SALES, AB_RESET_TARGET to the database name, and AB_RESET_RESTORE_URL to the restored copy.",
  "Pass --backup-proof for that backup. A production database also needs --allow-production-database.",
  "The command refuses to run during deploy, container startup, or a package lifecycle script.",
  "After execute, confirm imported-sales counts are zero, protected counts are unchanged, and the ongoing feed is off.",
  "Rebuild each Active customer from Import Sales History, then catch up 504/TRM21QC. Do not turn automatic importing back on as part of the reset.",
] as const;

export type ImportedSalesResetGateInput = {
  executeRequested: boolean;
  confirmation: string | null;
  targetDatabase: string | null;
  actualDatabase: string | null;
  backupProof: BackupProof | null;
  restoreCheckOk: boolean;
  duringBootstrap?: boolean;
  /** Required when the connected database is the production name. */
  allowProductionDatabase?: boolean;
  now?: Date;
};

export type ImportedSalesResetGateResult =
  | { ok: true; mode: "dry-run" | "execute" }
  | { ok: false; mode: "dry-run" | "execute"; reason: string };

const PRODUCTION_DATABASE_NAMES = new Set(["automotive_brands", "ab_b2b", "postgres"]);

export function evaluateImportedSalesResetGates(
  input: ImportedSalesResetGateInput,
): ImportedSalesResetGateResult {
  const mode = input.executeRequested ? "execute" : "dry-run";
  if (input.duringBootstrap) {
    return {
      ok: false,
      mode,
      reason: "The reset cannot run during deployment, container startup, or a package lifecycle script.",
    };
  }
  if (!input.executeRequested) return { ok: true, mode: "dry-run" };
  if (input.confirmation !== IMPORTED_SALES_RESET_CONFIRMATION) {
    return { ok: false, mode, reason: "Typed confirmation does not match." };
  }
  if (!input.actualDatabase) {
    return { ok: false, mode, reason: "The database name could not be read." };
  }
  if (!input.targetDatabase || input.targetDatabase !== input.actualDatabase) {
    return {
      ok: false,
      mode,
      reason: "The database name you typed does not match the database this command is connected to.",
    };
  }
  if (PRODUCTION_DATABASE_NAMES.has(input.actualDatabase) && !input.allowProductionDatabase) {
    return {
      ok: false,
      mode,
      reason: "This database name is treated as production. Pass --allow-production-database only after the backup and restore have been checked.",
    };
  }
  if (!input.backupProof) {
    return { ok: false, mode, reason: "A verified backup and test restore are required." };
  }
  const proof = validateBackupProof(input.backupProof, input.now ?? new Date());
  if (!proof.ok) return { ok: false, mode, reason: proof.reason };
  if (input.backupProof.sourceDatabase !== input.actualDatabase) {
    return { ok: false, mode, reason: "The backup proof is for a different database." };
  }
  if (!input.restoreCheckOk) {
    return { ok: false, mode, reason: "The restored database did not answer a test query." };
  }
  return { ok: true, mode: "execute" };
}

export function salesArchiveDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["AUTOPART_SALES_ARCHIVE_DIR"]?.trim();
  if (configured) return configured;
  return "var/autopart-sales-archive";
}
