-- Customer satisfaction survey responses and prize-draw claims.

CREATE TYPE "CustomerSurveySource" AS ENUM ('PORTAL', 'WORDPRESS_IMPORT');

CREATE TYPE "SurveyEmailDeliveryStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED_IMPORT',
  'NO_RECIPIENT'
);

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'CUSTOMER_SURVEY_ACK';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'CUSTOMER_SURVEY_INTERNAL';

ALTER TABLE "EmailSettings"
  ADD COLUMN "surveyNotificationRecipients" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "CustomerSurveyResponse" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "source" "CustomerSurveySource" NOT NULL DEFAULT 'PORTAL',
  "legacyWordpressId" INTEGER,
  "idempotencyKey" TEXT,
  "submissionTokenHash" TEXT,
  "ipHash" TEXT,
  "overallSatisfaction" INTEGER NOT NULL,
  "recommendationScore" INTEGER NOT NULL,
  "productQuality" INTEGER NOT NULL,
  "productConsistency" INTEGER NOT NULL,
  "productRange" INTEGER NOT NULL,
  "productShelfAppearance" INTEGER NOT NULL,
  "customerService" INTEGER NOT NULL,
  "marketingSupport" INTEGER NOT NULL,
  "marketingChannelWebsite" INTEGER NOT NULL,
  "marketingChannelSocial" INTEGER NOT NULL,
  "marketingChannelPos" INTEGER NOT NULL,
  "marketingChannelCampaigns" INTEGER NOT NULL,
  "marketingChannelMedia" INTEGER NOT NULL,
  "salesHelpOptions" JSONB NOT NULL,
  "communication" INTEGER NOT NULL,
  "responseTime" INTEGER NOT NULL,
  "complaintHandling" INTEGER NOT NULL,
  "orderingDelivery" INTEGER NOT NULL,
  "orderAccuracy" INTEGER NOT NULL,
  "packagingCondition" INTEGER NOT NULL,
  "speedDelivery" INTEGER NOT NULL,
  "documentation" INTEGER NOT NULL,
  "environmentalImportance" INTEGER NOT NULL,
  "environmentalRating" INTEGER NOT NULL,
  "doWell" TEXT NOT NULL DEFAULT '',
  "couldImprove" TEXT NOT NULL DEFAULT '',
  "productRequests" TEXT NOT NULL DEFAULT '',
  "additionalComments" TEXT NOT NULL DEFAULT '',
  "contactPermission" TEXT NOT NULL,
  "customerName" TEXT NOT NULL DEFAULT '',
  "customerEmail" TEXT NOT NULL DEFAULT '',
  "customerEmailNormalized" TEXT NOT NULL DEFAULT '',
  "customerPhone" TEXT NOT NULL DEFAULT '',
  "businessName" TEXT NOT NULL DEFAULT '',
  "businessNameNormalized" TEXT NOT NULL DEFAULT '',
  "prizeDrawRequested" BOOLEAN NOT NULL DEFAULT false,
  "prizeDrawAccepted" BOOLEAN NOT NULL DEFAULT false,
  "prizeDrawRejectionReason" TEXT,
  "ukResidentAdultConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "notConnectedConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
  "eligibilityDeclarationsHeld" BOOLEAN NOT NULL DEFAULT false,
  "ackEmailStatus" "SurveyEmailDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "ackEmailSentAt" TIMESTAMP(3),
  "internalEmailStatus" "SurveyEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "internalEmailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerSurveyResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSurveyPrizeClaim" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,

  CONSTRAINT "CustomerSurveyPrizeClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSurveyResponse_reference_key" ON "CustomerSurveyResponse"("reference");
CREATE UNIQUE INDEX "CustomerSurveyResponse_legacyWordpressId_key" ON "CustomerSurveyResponse"("legacyWordpressId");
CREATE UNIQUE INDEX "CustomerSurveyResponse_idempotencyKey_key" ON "CustomerSurveyResponse"("idempotencyKey");
CREATE INDEX "CustomerSurveyResponse_submittedAt_idx" ON "CustomerSurveyResponse"("submittedAt");
CREATE INDEX "CustomerSurveyResponse_recommendationScore_idx" ON "CustomerSurveyResponse"("recommendationScore");
CREATE INDEX "CustomerSurveyResponse_contactPermission_idx" ON "CustomerSurveyResponse"("contactPermission");
CREATE INDEX "CustomerSurveyResponse_prizeDrawAccepted_idx" ON "CustomerSurveyResponse"("prizeDrawAccepted");
CREATE INDEX "CustomerSurveyResponse_customerEmailNormalized_idx" ON "CustomerSurveyResponse"("customerEmailNormalized");
CREATE INDEX "CustomerSurveyResponse_businessNameNormalized_idx" ON "CustomerSurveyResponse"("businessNameNormalized");
CREATE INDEX "CustomerSurveyResponse_submissionTokenHash_idx" ON "CustomerSurveyResponse"("submissionTokenHash");
CREATE INDEX "CustomerSurveyResponse_ipHash_submittedAt_idx" ON "CustomerSurveyResponse"("ipHash", "submittedAt");

CREATE UNIQUE INDEX "CustomerSurveyPrizeClaim_kind_normalizedValue_key" ON "CustomerSurveyPrizeClaim"("kind", "normalizedValue");
CREATE INDEX "CustomerSurveyPrizeClaim_responseId_idx" ON "CustomerSurveyPrizeClaim"("responseId");

ALTER TABLE "CustomerSurveyPrizeClaim"
  ADD CONSTRAINT "CustomerSurveyPrizeClaim_responseId_fkey"
  FOREIGN KEY ("responseId") REFERENCES "CustomerSurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
