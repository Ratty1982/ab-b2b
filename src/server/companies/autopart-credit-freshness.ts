/**
 * Freshness semantics for manually imported Autopart 407P100 credit snapshots.
 * No automatic refresh cadence in this phase.
 */

export type CreditFreshness = "CURRENT" | "STALE" | "NOT_AVAILABLE";

/** Manual imports older than this are presented as STALE (not live). */
export const AUTOPART_CREDIT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function creditFreshnessFromImportedAt(
  importedAt: Date | string | null | undefined,
  now = new Date(),
): CreditFreshness {
  if (!importedAt) return "NOT_AVAILABLE";
  const at = typeof importedAt === "string" ? new Date(importedAt) : importedAt;
  if (Number.isNaN(at.getTime())) return "NOT_AVAILABLE";
  const age = now.getTime() - at.getTime();
  if (age < 0) return "CURRENT";
  return age > AUTOPART_CREDIT_STALE_AFTER_MS ? "STALE" : "CURRENT";
}
