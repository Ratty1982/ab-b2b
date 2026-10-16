/**
 * A committed ongoing import that skipped identity conflicts is not a clean success.
 * Mailbox polling still treats the content hash as already handled so it does not
 * create another identical run. Staff re-upload the file after the identity is fixed.
 */

export const ONGOING_IMPORT_ATTENTION_REASON =
  "This import committed with skipped document conflicts. It is not a complete success. Mailbox polling will not create another run for the same file. Re-upload the file after the customer identity is resolved. Documents already saved are not inserted again.";

export type OngoingIdentityConflict = {
  documentReference: string;
  documentType: string;
  detail: string;
};

export function describeOngoingImportAttention(conflicts: readonly OngoingIdentityConflict[]): {
  attentionRequired: boolean;
  attentionReason: string | null;
} {
  if (!conflicts.length) return { attentionRequired: false, attentionReason: null };
  return { attentionRequired: true, attentionReason: ONGOING_IMPORT_ATTENTION_REASON };
}

export function importRunNeedsAttention(diagnostics: unknown, issues: unknown): boolean {
  const diag = (diagnostics ?? {}) as {
    attentionRequired?: boolean;
    identityConflicts?: unknown[];
  };
  const issue = (issues ?? {}) as { attentionRequired?: boolean; conflicts?: unknown[] };
  return Boolean(
    diag.attentionRequired ||
      issue.attentionRequired ||
      (Array.isArray(diag.identityConflicts) && diag.identityConflicts.length > 0) ||
      (Array.isArray(issue.conflicts) && issue.conflicts.length > 0),
  );
}
