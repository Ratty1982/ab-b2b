/**
 * Product Documents — types, labels, PDF validation, filename matching.
 * First active type: Safety Data Sheet (SDS).
 */

import { createHash } from "node:crypto";

export const PRODUCT_DOCUMENT_TYPES = [
  "SAFETY_DATA_SHEET",
  "TECHNICAL_DATA_SHEET",
  "INSTRUCTIONS",
  "CERTIFICATE",
  "DECLARATION",
  "FITTING_GUIDE",
  "OTHER",
] as const;

export type ProductDocumentTypeKey = (typeof PRODUCT_DOCUMENT_TYPES)[number];

export const PRODUCT_DOCUMENT_TYPE_LABELS: Record<ProductDocumentTypeKey, string> = {
  SAFETY_DATA_SHEET: "Safety Data Sheet (SDS)",
  TECHNICAL_DATA_SHEET: "Technical Data Sheet",
  INSTRUCTIONS: "Instructions",
  CERTIFICATE: "Certificate",
  DECLARATION: "Declaration",
  FITTING_GUIDE: "Fitting Guide",
  OTHER: "Other Document",
};

/** Soft max for SDS/TDS PDFs (20 MB). */
export const PRODUCT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Local bulk SDS upload — comfortable for 30–100 PDFs. */
export const BULK_SDS_MAX_FILES = 100;

/** ProductDocument.sourceMetadata.source for the supported production workflow. */
export const MANUAL_SDS_SOURCE = "MANUAL_UPLOAD" as const;

