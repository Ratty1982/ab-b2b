import { describe, expect, it } from "vitest";

import {
  CERTIFICATION_DEFAULT_ALT,
  INITIAL_ISO_CERTIFICATION_DRAFT,
  certificationPdfCacheControl,
  certificationPdfPublicPath,
  certificationUpsertSchema,
  isCertificationPubliclyVisible,
  isPdfBytes,
  londonCalendarDate,
  parseStandardsInput,
  publishingRequirementsMet,
} from "@/domain/certifications";
import { assertImageBufferForBadge } from "@/server/certifications/badge";

describe("isCertificationPubliclyVisible", () => {
  it("hides unpublished and archived records", () => {
    expect(
      isCertificationPubliclyVisible({ published: false, archived: false, expiryDate: null }),
    ).toBe(false);
    expect(
      isCertificationPubliclyVisible({ published: true, archived: true, expiryDate: null }),
    ).toBe(false);
  });

  it("shows published records without expiry", () => {
    expect(
      isCertificationPubliclyVisible({ published: true, archived: false, expiryDate: null }),
    ).toBe(true);
  });

  it("hides records past London calendar expiry", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    expect(
      isCertificationPubliclyVisible({
        published: true,
        archived: false,
        expiryDate: new Date("2026-11-01T12:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      isCertificationPubliclyVisible({
        published: true,
        archived: false,
        expiryDate: new Date("2026-11-02T12:00:00.000Z"),
        now,
      }),
    ).toBe(true);
  });
});

describe("certificationUpsertSchema", () => {
  it("defaults to unpublished and accepts the Citation draft", () => {
    const parsed = certificationUpsertSchema.parse({
      title: INITIAL_ISO_CERTIFICATION_DRAFT.title,
      issuingOrganisation: INITIAL_ISO_CERTIFICATION_DRAFT.issuingOrganisation,
      certificateNumber: INITIAL_ISO_CERTIFICATION_DRAFT.certificateNumber,
      standards: [...INITIAL_ISO_CERTIFICATION_DRAFT.standards],
      description: INITIAL_ISO_CERTIFICATION_DRAFT.description,
      imageAltText: CERTIFICATION_DEFAULT_ALT,
    });
    expect(parsed.published).toBe(false);
    expect(parsed.issueDate).toBeNull();
    expect(parsed.expiryDate).toBeNull();
    expect(parsed.standards).toEqual(["ISO 9001:2015", "ISO 14001:2015"]);
  });

  it("normalises blank dates to null", () => {
    const parsed = certificationUpsertSchema.parse({
      title: "ISO",
      issuingOrganisation: "Citation",
      issueDate: "",
      expiryDate: null,
    });
    expect(parsed.issueDate).toBeNull();
    expect(parsed.expiryDate).toBeNull();
  });
});

describe("parseStandardsInput / pdf helpers", () => {
  it("parses standards from newlines and commas", () => {
    expect(parseStandardsInput("ISO 9001:2015\nISO 14001:2015")).toEqual([
      "ISO 9001:2015",
      "ISO 14001:2015",
    ]);
    expect(parseStandardsInput("ISO 9001:2015, ISO 14001:2015")).toEqual([
      "ISO 9001:2015",
      "ISO 14001:2015",
    ]);
  });

  it("detects PDF magic bytes and builds public paths", () => {
    expect(isPdfBytes(Buffer.from("%PDF-1.7"))).toBe(true);
    expect(isPdfBytes(Buffer.from("not-a-pdf"))).toBe(false);
    expect(certificationPdfPublicPath("abc/def")).toBe(
      "/api/certifications/abc%2Fdef/certificate",
    );
  });

  it("formats London calendar dates as YYYY-MM-DD", () => {
    expect(londonCalendarDate(new Date("2026-11-02T01:30:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses a no-store cache policy for certificate PDFs", () => {
    expect(certificationPdfCacheControl("public")).toBe("private, no-store");
    expect(certificationPdfCacheControl("admin")).toBe("private, no-store");
    expect(certificationPdfCacheControl("missing")).toBe("private, no-store");
  });
});

describe("publishing and badge validation", () => {
  it("blocks publishing without a badge", () => {
    expect(
      publishingRequirementsMet({
        published: true,
        imageMediaId: null,
        title: "ISO",
        issuingOrganisation: "Citation",
      }),
    ).toEqual({
      ok: false,
      error: "Upload a certification badge before publishing",
    });
  });

  it("allows drafts without a badge and published records with a badge", () => {
    expect(
      publishingRequirementsMet({
        published: false,
        imageMediaId: null,
        title: "ISO",
        issuingOrganisation: "Citation",
      }).ok,
    ).toBe(true);
    expect(
      publishingRequirementsMet({
        published: true,
        imageMediaId: "media-1",
        title: "ISO",
        issuingOrganisation: "Citation",
      }).ok,
    ).toBe(true);
  });

  it("rejects invalid badge image bytes", () => {
    expect(() => assertImageBufferForBadge(Buffer.from("%PDF-1.7"))).toThrow(/PNG, JPEG, or WebP/);
    expect(() => assertImageBufferForBadge(Buffer.from("not-an-image"))).toThrow(
      /PNG, JPEG, or WebP/,
    );
    // Minimal PNG signature is enough for sniff; size check still applies.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(() => assertImageBufferForBadge(png)).not.toThrow();
  });

  it("hides unpublished drafts from public visibility checks used by PDF access", () => {
    expect(
      isCertificationPubliclyVisible({
        published: false,
        archived: false,
        expiryDate: null,
      }),
    ).toBe(false);
  });
});
