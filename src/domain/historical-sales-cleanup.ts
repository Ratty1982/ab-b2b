/**
 * Controlled removal of imported historical Autopart sales.
 * Dry-run is the only default. Nothing here runs on deploy or server start.
 * Ongoing 504 / TRM documents, companies, and the 407EXP master are preserved.
 */

export const HISTORICAL_CLEANUP_CONFIRMATION = "ARCHIVE_AND_DELETE_HISTORICAL_SALES";

export const PRESERVED = [
  "Company, contacts, addresses, users, and permissions",
  "AutopartAccount rows from the 407EXP customer master",
  "Autopart customer codes, verified aliases, and company links",
  "Customer pricing, promotions, orders, and sales-rep assignments",
  "AutopartSalesDocument and AutopartSalesLine rows used by live 504 or TRM21QC, including a document whose original source was 561L or SLRB",
  "Ongoing 504 and TRM21QC import runs and their diagnostics",
  "The 123 ongoing 504 documents with monetary discrepancies — they stay for the separate financial recovery",
  "CUSTOMER_MASTER import batches",
] as const;

export const REMOVED_WHEN_APPLIED = [
  "AutopartInvoiceLine",
  "AutopartLedgerTransaction",
  "AutopartDocumentMatch",
  "AutopartImportBatch kind INVOICE_LINES or LEDGER, and their AutopartImportIssue rows",
  "AutopartHistoryAllImport, AutopartHistoryReviewAccount, AutopartHistoryStagedDocument, AutopartHistoryStagedLine, AutopartHistorySnapshotGap, AutopartHistoryImportLock",
  "AutopartSalesDocument rows whose source is 561L or SLRB and that are not flagged has504 or hasTrm21qc",
  "AutopartSalesLine rows with source 561L that are not attached to an ongoing document",
  "AutopartCustomerImportRun type HISTORY_561L_SLRB and AutopartImportDiagnostic rows that are not still referenced by a preserved document or line",
  "Stored 561L-ALL and SLRB-ALL files listed by those historical batches, after they are copied to the restricted archive",
] as const;

export type CleanupMode = "dry-run" | "apply";

export type BackupAttestation = {
  postgresRestoreTestedAt: string;
  storageBackupPath: string;
};

export function evaluateHistoricalCleanupGates(input: {
  apply: boolean;
  confirmation: string | null;
  attestation: BackupAttestation | null;
  now?: Date;
}): { mode: CleanupMode; errors: string[] } {
  if (!input.apply) return { mode: "dry-run", errors: [] };
  const errors: string[] = [];
  if (input.confirmation !== HISTORICAL_CLEANUP_CONFIRMATION) {
    errors.push("Confirmation phrase does not match.");
  }
  const attestation = input.attestation;
  if (!attestation?.postgresRestoreTestedAt || !attestation.storageBackupPath?.trim()) {
    errors.push("A tested PostgreSQL restore time and a storage backup path are required.");
  } else {
    const testedAt = new Date(attestation.postgresRestoreTestedAt);
    const now = input.now ?? new Date();
    if (Number.isNaN(testedAt.getTime())) {
      errors.push("PostgreSQL restore test time is not a valid timestamp.");
    } else if (testedAt.getTime() > now.getTime()) {
      errors.push("PostgreSQL restore test time is in the future.");
    } else if (now.getTime() - testedAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      errors.push("PostgreSQL restore test must have been completed within the last 7 days.");
    }
  }
  return { mode: errors.length ? "dry-run" : "apply", errors };
}
