/**
 * One-time customer-data reset catalogue and safety gates.
 * Dry-run is the only default. Nothing in application startup imports this module.
 * The destructive path lives in scripts/customer-data-reset.ts and refuses to run
 * until backup, restore, database, and typed confirmation all pass.
 */

export const RESET_CONFIRMATION_PHRASE = "RESET CUSTOMER TEST DATA";

/** How long a tested restore may be before execute refuses it. */
export const BACKUP_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BackupProof = {
  backupPath: string;
  backupBytes: number;
  backupSha256: string;
  sourceDatabase: string;
  restoredDatabase: string;
  restoredAt: string;
};

export type ResetGateInput = {
  executeRequested: boolean;
  confirmation: string | null;
  targetDatabase: string | null;
  actualDatabase: string | null;
  backupProof: BackupProof | null;
  restoreCheckOk: boolean;
  /** Ongoing 504/TRM removal is a separate operation and is not implemented. */
  ongoingResetRequested: boolean;
  now?: Date;
};

export type ResetGateResult =
  | { ok: true; mode: "dry-run" | "execute" }
  | { ok: false; mode: "dry-run" | "execute"; reason: string };

export type OrderExportEvidence = {
  orderNumber: string;
  status: string;
  autopartExportStatus: string;
  autopartExportCount: number;
  exportBatchReference: string | null;
  externalRef: string | null;
  fulfilmentSources: string[];
};

export type OrderResetDecision = {
  hold: boolean;
  summary: string;
};

/** Tables and settings the reset must leave in place. */
export const PRESERVED = [
  { name: "AutopartAccount", reason: "407EXP Autopart customer master, account codes, and classifications." },
  { name: "AutopartCustomerAccountAlias", reason: "Staff-verified account aliases." },
  { name: "Company.autopartCustomerCode", reason: "Verified Autopart account mapping on the customer record." },
  { name: "AutopartImportBatch kind CUSTOMER_MASTER", reason: "407EXP master import audit. Invoice and ledger batches are separate." },
  { name: "User, AuthSession, Role, Permission, UserRole, UserPermissionOverride", reason: "Staff, administrator, and security settings." },
  { name: "Company, Contact, Address, CompanyUser", reason: "Customer and prospect records stay. The reset does not delete CRM accounts." },
  { name: "Product, Brand, Category, Inventory, AutopartProduct", reason: "Catalogue and stock." },
  { name: "PriceList, PriceListItem, CustomerPrice, Promotion", reason: "Price lists, customer prices, and promotions." },
  { name: "Supplier, PurchasingSettings, VariantPurchasingSettings", reason: "Supplier and purchasing configuration." },
  { name: "CmsPage and related website content", reason: "Website content and settings." },
  { name: "EmailSettings, AutopartImapSettings, feed settings rows", reason: "Integrations stay. Execute only turns sales-import schedules off for the reset window." },
  { name: "CustomerSurveyResponse, CustomerSurveyVersion, CustomerSurveyPrizeClaim", reason: "Survey records." },
  { name: "AutopartSalesLine source ONGOING_TRM21QC", reason: "Ongoing product lines from the daily feed." },
  { name: "AutopartSalesDocument with has504, hasTrm21qc, or an ongoing source", reason: "Authoritative 504 and TRM document headers." },
  { name: "AutopartCustomerImportRun type ONGOING_504 or ONGOING_TRM21QC", reason: "Ongoing import audit. Historical 561L/SLRB runs are cleared." },
  { name: "SalesHistoryCoverageVerification", reason: "Staff coverage sign-off, not an imported sales copy." },
  { name: "OrderNumberSequence", reason: "Next order number stays ahead of retired numbers." },
] as const;

/**
 * Rows the execute path removes. Ongoing 504/TRM rows are excluded inside these tables.
 * Global invoice lines are the shared 561L copy. Removing them leaves one historical
 * source after each customer is imported again.
 */
export const RESET = [
  { name: "AutopartInvoiceLine", reason: "Global 561L history. This is not the 407EXP customer master." },
  { name: "AutopartLedgerTransaction", reason: "Global SLRB ledger copy." },
  { name: "AutopartDocumentMatch", reason: "Global 561L/SLRB reconciliation rows." },
  { name: "AutopartImportBatch kind INVOICE_LINES or LEDGER", reason: "Historical sales import runs. CUSTOMER_MASTER batches stay." },
  { name: "AutopartImportIssue on those batches", reason: "Issues for the historical sales batches only." },
  { name: "AutopartSalesLine where source is not ONGOING_TRM21QC", reason: "Customer 561L lines. Daily TRM lines stay." },
  { name: "AutopartSalesDocument that is not a 504 or TRM header", reason: "Customer historical invoices and credits. Daily documents stay." },
  { name: "AutopartCustomerImportRun type HISTORY_561L_SLRB", reason: "Historical import runs, diagnostics, and stored report files." },
  { name: "AutopartImportDiagnostic on those runs", reason: "Removed with the historical run." },
  { name: "Basket, BasketItem", reason: "Test baskets." },
  { name: "SalesOrderDraft, SalesOrderDraftLine", reason: "Staff order drafts." },
  { name: "Quote, QuoteItem", reason: "Test quotations." },
  { name: "Invoice linked to an order that is safe to remove", reason: "Invoices for the removed B2B order. 504C invoices with no order stay." },
  { name: "Order, OrderItem, OrderStockReservation, OrderFulfilmentEvent", reason: "The B2B order and reservations, when export evidence allows it." },
  { name: "TransactionalEmail for removed orders and quotes", reason: "Messages for the removed commercial records." },
] as const;

