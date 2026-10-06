/**
 * Ongoing Autopart email attachment candidates + content detection.
 *
 * Extension/MIME are an initial filter only. Report CONTENT decides:
 * ONGOING_504 | TRM21QC | LEGACY_504C | UNKNOWN
 *
 * 504 != 504C. TXT is transport, not a report type.
 *
 * Report-level mailbox dedupe is content-hash authoritative (SHA-256 of the
 * attachment bytes / UTF-8 text used for import). Filename, Message-ID, and
 * IMAP UID must not block a genuinely changed 504/TRM21QC report.
 */
import { createHash } from "node:crypto";
import { normaliseAttachmentFilename } from "@/domain/stock-email";
import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";

/** Stable SHA-256 of report bytes/text — sole attachment/report duplicate identity. */
export function ongoingSalesReportContentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Audit receipt key for a consumed content hash (not used as a mailbox Message-ID gate). */
export function ongoingSalesContentReceiptKey(
  detectedType: "ONGOING_504" | "TRM21QC",
  contentHash: string,
): string {
  return `ongoing-hash:${detectedType}:${contentHash}`;
}

export const ONGOING_SALES_DETECTED_TYPES = ["ONGOING_504", "TRM21QC", "LEGACY_504C", "UNKNOWN"] as const;
export type OngoingSalesDetectedType = (typeof ONGOING_SALES_DETECTED_TYPES)[number];

export const ONGOING_SALES_DETECTED_LABEL: Record<OngoingSalesDetectedType, string> = {
  ONGOING_504: "ONGOING_504",
  TRM21QC: "TRM21QC",
  LEGACY_504C: "LEGACY_504C",
  UNKNOWN: "UNKNOWN",
};

const TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "application/csv",
  "application/vnd.ms-excel",
]);

const OCTET_STREAM = "application/octet-stream";

export type OngoingSalesCandidateDecision = {
  candidate: boolean;
  reason: string;
  hintedType: OngoingSalesDetectedType | null;
};

export function mimeBase(raw?: string | null): string {
  return String(raw ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
}

function filenameTokens(filename: string): string {
  return normaliseAttachmentFilename(filename).replace(/[^a-z0-9]+/g, " ");
}

export function hintedOngoingSalesType(filename: string): OngoingSalesDetectedType | null {
  const n = normaliseAttachmentFilename(filename);
  const tokens = filenameTokens(filename);
  if (n.includes("504c") || n.includes("504uf") || /(^| )504c( |$)/.test(tokens)) return "LEGACY_504C";
  if (n.includes("trm21qc")) return "TRM21QC";
  if (/(^| )504( |$)/.test(tokens) || n.includes("504.")) return "ONGOING_504";
  return null;
}

function hasTxtOrCsvExtension(filename: string): boolean {
  const n = normaliseAttachmentFilename(filename);
  return n.endsWith(".txt") || n.endsWith(".csv");
}

function mimeAllowed(mime: string): boolean {
  if (!mime) return true;
  return TEXT_MIMES.has(mime) || mime === OCTET_STREAM;
}

/**
 * Initial IMAP/manual candidate filter. Does not decide report type.
 * Arbitrary .txt is a candidate (content must still identify the report).
 * Arbitrary octet-stream without a plausible name is not.
 */
export function isOngoingSalesAttachmentCandidate(input: {
  filename: string;
  mime?: string | null;
}): OngoingSalesCandidateDecision {
  const filename = String(input.filename ?? "").trim();
  const mime = mimeBase(input.mime);
  const n = normaliseAttachmentFilename(filename);
  const hinted = filename ? hintedOngoingSalesType(filename) : null;

  if (n.includes("231po3new")) {
    return {
      candidate: false,
      reason: "231PO3NEW stock report — not an ongoing sales feed",
      hintedType: null,
    };
  }

  const extOk = hasTxtOrCsvExtension(filename);
  if (extOk) {
    return {
      candidate: true,
      reason: n.endsWith(".txt") ? "TXT attachment" : "CSV attachment",
      hintedType: hinted,
    };
  }

  const plausibleName = hinted != null;
  if (plausibleName && mimeAllowed(mime)) {
    return { candidate: true, reason: "Plausible ongoing-sales filename", hintedType: hinted };
  }

  if (mime && !mimeAllowed(mime)) {
    return {
      candidate: false,
      reason: `Unsupported MIME ${mime}`,
      hintedType: hinted,
    };
  }

  return {
    candidate: false,
    reason: "Unsupported extension/MIME",
    hintedType: hinted,
  };
}

function looksLikeLegacy504c(filename: string, text: string): boolean {
  const f = filename.toUpperCase();
  if (f.includes("504C") || f.includes("504UF")) return true;
  const sample = text.replace(/^\uFEFF/, "").slice(0, 8000).toUpperCase();
  if (sample.includes("LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)")) return true;
  if (sample.includes("(504C)")) return true;
  if (sample.includes("CUSTOMER ORDER NUMBER") && sample.includes(".ACCT.")) return true;
  return false;
}

/**
 * Content-authoritative classification. Filename/subject never override parsers.
 */
export function detectOngoingSalesAttachmentType(filename: string, text: string): OngoingSalesDetectedType {
  if (looksLikeLegacy504c(filename, text)) return "LEGACY_504C";
  if (isAutopartTrm21qcReport(text)) return "TRM21QC";
  if (isAutopart504Report(text)) return "ONGOING_504";
  return "UNKNOWN";
}

/** Legacy poll classifier (504 / 504C labels) — content still required for 504/TRM. */
export function classifyOngoingSalesAttachment(
  filename: string,
  text: string,
): "504" | "TRM21QC" | "504C" | "UNKNOWN" {
  const detected = detectOngoingSalesAttachmentType(filename, text);
  if (detected === "ONGOING_504") return "504";
  if (detected === "TRM21QC") return "TRM21QC";
  if (detected === "LEGACY_504C") return "504C";
  return "UNKNOWN";
}

export type OngoingSalesAttachmentResult =
  | "imported"
  | "duplicate"
  | "skipped"
  | "failed";

export type OngoingSalesAttachmentDiagnostic = {
  filename: string;
  mime: string | null;
  candidate: boolean;
  candidateType: OngoingSalesDetectedType | "NOT_CANDIDATE";
  detectedType: OngoingSalesDetectedType | "NOT_EXAMINED";
  result: OngoingSalesAttachmentResult;
  skipReason: string | null;
};

export function formatOngoingSalesAttachmentDiagnostic(row: OngoingSalesAttachmentDiagnostic): string {
  const detected = row.detectedType === "NOT_EXAMINED" ? "n/a" : row.detectedType;
  const candidate = row.candidateType === "NOT_CANDIDATE" ? "no" : row.candidateType;
  const mime = row.mime || "unknown";
  const outcome =
    row.result === "imported"
      ? "Imported"
      : row.result === "duplicate"
        ? "Duplicate"
        : row.result === "failed"
          ? `Failed${row.skipReason ? ` — ${row.skipReason}` : ""}`
          : `Skipped${row.skipReason ? ` — ${row.skipReason}` : ""}`;
  return `${row.filename}\nMIME ${mime}\nCandidate ${candidate}\nDetected: ${detected}\nResult: ${outcome}`;
}

export function skipReasonForDetectedType(detected: OngoingSalesDetectedType): string {
  if (detected === "LEGACY_504C") return "legacy 504C — not ongoing 504";
  if (detected === "UNKNOWN") return "content not recognised";
  return "skipped";
}
