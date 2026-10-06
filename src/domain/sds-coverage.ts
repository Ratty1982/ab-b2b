/**
 * SDS coverage — product-level catalogue governance around ProductDocument.
 *
 * Coverage is measured per Product, not per ProductVariant. Pack sizes / SKUs
 * that share a product-owned SDS produce one coverage state.
 *
 * Not Required is an internal business classification and is not an automated
 * regulatory determination.
 */

export const SDS_COVERAGE_STATUSES = [
  "CURRENT",
  "MISSING",
  "ARCHIVED_ONLY",
  "NOT_REQUIRED",
] as const;

export type SdsCoverageStatus = (typeof SDS_COVERAGE_STATUSES)[number];

export const SDS_REQUIREMENTS = ["REQUIRED", "NOT_REQUIRED"] as const;
export type SdsRequirement = (typeof SDS_REQUIREMENTS)[number];

export const SDS_COVERAGE_POPULATIONS = ["active", "inactive", "all"] as const;
export type SdsCoveragePopulation = (typeof SDS_COVERAGE_POPULATIONS)[number];

/** Small explicit selection only — never a "mark all not required" action. */
export const SDS_NOT_REQUIRED_MAX_SELECTION = 25;

export const SDS_NOT_REQUIRED_REASON_MAX = 240;

/** Optional internal notes shown as hints — never treated as legal conclusions. */
export const SDS_NOT_REQUIRED_REASON_HINTS = [
  "Non-chemical accessory",
  "No hazardous substance",
  "Manufacturer does not issue SDS",
  "Other",
] as const;

export const SDS_COVERAGE_STATUS_LABEL: Record<SdsCoverageStatus, string> = {
  CURRENT: "Current",
  MISSING: "Missing",
  ARCHIVED_ONLY: "Archived only",
  NOT_REQUIRED: "Not required",
};

export const SDS_COVERAGE_STATUS_MARK: Record<SdsCoverageStatus, string> = {
  CURRENT: "✓ Current",
  MISSING: "⚠ Missing",
  ARCHIVED_ONLY: "⚠ Archived only",
  NOT_REQUIRED: "— Not required",
};

export const SDS_COVERAGE_COMPACT: Record<SdsCoverageStatus, { mark: string; tooltip: string }> = {
  CURRENT: { mark: "✓", tooltip: "Current SDS" },
  MISSING: { mark: "!", tooltip: "Missing SDS" },
  ARCHIVED_ONLY: {
    mark: "!",
    tooltip: "Archived SDS available — current SDS required",
  },
  NOT_REQUIRED: { mark: "—", tooltip: "Not required" },
};

export type SdsCoverageClassifyInput = {
  sdsRequirement: SdsRequirement | string;
  hasCurrentSds: boolean;
  hasArchivedSds: boolean;
};

export function classifySdsCoverage(input: SdsCoverageClassifyInput): SdsCoverageStatus {
  if (input.sdsRequirement === "NOT_REQUIRED") return "NOT_REQUIRED";
  if (input.hasCurrentSds) return "CURRENT";
  if (input.hasArchivedSds) return "ARCHIVED_ONLY";
  return "MISSING";
}

export function isSdsCoverageSatisfied(status: SdsCoverageStatus): boolean {
  return status === "CURRENT" || status === "NOT_REQUIRED";
}

/**
 * Coverage % = (Current SDS + Not Required) / Active Products × 100
 * Archived-only and Missing do not count as covered.
 */
export function sdsCoveragePercent(
  currentSds: number,
  notRequired: number,
  activeProducts: number,
): number {
  if (activeProducts <= 0) return 0;
  return Math.round(((currentSds + notRequired) / activeProducts) * 1000) / 10;
}

export function formatSdsCoveragePercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

export type SdsCoverageCounts = {
  activeProducts: number;
  currentSds: number;
  missingSds: number;
  archivedOnly: number;
  notRequired: number;
  coveragePercent: number;
};

export function finaliseSdsCoverageCounts(input: {
  activeProducts: number;
  currentSds: number;
  archivedOnly: number;
  notRequired: number;
}): SdsCoverageCounts {
  const activeProducts = Math.max(0, input.activeProducts);
  const currentSds = Math.max(0, input.currentSds);
  const archivedOnly = Math.max(0, input.archivedOnly);
  const notRequired = Math.max(0, input.notRequired);
  const missingSds = Math.max(0, activeProducts - currentSds - archivedOnly - notRequired);
  return {
    activeProducts,
    currentSds,
    missingSds,
    archivedOnly,
    notRequired,
    coveragePercent: sdsCoveragePercent(currentSds, notRequired, activeProducts),
  };
}

/** Prefer stored revision/date; otherwise "Uploaded DD/MM/YYYY". Never invent an SDS revision. */
export function sdsDocumentMetaLabel(input: {
  filename: string;
  revision?: string | null;
  documentDateLabel?: string | null;
  uploadedLabel: string;
}): { filename: string; detail: string } {
  const bits: string[] = [];
  const revision = input.revision?.trim();
  if (revision) bits.push(`Revision ${revision}`);
  if (input.documentDateLabel) bits.push(input.documentDateLabel);
  if (!bits.length) bits.push(`Uploaded ${input.uploadedLabel}`);
  return { filename: input.filename, detail: bits.join(" · ") };
}

export function csvEscapeCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replaceAll('"', '""')}"`;
  return raw;
}

export function toUtf8Csv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [
    headers.map(csvEscapeCell).join(","),
    ...rows.map((row) => row.map(csvEscapeCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