/** Explicitly not part of this reset. No replay path is provided. */
export const NOT_RESET = [
  { name: "Ongoing 504 and TRM21QC documents, lines, and runs", reason: "Protected. A wipe would need its own replay from Autopart and is not this tool." },
  { name: "Company, portal users, and staff users", reason: "Listed for review. Not deleted." },
  { name: "Lead, Opportunity, Activity, Task, Note", reason: "CRM activity stays. Review counts are reported only." },
  { name: "CustomerPrice and price lists", reason: "Commercial pricing stays." },
] as const;

export const RESET_CHECKLIST = [
  "Stop new historical imports. The reset tool turns the daily sales import schedules off and records their previous settings.",
  "Take a full database backup and restore it to a different database.",
  "Confirm the restore can be queried, then run this tool with no flags. That is the dry-run.",
  "Read the order export report. If a CSV was sent to Autopart, removing the order here does not remove it from Autopart.",
  "Run the tool again with the backup proof, the database name, and the confirmation phrase. It still does nothing during deploy or startup.",
  "Check the audit report. Customer master, staff, products, prices, and daily 504/TRM rows must match the before counts.",
  "Turn the daily sales schedules back on only after the report is accepted.",
  "For each customer you activate, upload that customer's new product-lines report and invoice report, preview, then import.",
  "Importing the same files again must not add a second copy of those invoices.",
  "If the result is wrong, restore the tested backup. Do not run a second reset on top of a partial one.",
] as const;

export function validateBackupProof(
  proof: BackupProof,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (!proof.backupPath.trim()) return { ok: false, reason: "Backup path is missing." };
  if (!Number.isSafeInteger(proof.backupBytes) || proof.backupBytes <= 0) {
    return { ok: false, reason: "Backup file is empty." };
  }
  if (!/^[a-f0-9]{64}$/i.test(proof.backupSha256)) {
    return { ok: false, reason: "Backup checksum is missing." };
  }
  if (!proof.sourceDatabase.trim() || !proof.restoredDatabase.trim()) {
    return { ok: false, reason: "Backup proof must name the source and restored databases." };
  }
  if (proof.sourceDatabase === proof.restoredDatabase) {
    return { ok: false, reason: "The test restore must use a different database from the one being reset." };
  }
  const restoredAt = new Date(proof.restoredAt);
  if (Number.isNaN(restoredAt.getTime())) {
    return { ok: false, reason: "Backup proof has no restore time." };
  }
  const age = now.getTime() - restoredAt.getTime();
  if (age < 0 || age > BACKUP_RESTORE_MAX_AGE_MS) {
    return { ok: false, reason: "The test restore must have succeeded within the last 24 hours." };
  }
  return { ok: true };
}

export function evaluateResetGates(input: ResetGateInput): ResetGateResult {
  const mode = input.executeRequested ? "execute" : "dry-run";
  if (input.ongoingResetRequested) {
    return {
      ok: false,
      mode,
      reason:
        "Ongoing 504 and TRM records are not part of this reset. They stay in place. No separate replay is available.",
    };
  }
  if (!input.executeRequested) return { ok: true, mode: "dry-run" };

  if (input.confirmation !== RESET_CONFIRMATION_PHRASE) {
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

export function databaseNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

export function orderResetDecision(
  order: OrderExportEvidence,
  acknowledgeExported: boolean,
): OrderResetDecision {
  const exported =
    order.autopartExportStatus === "EXPORTED" ||
    order.autopartExportCount > 0 ||
    Boolean(order.exportBatchReference);
  const autopartFulfilment = order.fulfilmentSources.some((source) => source.startsWith("AUTOPART_"));
  const external = Boolean(order.externalRef);
  if (!exported && !autopartFulfilment && !external) {
    return {
      hold: false,
      summary: `${order.orderNumber} has no Autopart export. Removing it only affects Automotive Brands.`,
    };
  }
  const parts: string[] = [];
  if (exported) {
    parts.push(
      `${order.orderNumber} has an Autopart CSV export${order.exportBatchReference ? ` (${order.exportBatchReference})` : ""}. Deleting it here does not delete it from Autopart.`,
    );
  }
  if (autopartFulfilment) {
    parts.push(
      `${order.orderNumber} has daily sales or despatch records. Those Autopart documents stay.`,
    );
  }
  if (external) {
    parts.push(`${order.orderNumber} has an external reference. Confirm it is not a live Autopart order.`);
  }
  if (!acknowledgeExported) {
    return { hold: true, summary: `${parts.join(" ")} Held until that consequence is acknowledged.` };
  }
  return { hold: false, summary: `${parts.join(" ")} Acknowledged for removal.` };
}
