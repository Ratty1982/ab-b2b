-- Additive site certifications / accreditations for the public website CMS.
-- Does not rewrite homepage sections, orders, stock, pricing, or CRM data.
-- Records default to unpublished so badges must be reviewed before going live.

CREATE TABLE "SiteCertification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "issuingOrganisation" TEXT NOT NULL,
  "certificateNumber" TEXT,
  "standards" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "scope" TEXT,
  "description" TEXT,
  "imageMediaId" TEXT,
  "imageAltText" TEXT,
  "certificatePdfStorageKey" TEXT,
  "certificatePdfStorageProvider" TEXT,
  "certificatePdfFilename" TEXT,
  "certificatePdfContentType" TEXT,
  "certificatePdfSizeBytes" INTEGER,
  "certificatePdfBytes" BYTEA,
  "issueDate" TIMESTAMP(3),
  "expiryDate" TIMESTAMP(3),
  "published" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "showOnHomepage" BOOLEAN NOT NULL DEFAULT true,
  "showInFooter" BOOLEAN NOT NULL DEFAULT true,
  "showOnAboutPage" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,

  CONSTRAINT "SiteCertification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteCertification_published_archived_displayOrder_idx"
  ON "SiteCertification"("published", "archived", "displayOrder");
CREATE INDEX "SiteCertification_showOnHomepage_published_archived_idx"
  ON "SiteCertification"("showOnHomepage", "published", "archived");
CREATE INDEX "SiteCertification_showInFooter_published_archived_idx"
  ON "SiteCertification"("showInFooter", "published", "archived");
CREATE INDEX "SiteCertification_showOnAboutPage_published_archived_idx"
  ON "SiteCertification"("showOnAboutPage", "published", "archived");

ALTER TABLE "SiteCertification"
  ADD CONSTRAINT "SiteCertification_imageMediaId_fkey"
  FOREIGN KEY ("imageMediaId") REFERENCES "CmsMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
