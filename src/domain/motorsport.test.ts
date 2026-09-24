import { describe, expect, it } from "vitest";
import {
  MOTORSPORT_PARTNERSHIP_LEAD_SOURCE,
  formatMotorsportLeadNotes,
  motorsportPartnershipEnquirySchema,
  HOMEPAGE_MOTORSPORT_DEFAULTS,
  MOTORSPORT_PAGE_DEFAULTS,
} from "@/domain/motorsport";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";
import { defaultHomepageSections } from "@/server/cms/homepage-seed";
import { validateSectionConfig } from "@/domain/cms";

describe("motorsport partnership enquiry validation", () => {
  const valid = {
    companyName: "Acme Automotive",
    contactName: "Alex Partner",
    email: "alex@acme.example",
    telephone: "01234567890",
    industry: "Lubricants",
    interestedIn: "Brand Partnership" as const,
    approximateBudget: "£10,000–£25,000" as const,
    message: "Interested in discussing brand exposure with Power Maxed Racing.",
    consent: true as const,
    websiteConfirm: "",
  };

  it("accepts a complete enquiry", () => {
    const parsed = motorsportPartnershipEnquirySchema.parse(valid);
    expect(parsed.email).toBe("alex@acme.example");
    expect(parsed.interestedIn).toBe("Brand Partnership");
  });

  it("rejects invalid email", () => {
    expect(() =>
      motorsportPartnershipEnquirySchema.parse({ ...valid, email: "not-an-email" }),
    ).toThrow();
  });

  it("rejects invalid interest enum", () => {
    expect(() =>
      motorsportPartnershipEnquirySchema.parse({ ...valid, interestedIn: "VIP Package" }),
    ).toThrow();
  });

  it("requires company, contact, message and consent", () => {
    expect(() =>
      motorsportPartnershipEnquirySchema.parse({ ...valid, companyName: "" }),
    ).toThrow();
    expect(() =>
      motorsportPartnershipEnquirySchema.parse({ ...valid, contactName: "" }),
    ).toThrow();
    expect(() => motorsportPartnershipEnquirySchema.parse({ ...valid, message: "" })).toThrow();
    expect(() =>
      motorsportPartnershipEnquirySchema.parse({ ...valid, consent: false }),
    ).toThrow();
  });

  it("formats lead notes without inventing package claims", () => {
    const notes = formatMotorsportLeadNotes({
      interestedIn: "Hospitality",
      approximateBudget: "Not sure yet",
      industry: "Retail",
      message: "Please call me.",
    });
    expect(notes).toContain("Interest: Hospitality");
    expect(notes).toContain("Budget: Not sure yet");
    expect(notes).toContain("Please call me.");
    expect(MOTORSPORT_PARTNERSHIP_LEAD_SOURCE).toBe("MOTORSPORT_PARTNERSHIP");
  });
});

describe("motorsport CMS seeds", () => {
  it("includes homepage MOTORSPORT_FEATURE before TRADE_CTA", () => {
    const types = defaultHomepageSections().map((s) => s.type);
    expect(types).toContain("MOTORSPORT_FEATURE");
    expect(types.indexOf("MOTORSPORT_FEATURE")).toBeLessThan(types.indexOf("TRADE_CTA"));
    const section = defaultHomepageSections().find((s) => s.type === "MOTORSPORT_FEATURE")!;
    expect(section.enabled).not.toBe(false);
    expect(section.config["ctaHref"]).toBe("/motorsport");
    expect(section.config["secondaryCtaHref"]).toBe("/motorsport#partnerships");
    expect(validateSectionConfig("MOTORSPORT_FEATURE", section.config)).toMatchObject({
      eyebrow: HOMEPAGE_MOTORSPORT_DEFAULTS.eyebrow,
    });
  });

  it("seeds /motorsport marketing CMS page with SEO and gallery", () => {
    const page = marketingCmsPageBySlug("motorsport");
    expect(page).toBeTruthy();
    expect(page!.seoTitle).toBe(MOTORSPORT_PAGE_DEFAULTS.seoTitle);
    expect(page!.metaDescription).toContain("Power Maxed Racing");
    expect(page!.sections.some((s) => s.type === "MEDIA_GALLERY")).toBe(true);
    expect(page!.sections.some((s) => s.type === "MOTORSPORT_FEATURE")).toBe(true);
    expect(page!.primaryNav).toBe(true);
  });
});
