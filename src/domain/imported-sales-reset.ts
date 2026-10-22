/**
 * Gates for removing imported ongoing Autopart sales so they can be rebuilt
 * from customer-scoped 504 and TRM21QC files.
 *
 * This is not the historical sales cleanup. Historical 561L and SLRB rows stay.
 * Documents in the outstanding 504 financial-recovery window stay.
 * Dry-run is the default. Execute is refused until backup, restore, database
 * name, and the confirmation phrase all pass.
 */

import {
  validateBackupProof,
  type BackupProof,
} from "@/domain/customer-data-reset";

export type { BackupProof };

export const IMPORTED_SALES_RESET_CONFIRMATION = "RESET IMPORTED AUTOPART SALES";

/** 504 headers in this window are the outstanding financial recovery population. */
export const IMPORTED_SALES_RECOVERY_WINDOW = {
  from: "2026-10-06",
  to: "2026-10-19",
  affectedDocuments: 123,
} as const;

export const IMPORTED_SALES_PRESERVED = [
  { name: "Company, Contact, Address, prospect and portal users", reason: "Customers and prospects stay." },
  { name: "AutopartAccount", reason: "407EXP master accounts stay." },
  { name: "AutopartCustomerAccountAlias and Company.autopartCustomerCode", reason: "Verified account mappings stay." },
  { name: "CustomerPrice, PriceList, Product, Inventory", reason: "Pricing, catalogue, and stock stay." },
  { name: "User, Role, Permission", reason: "Staff and permissions stay." },
  { name: "Order, OrderItem, Invoice, OrderStockReservation, OrderFulfilmentEvent", reason: "Legitimate B2B orders, invoices, fulfilment, and stock reservations stay." },
  { name: "AutopartSalesDocument with has504 and a date in the 504 recovery window", reason: "Outstanding 504 financial recovery. These headers are not rebuilt by deleting them." },
  { name: "Product lines and import runs attached to those recovery documents", reason: "The recovery still needs the stored document, its lines, and the import audit." },
  { name: "Historical 561L and SLRB documents, lines, and runs", reason: "No customer reimport path exists for those retired files, so this reset does not delete them." },
] as const;

export const IMPORTED_SALES_REMOVED = [
  { name: "Ongoing AutopartSalesDocument outside the 504 recovery window", reason: "504 and TRM headers a customer-specific 504 or TRM21QC import can store again." },
  { name: "Ongoing AutopartSalesLine on those documents", reason: "Product lines for the same documents. Lines on a protected recovery document stay." },
  { name: "AutopartCustomerImportRun of type ONGOING_504 or ONGOING_TRM21QC with no remaining document or line", reason: "Import audit for rebuilt sales. Runs that still hold a recovery document stay." },
  { name: "AutopartImportDiagnostic on a removed run", reason: "Removed with that run. Diagnostics for a protected recovery run stay." },
] as const;

export const IMPORTED_SALES_EFFECTS = [
  "B2B orders, invoices, fulfilment events, and stock reservations are not deleted or released.",
  "Customer prices, products, warehouse stock, purchasing settings, and rebate configuration stay.",
  "Sales Enquiry, purchasing history, and rebate figures that read ongoing Autopart lines lose the removed documents until those customers are reimported.",
  "Protected 504 documents inside 6–19 October 2026 remain available to the financial recovery.",
  "Historical 561L and SLRB rows remain. This tool does not call the historical cleanup.",
  "No fulfilment, stock movement, or customer email is triggered by the reset or by the customer reimport.",
] as const;

export const IMPORTED_SALES_APPROVAL_GATES = [
  "Take a fresh production backup and restore it to a different database.",
  "Query the restored database and confirm the backup checksum, size, source name, and restore time.",
  "Run scripts/imported-sales-reset.ts with no --execute flag and read the dry-run.",
  "Confirm the protected recovery documents are the outstanding 504 financial-recovery set.",
  "Set AB_RESET_CONFIRM to RESET IMPORTED AUTOPART SALES, AB_RESET_TARGET to the database name, and AB_RESET_RESTORE_URL to the restored copy.",
  "Pass --backup-proof for that backup. A production database also needs --allow-production-database.",
  "The command refuses to run during deploy, container startup, or a package lifecycle script.",
  "Reimport each customer from the customer workspace with the original 504 and TRM21QC reports. Do not upload 561L or SLRB.",
  "If the result is wrong, restore the tested backup. Do not run a second reset on a partial one.",
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
