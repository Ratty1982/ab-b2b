import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AboutCertificationsSection,
  FooterCertifications,
  HomepageCertificationsSection,
} from "@/components/public/PublicCertifications";
import {
  CERTIFICATION_DEFAULT_ALT,
  CERTIFICATION_HOMEPAGE_HEADING,
  type PublicCertification,
} from "@/domain/certifications";

const published: PublicCertification = {
  id: "cert-1",
  title: "ISO 9001 & ISO 14001 Certified",
  issuingOrganisation: "Citation ISO Certification",
  certificateNumber: "530712026",
  standards: ["ISO 9001:2015", "ISO 14001:2015"],
  scope: null,
  description:
    "Automotive Brands operates an integrated management system certified to ISO 9001:2015 and ISO 14001:2015.",
  imageSrc: "/api/cms/media/badge.png",
  imageAlt: CERTIFICATION_DEFAULT_ALT,
  imageWidth: 371,
  imageHeight: 175,
  certificatePdfUrl: "/api/certifications/cert-1/certificate",
  issueDate: null,
  expiryDate: null,
  showOnHomepage: true,
  showInFooter: true,
  showOnAboutPage: true,
  displayOrder: 0,
};

describe("HomepageCertificationsSection", () => {
  it("hides when no homepage badges are available", () => {
    const html = renderToStaticMarkup(
      createElement(HomepageCertificationsSection, {
        certifications: [{ ...published, showOnHomepage: false }],
      }),
    );
    expect(html).toBe("");
  });

  it("renders heading, supporting copy, badge and certificate link", () => {
    const html = renderToStaticMarkup(
      createElement(HomepageCertificationsSection, { certifications: [published] }),
    );
    expect(html).toContain(CERTIFICATION_HOMEPAGE_HEADING.replace(/&/g, "&amp;"));
    expect(html).toContain("View Certificate");
    expect(html).toContain(published.imageSrc!);
    expect(html).toContain(CERTIFICATION_DEFAULT_ALT);
    expect(html).toContain("object-contain");
  });
});

describe("FooterCertifications", () => {
  it("keeps compact badge links with light backgrounds", () => {
    const html = renderToStaticMarkup(
      createElement(FooterCertifications, { certifications: [published] }),
    );
    expect(html).toContain("Accreditations");
    expect(html).toContain("bg-white/95");
    expect(html).toContain(published.certificatePdfUrl!);
  });

  it("falls back to Why Us certifications anchor without a PDF", () => {
    const html = renderToStaticMarkup(
      createElement(FooterCertifications, {
        certifications: [{ ...published, certificatePdfUrl: null }],
      }),
    );
    expect(html).toContain("/why-automotive-brands#certifications");
  });
});

describe("AboutCertificationsSection", () => {
  it("renders managed details without inventing validity dates", () => {
    const html = renderToStaticMarkup(
      createElement(AboutCertificationsSection, { certifications: [published] }),
    );
    expect(html).toContain("ISO 9001 &amp; ISO 14001 Certified");
    expect(html).toContain("Citation ISO Certification");
    expect(html).toContain("530712026");
    expect(html).toContain("ISO 9001:2015");
    expect(html).not.toContain("Issued ");
    expect(html).not.toContain("Valid until");
  });
});
