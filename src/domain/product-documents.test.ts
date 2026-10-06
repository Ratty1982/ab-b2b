import { describe, expect, it } from "vitest";
import {
  extractSkuCandidatesFromFilename,
  isPdfBytes,
  matchFilenameToProducts,
  normaliseDocumentMatchToken,
  PRODUCT_DOCUMENT_MAX_BYTES,
  productDocumentTypeLabel,
  sanitizeDocumentFilename,
  sha256Hex,
  validateProductDocumentPdf,
} from "@/domain/product-documents";

const PDF = Buffer.from("%PDF-1.4 minimal", "utf8");

describe("product documents domain", () => {
  it("labels SDS for UI without exposing enum", () => {
    expect(productDocumentTypeLabel("SAFETY_DATA_SHEET")).toBe("Safety Data Sheet (SDS)");
  });

  it("sanitises unsafe filenames and keeps pdf extension", () => {
    expect(sanitizeDocumentFilename("../../evil name SDS 2025.PDF")).toBe("evil_name_SDS_2025.PDF");
    expect(sanitizeDocumentFilename("noext")).toMatch(/\.pdf$/i);
  });

  it("accepts valid PDF bytes and rejects non-PDF / fake PDF / oversized", () => {
    const ok = validateProductDocumentPdf({
      filename: "PMAPC500 SDS.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    expect(ok.ok).toBe(true);
    expect(isPdfBytes(Buffer.from("not-a-pdf"))).toBe(false);

    const fake = validateProductDocumentPdf({
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("hello"),
    });
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(fake.error).toMatch(/valid PDF/i);

    const nonPdfName = validateProductDocumentPdf({
      filename: "notes.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: PDF,
    });
    expect(nonPdfName.ok).toBe(false);

    const oversized = Buffer.alloc(PRODUCT_DOCUMENT_MAX_BYTES + 1, 0);
    oversized.set(Buffer.from("%PDF-"), 0);
    const over = validateProductDocumentPdf({
      filename: "huge.pdf",
      contentType: "application/pdf",
      bytes: oversized,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/20 MB/i);
  });

  it("computes stable sha256", () => {
    expect(sha256Hex(PDF)).toHaveLength(64);
    expect(sha256Hex(PDF)).toBe(sha256Hex(PDF));
  });

  it("matches exact SKU in filename including Safety Data Sheet wording", () => {
    const cands = extractSkuCandidatesFromFilename("PMAPC500 Safety Data Sheet.pdf");
    expect(cands).toContain("PMAPC500");
    const catalogue = [
      { productId: "p1", sku: "PMAPC500", name: "All Purpose Cleaner 500ml" },
      { productId: "p2", sku: "GC5000", name: "Glass Cleaner 5L" },
    ];
    const m = matchFilenameToProducts("PMAPC500 Safety Data Sheet.pdf", catalogue);
    expect(m.status).toBe("MATCHED");
    if (m.status === "MATCHED") {
      expect(m.product.sku).toBe("PMAPC500");
      expect(m.method).toBe("EXACT_SKU");
    }
  });

  it("matches normalised SKU when punctuation differs", () => {
    expect(normaliseDocumentMatchToken("PM-APC-500")).toBe("PMAPC500");
    const m = matchFilenameToProducts("PMAPC500_SDS.pdf", [
      { productId: "p1", sku: "PM-APC-500", name: "Cleaner" },
    ]);
    expect(m.status).toBe("MATCHED");
    if (m.status === "MATCHED") {
      expect(m.product.sku).toBe("PM-APC-500");
      expect(m.method).toBe("NORMALISED_SKU");
    }
  });

  it("matches a unique strong product name", () => {
    const m = matchFilenameToProducts("Power Maxed APC 500ml Safety Data Sheet.pdf", [
      { productId: "p1", sku: "ZZZ999", name: "Power Maxed APC 500ml" },
      { productId: "p2", sku: "YYY888", name: "Glass Cleaner" },
    ]);
    expect(m.status).toBe("MATCHED");
    if (m.status === "MATCHED") {
      expect(m.product.productId).toBe("p1");
      expect(m.method).toBe("PRODUCT_NAME");
    }
  });

  it("does not auto-assign ambiguous name matches", () => {
    const catalogue = [
      { productId: "a", sku: "AAA001", name: "Industrial Degreaser" },
      { productId: "b", sku: "BBB002", name: "Industrial Degreaser Plus" },
    ];
    const m = matchFilenameToProducts("Industrial Degreaser Plus SDS.pdf", catalogue);
    expect(m.status).toBe("REVIEW");
    if (m.status === "REVIEW") expect(m.products.length).toBeGreaterThan(1);
  });

  it("returns NO_MATCH when nothing reliable", () => {
    const m = matchFilenameToProducts("Unknown Cleaner SDS.pdf", [
      { productId: "p1", sku: "ZZZ999", name: "Widget" },
    ]);
    expect(m.status).toBe("NO_MATCH");
  });
});
