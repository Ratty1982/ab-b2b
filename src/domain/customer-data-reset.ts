/**
 * One-time customer-data reset catalogue and safety gates.
 * Dry-run is the only default. Nothing in application startup imports this module.
 * The destructive path lives in scripts/customer-data-reset.ts and refuses to run
 * until backup, restore, database, and typed confirmation all pass.
 */

export const RESET_CONFIRMATION_PHRASE = "RESET HISTORICAL SALES";

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
  /** True when this process is container bootstrap, deploy, or a package lifecycle script. */
  duringBootstrap?: boolean;
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
  activeReservationQuantity?: number;
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
 * Global invoice lines are the overlapping 561L copy. Removing them leaves one historical
 * source: the next 561L-ALL and SLRB-ALL import, written only onto verified companies.
 */
export const RESET = [
  { name: "AutopartInvoiceLine", reason: "Global 561L history. This is not the 407EXP customer master and is not rebuilt." },
  { name: "AutopartLedgerTransaction", reason: "Global SLRB ledger copy. Payments stay in Autopart. They are not a second sales dataset." },
  { name: "AutopartDocumentMatch", reason: "Global 561L/SLRB reconciliation. Customer documents carry the replacement check." },
  { name: "AutopartImportBatch kind INVOICE_LINES or LEDGER", reason: "Historical sales batches. CUSTOMER_MASTER batches stay." },
  { name: "AutopartImportIssue on those batches", reason: "Issues for the historical sales batches only." },
  { name: "AutopartSalesLine where source is not ONGOING_TRM21QC", reason: "Historical product lines. Daily TRM lines stay, including lines on a protected document." },
  { name: "AutopartSalesDocument that is not a 504 or TRM header", reason: "Historical invoices and credits. Daily documents stay." },
  { name: "AutopartCustomerImportRun type HISTORY_561L_SLRB", reason: "Historical import runs and stored report files." },
  { name: "AutopartImportDiagnostic on those runs", reason: "Removed with the historical run." },
  { name: "AutopartHistoryAllImport, review accounts, and staged rows", reason: "The previous all-accounts file and its review queue. Certified ongoing rows are not in these tables." },
  { name: "B2B orders only when --include-b2b-orders is set and the order is not held", reason: "Stock holds are released first. Exported, despatched, or externally referenced orders stay unless that consequence is acknowledged." },
] as const;

/** What reporting does after the historical copies are removed. */
export const REPORTING_EFFECTS = [
  "Sales Intelligence stops counting global 561L rows when those rows are removed. A customer is counted again only after the 561L-ALL and SLRB-ALL import attaches that verified account.",
  "Prospects whose history exists only in the global 561L copy lose that history until their Autopart account is verified. The customer record and 407EXP account stay. Their rows wait in the historical review queue and are not a second certified copy.",
  "Dated Sales Intelligence and portal purchase history read AutopartSalesLine. Historical lines go away. Ongoing TRM21QC lines stay.",
  "AutopartDocumentMatch is cleared and is not rebuilt. The all-accounts import checks 561L line nets against SLRB goods on the customer document instead.",
  "Do not confirm a legacy global 561L or SLRB batch after this reset. That would recreate the overlapping copy.",
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
  "Import the fresh 561L-ALL and SLRB-ALL pair once. Verified accounts are written immediately. Other accounts wait in the review queue until that account is verified.",
  "Importing the same ALL pair again must not add a second copy of those invoices.",
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
  if (input.duringBootstrap) {
    return {
      ok: false,
      mode,
      reason: "The reset cannot run during deployment, container startup, or a package lifecycle script.",
    };
  }
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
  return describeDatabaseUrl(url).database;
}

export function describeDatabaseUrl(url: string): { database: string | null; host: string | null } {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("?")[0] ?? "");
    return { database: name || null, host: parsed.hostname || null };
  } catch {
    return { database: null, host: null };
  }
}

export function resetInvocationIsBootstrap(env: NodeJS.ProcessEnv): boolean {
  if (env["AB_RESET_DURING_BOOT"] === "1" || env["AB_ENTRYPOINT"] === "1") return true;
  return Boolean(env["npm_lifecycle_event"]);
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
  const despatched = order.status === "DISPATCHED" || order.status === "DELIVERED";
  const reserved = (order.activeReservationQuantity ?? 0) > 0;
  if (!exported && !autopartFulfilment && !external && !despatched) {
    return {
      hold: false,
      summary: reserved
        ? `${order.orderNumber} has no Autopart export. Removing it releases ${order.activeReservationQuantity} reserved units in Automotive Brands and does not change Autopart stock.`
        : `${order.orderNumber} has no Autopart export. Removing it only affects Automotive Brands.`,
    };
  }
  const parts: string[] = [];
  if (despatched) {
    parts.push(`${order.orderNumber} is ${order.status}. Removing it deletes Automotive Brands fulfilment history.`);
  }
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
