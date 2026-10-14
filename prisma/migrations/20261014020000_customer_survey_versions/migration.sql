-- Versioned customer survey configuration.
-- Historic rating columns become nullable so a later scale is not forced into the original 1–5 average.

ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "overallSatisfaction" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "recommendationScore" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "productQuality" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "productConsistency" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "productRange" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "productShelfAppearance" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "customerService" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingSupport" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingChannelWebsite" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingChannelSocial" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingChannelPos" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingChannelCampaigns" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "marketingChannelMedia" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "communication" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "responseTime" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "complaintHandling" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "orderingDelivery" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "orderAccuracy" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "packagingCondition" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "speedDelivery" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "documentation" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "environmentalImportance" DROP NOT NULL;
ALTER TABLE "CustomerSurveyResponse" ALTER COLUMN "environmentalRating" DROP NOT NULL;

CREATE TYPE "CustomerSurveyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "CustomerSurveyVersion" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER,
    "status" "CustomerSurveyVersionStatus" NOT NULL,
    "document" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSurveyVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSurveyVersion_versionNumber_key" ON "CustomerSurveyVersion"("versionNumber");
CREATE UNIQUE INDEX "CustomerSurveyVersion_one_draft" ON "CustomerSurveyVersion"("status") WHERE "status" = 'DRAFT';
CREATE INDEX "CustomerSurveyVersion_status_idx" ON "CustomerSurveyVersion"("status");

ALTER TABLE "CustomerSurveyResponse" ADD COLUMN "surveyVersionId" TEXT;
ALTER TABLE "CustomerSurveyResponse" ADD COLUMN "answerSnapshot" JSONB;

CREATE INDEX "CustomerSurveyResponse_surveyVersionId_idx" ON "CustomerSurveyResponse"("surveyVersionId");

ALTER TABLE "CustomerSurveyResponse"
  ADD CONSTRAINT "CustomerSurveyResponse_surveyVersionId_fkey"
  FOREIGN KEY ("surveyVersionId") REFERENCES "CustomerSurveyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
