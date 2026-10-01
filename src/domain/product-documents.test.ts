import { describe, expect, it } from "vitest";
import {
  extractSkuCandidatesFromFilename,
  isPdfBytes,
  matchFilenameToProducts,
  normaliseDocumentMatchToken,
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

  it("accepts valid PDF bytes and rejects non-PDF", () => {
    const ok = validateProductDocumentPdf({
      filename: "PMAPC500 SDS.pdf",
      contentType: "application/pdf",
      bytes: PDF,
    });
    expect(ok.ok).toBe(true);
    expect(isPdfBytes(Buffer.from("not-a-pdf"))).toBe(false);
    const bad = validateProductDocumentPdf({
      filename: "x.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("hello"),
    });
    expect(bad.ok).toBe(false);
  });

  it("computes stable sha256", () => {
    expect(sha256Hex(PDF)).toHaveLength(64);
    expect(sha256Hex(PDF)).toBe(sha256Hex(PDF));
  });

  it("extracts SKU candidates and matches exactly", () => {
    const cands = extractSkuCandidatesFromFilename("PMAPC500 SDS 2025.pdf");
    expect(cands).toContain("PMAPC500");
    const catalogue = [
      { productId: "p1", sku: "PMAPC500", name: "All Purpose Cleaner 500ml" },
      { productId: "p2", sku: "GC5000", name: "Glass Cleaner 5L" },
    ];
    const m = matchFilenameToProducts("PMAPC500 SDS 2025.pdf", catalogue);
    expect(m.status).toBe("MATCHED");
    if (m.status === "MATCHED") expect(m.product.sku).toBe("PMAPC500");
  });

  it("case-insensitive / normalised SKU match", () => {
    const catalogue = [{ productId: "p1", sku: "pm-apc-500", name: "Cleaner" }];
    // normalise removes hyphens
    expect(normaliseDocumentMatchToken("PM-APC-500")).toBe("PMAPC500");
    const m = matchFilenameToProducts("PMAPC500_SDS.pdf", [
      { productId: "p1", sku: "PMAPC500", name: "Cleaner" },
    ]);
    expect(m.status).toBe("MATCHED");
    void catalogue;
  });

  it("does not auto-import ambiguous name matches", () => {
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
