-- CreateEnum
CREATE TYPE "TaxStatus" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUTSIDE_SCOPE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CmsPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CmsSectionType" AS ENUM ('HERO', 'BRAND_LOGO_STRIP', 'FEATURED_BRANDS', 'CATEGORY_GRID', 'FEATURED_PRODUCTS', 'TEXT_IMAGE', 'IMAGE_TEXT', 'BENEFITS_GRID', 'TRADE_CTA', 'BANNER', 'RICH_TEXT', 'SPACER');

-- AlterEnum
ALTER TYPE "CompanyStatus" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "isDefaultBilling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDefaultDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "primaryEmail" TEXT,
ADD COLUMN     "taxStatus" "TaxStatus" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "isAccounts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPurchasing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "CompanyUserRole" NOT NULL DEFAULT 'TRADE_BUYER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "emailDeferred" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "status" "CmsPageStatus" NOT NULL DEFAULT 'DRAFT',
    "draftVersionId" TEXT,
    "publishedVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsSection" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "type" "CmsSectionType" NOT NULL,
    "config" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsMedia" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsPublishEvent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPublishEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvitation_companyId_status_idx" ON "UserInvitation"("companyId", "status");

-- CreateIndex
CREATE INDEX "UserInvitation_email_idx" ON "UserInvitation"("email");

-- CreateIndex
CREATE INDEX "UserInvitation_expiresAt_idx" ON "UserInvitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_slug_key" ON "CmsPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_draftVersionId_key" ON "CmsPage"("draftVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_publishedVersionId_key" ON "CmsPage"("publishedVersionId");

-- CreateIndex
CREATE INDEX "CmsPage_status_idx" ON "CmsPage"("status");

-- CreateIndex
CREATE INDEX "CmsPageVersion_pageId_createdAt_idx" ON "CmsPageVersion"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPageVersion_pageId_version_key" ON "CmsPageVersion"("pageId", "version");

-- CreateIndex
CREATE INDEX "CmsSection_versionId_sortOrder_idx" ON "CmsSection"("versionId", "sortOrder");

-- CreateIndex
CREATE INDEX "CmsMedia_contentType_idx" ON "CmsMedia"("contentType");

-- CreateIndex
CREATE INDEX "CmsMedia_uploadedById_idx" ON "CmsMedia"("uploadedById");

-- CreateIndex
CREATE INDEX "CmsPublishEvent_pageId_createdAt_idx" ON "CmsPublishEvent"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Address_companyId_isDefaultBilling_idx" ON "Address"("companyId", "isDefaultBilling");

-- CreateIndex
CREATE INDEX "Address_companyId_isDefaultDelivery_idx" ON "Address"("companyId", "isDefaultDelivery");

-- CreateIndex
CREATE INDEX "Company_primaryEmail_idx" ON "Company"("primaryEmail");

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "CmsPageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "CmsPageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPageVersion" ADD CONSTRAINT "CmsPageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CmsPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsSection" ADD CONSTRAINT "CmsSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CmsPageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublishEvent" ADD CONSTRAINT "CmsPublishEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CmsPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPublishEvent" ADD CONSTRAINT "CmsPublishEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CmsPageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
