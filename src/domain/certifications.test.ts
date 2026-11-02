import { describe, expect, it } from "vitest";

import {
  CERTIFICATION_DEFAULT_ALT,
  INITIAL_ISO_CERTIFICATION_DRAFT,
  certificationPdfPublicPath,
  certificationUpsertSchema,
  isCertificationPubliclyVisible,
  isPdfBytes,
  londonCalendarDate,
  parseStandardsInput,
} from "@/domain/certifications";

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
});
