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
  "561L and SLRB sources are copied to AUTOPART_SALES_ARCHIVE_DIR before deletion. That directory must be a persistent volume outside the application container. Each copy is checked for existence, size, and SHA-256. A missing or mismatched source stops the reset and deletes nothing.",
  "504 and TRM21QC originals are not stored in the imported-sales tables. Staff re-upload the original report from the customer workspace. Emailed copies stay in the Autopart mailbox. When the persistent archive is configured, each report is also copied there by content hash.",
  "Dry-run does not delete rows, copy files, or change the feed switch.",
] as const;

export const IMPORTED_SALES_APPROVAL_GATES = [
  "Take a fresh production backup and restore it to a different database.",
  "Query the restored database and confirm the backup checksum, size, source name, and restore time.",
  "Run bun scripts/imported-sales-reset.ts with no --execute flag and read the before-reset counts.",
  "Run the same command with --execute against the restored copy before production.",
  "Set AB_RESET_CONFIRM to RESET PRELAUNCH IMPORTED SALES, AB_RESET_TARGET to the database name, and AB_RESET_RESTORE_URL to the restored copy.",
  "Pass --backup-proof for that backup. Production database names automotive_brands, automotivebrands, ab_b2b, and postgres also need --allow-production-database.",
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

export const PRODUCTION_DATABASE_NAMES = ["automotive_brands", "automotivebrands", "ab_b2b", "postgres"] as const;

export function isProductionSalesDatabase(name: string): boolean {
  return (PRODUCTION_DATABASE_NAMES as readonly string[]).includes(name);
}

/** Empty or inside the application directory is not a Coolify persistent volume. */
export function persistentSalesArchiveProblem(resolvedDirectory: string, resolvedCwd: string): string | null {
  const directory = resolvedDirectory.trim().replace(/[/\\]+$/, "");
  if (!directory) {
    return "Set AUTOPART_SALES_ARCHIVE_DIR to a Coolify persistent volume outside the application container, for example /data/autopart-imports/sales-reset-archive.";
  }
  const root = resolvedCwd.trim().replace(/[/\\]+$/, "");
  if (directory === root || directory.startsWith(`${root}/`)) {
    return "The sales archive is inside the application directory. Coolify replaces that container, so set AUTOPART_SALES_ARCHIVE_DIR to the mounted persistent volume.";
  }
  return null;
}

export function archivedBytesMatch(input: {
  expectedSha256: string;
  expectedBytes: number;
  actualSha256: string;
  actualBytes: number;
}): boolean {
  return (
    input.expectedBytes === input.actualBytes &&
    input.expectedSha256.toLowerCase() === input.actualSha256.toLowerCase()
  );
}

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
  if (isProductionSalesDatabase(input.actualDatabase) && !input.allowProductionDatabase) {
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
