/**
 * Confirmation for a genuinely new customer with no historical Autopart sales.
 * This is the existing zero-history cutover. It is not inferred from a file.
 */

export const NEW_SALES_BASELINE_KIND = "NO_HISTORICAL_SALES" as const;
export const NEW_SALES_BASELINE_REASON_MIN = 10;
export const NEW_SALES_BASELINE_REASON_MAX = 300;

export type NewSalesBaselineEvidence = {
  kind: typeof NEW_SALES_BASELINE_KIND;
  reason: string;
  verifiedAccount: string;
  companyName: string;
  recordedAt: string;
};

export function parseNewSalesBaselineConfirmation(input: {
  companyName: string;
  verifiedAccount: string;
  confirmAccount: string;
  reason: string;
  recordedAt: string;
}): { ok: true; evidence: NewSalesBaselineEvidence } | { ok: false; message: string } {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < NEW_SALES_BASELINE_REASON_MIN || reason.length > NEW_SALES_BASELINE_REASON_MAX) {
    return {
      ok: false,
      message: `Enter a reason of ${NEW_SALES_BASELINE_REASON_MIN} to ${NEW_SALES_BASELINE_REASON_MAX} characters. An empty file is not a reason.`,
    };
  }
  const expected = input.verifiedAccount.trim().toUpperCase();
  const typed = input.confirmAccount.trim().toUpperCase();
  if (!expected || typed !== expected) {
    return {
      ok: false,
      message: "Type this customer's verified Autopart account. The baseline was not recorded.",
    };
  }
  const companyName = input.companyName.trim();
  if (!companyName) {
    return { ok: false, message: "This customer has no name to confirm." };
  }
  return {
    ok: true,
    evidence: {
      kind: NEW_SALES_BASELINE_KIND,
      reason,
      verifiedAccount: expected,
      companyName,
      recordedAt: input.recordedAt,
    },
  };
}