export function productDocumentTypeLabel(type: string): string {
  if ((PRODUCT_DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return PRODUCT_DOCUMENT_TYPE_LABELS[type as ProductDocumentTypeKey];
  }
  return "Document";
}

export function sanitizeDocumentFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "document.pdf";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 180);
  const withExt = cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "document"}.pdf`;
  return withExt.replace(/^\.+/, "") || "document.pdf";
}

/** PDF magic: %PDF- */
export function isPdfBytes(bytes: Buffer | Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateProductDocumentPdf(input: {
  filename: string;
  contentType?: string | null;
  bytes: Buffer;
}): { ok: true; filename: string; contentType: "application/pdf" } | { ok: false; error: string } {
  if (!input.bytes.length) return { ok: false, error: "Empty file" };
  if (input.bytes.length > PRODUCT_DOCUMENT_MAX_BYTES) {
    return { ok: false, error: "PDF is larger than 20 MB" };
  }
  const filename = sanitizeDocumentFilename(input.filename);
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Only PDF documents are accepted" };
  }
  if (!isPdfBytes(input.bytes)) {
    return { ok: false, error: "File contents are not a valid PDF" };
  }
  const declared = (input.contentType ?? "").toLowerCase().trim();
  if (
    declared &&
    declared !== "application/pdf" &&
    declared !== "application/x-pdf" &&
    declared !== "application/octet-stream"
  ) {
    return { ok: false, error: "Declared type must be application/pdf" };
  }
  return { ok: true, filename, contentType: "application/pdf" };
}

/** Strip SDS wording / punctuation for conservative matching. */
export function normaliseDocumentMatchToken(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/SAFETY\s*DATA\s*SHEET/g, " ")
    .replace(/\bSDS\b/g, " ")
    .replace(/\bTDS\b/g, " ")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

export function extractSkuCandidatesFromFilename(filename: string): string[] {
  const base = filename.replace(/\.pdf$/i, "");
  const tokens = base
    .split(/[\s_\-.[\]()]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^(sds|tds|safety|data|sheet|rev|revision|v\d+)$/i.test(t))
    .filter((t) => !/^\d{4}$/.test(t)); // year-like
  const out: string[] = [];
  for (const t of tokens) {
    const n = t.toUpperCase();
    if (n.length >= 3 && /[A-Z]/.test(n) && /\d/.test(n)) out.push(n);
  }
  // Also whole-filename normalised (without SDS/year)
  const whole = normaliseDocumentMatchToken(base);
  if (whole.length >= 3) out.push(whole);
  return [...new Set(out)];
}

export type ProductMatchCandidate = {
  productId: string;
  sku: string;
  name: string;
  brandName?: string | null;
};

export type FilenameMatchMethod = "EXACT_SKU" | "NORMALISED_SKU" | "PRODUCT_NAME";

export type FilenameMatchResult =
  | { status: "MATCHED"; product: ProductMatchCandidate; reason: string; method: FilenameMatchMethod }
  | { status: "REVIEW"; products: ProductMatchCandidate[]; reason: string }
  | { status: "NO_MATCH"; reason: string };

/**
 * Conservative deterministic matching. Never auto-picks when ambiguous.
 *
 * Priority: exact SKU in filename → normalised SKU → strong product-name match.
 */
export function matchFilenameToProducts(
  filename: string,
  catalogue: ProductMatchCandidate[],
): FilenameMatchResult {
  const skuCandidates = extractSkuCandidatesFromFilename(filename);
  const bySku = new Map(catalogue.map((p) => [p.sku.toUpperCase(), p]));
  const exactSkuHits: ProductMatchCandidate[] = [];
  for (const c of skuCandidates) {
    const hit = bySku.get(c);
    if (hit) exactSkuHits.push(hit);
  }
  const uniqueSku = uniqueById(exactSkuHits);
  if (uniqueSku.length === 1) {
    return {
      status: "MATCHED",
      product: uniqueSku[0]!,
      reason: "Exact SKU in filename",
      method: "EXACT_SKU",
    };
  }
  if (uniqueSku.length > 1) {
    return { status: "REVIEW", products: uniqueSku, reason: "Multiple SKU matches" };
  }

  const normalisedHits: ProductMatchCandidate[] = [];
  for (const p of catalogue) {
    const nSku = normaliseDocumentMatchToken(p.sku);
    if (!nSku || nSku.length < 3) continue;
    if (skuCandidates.includes(nSku) || skuCandidates.some((c) => c === nSku)) {
      normalisedHits.push(p);
    }
  }
  const uniqueNorm = uniqueById(normalisedHits);
  if (uniqueNorm.length === 1) {
    return {
      status: "MATCHED",
      product: uniqueNorm[0]!,
      reason: "Normalised SKU match",
      method: "NORMALISED_SKU",
    };
  }
  if (uniqueNorm.length > 1) {
    return { status: "REVIEW", products: uniqueNorm, reason: "Multiple normalised SKU matches" };
  }

  const fileNorm = normaliseDocumentMatchToken(filename.replace(/\.pdf$/i, ""));
  const nameHits: ProductMatchCandidate[] = [];
  for (const p of catalogue) {
    const nName = normaliseDocumentMatchToken(p.name);
    if (nName.length >= 8 && fileNorm.includes(nName)) nameHits.push(p);
  }
  const uniqueName = uniqueById(nameHits);
  if (uniqueName.length === 1) {
    return {
      status: "MATCHED",
      product: uniqueName[0]!,
      reason: "Strong product name match",
      method: "PRODUCT_NAME",
    };
  }
  if (uniqueName.length > 1) {
    return { status: "REVIEW", products: uniqueName.slice(0, 8), reason: "Ambiguous product name" };
  }

  return { status: "NO_MATCH", reason: "No reliable SKU or name match" };
}

function uniqueById(rows: ProductMatchCandidate[]): ProductMatchCandidate[] {
  const map = new Map<string, ProductMatchCandidate>();
  for (const r of rows) map.set(r.productId, r);
  return [...map.values()];
}

export function productDocumentPublicPath(documentId: string): string {
  return `/api/product-documents/${documentId}`;
}

export function defaultDocumentTitle(productName: string, type: ProductDocumentTypeKey): string {
  if (type === "SAFETY_DATA_SHEET") return `${productName} Safety Data Sheet`;
  return `${productName} ${productDocumentTypeLabel(type)}`;
}
