-- 504 + TRM21QC B2B fulfilment switch, document diagnostics, optional TRM line company.

CREATE TYPE "Autopart504TrmFulfilmentMode" AS ENUM ('OFF', 'PREVIEW', 'ACTIVE');
CREATE TYPE "Autopart504cRuntimeMode" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "AutopartDocumentFulfilmentStatus" AS ENUM (
  'WAITING_FOR_504',
  'WAITING_FOR_TRM',
  'MATCHED',
  'VALUE_MISMATCH',
  'LINE_MATCH_REVIEW',
  'FULFILMENT_APPLIED',
  'REVIEW_REQUIRED',
  'SKIPPED_CREDIT',
  'SKIPPED_TERMINAL',
  'SKIPPED_BEFORE_FROM',
  'NOT_AB_ORDER'
);

ALTER TABLE "Autopart504cFeedSettings"
  ADD COLUMN "runtimeMode" "Autopart504cRuntimeMode" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "AutopartOngoingSalesFeedSettings"
  ADD COLUMN "fulfilmentMode" "Autopart504TrmFulfilmentMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "fulfilmentFrom" TIMESTAMP(3),
  ADD COLUMN "fulfilmentLastPreviewAt" TIMESTAMP(3),
  ADD COLUMN "fulfilmentLastAppliedAt" TIMESTAMP(3);

-- Default activation boundary = now so historic 504/TRM is not auto-replayed.
UPDATE "AutopartOngoingSalesFeedSettings"
SET "fulfilmentFrom" = CURRENT_TIMESTAMP
WHERE "fulfilmentFrom" IS NULL;

ALTER TABLE "AutopartSalesDocument"
  ADD COLUMN "fulfilmentStatus" "AutopartDocumentFulfilmentStatus",
  ADD COLUMN "fulfilmentAppliedAt" TIMESTAMP(3),
  ADD COLUMN "fulfilmentFingerprint" TEXT,
  ADD COLUMN "fulfilmentWarning" TEXT;

CREATE INDEX "AutopartSalesDocument_fulfilmentStatus_idx"
  ON "AutopartSalesDocument"("fulfilmentStatus");

ALTER TABLE "AutopartSalesLine"
  ALTER COLUMN "companyId" DROP NOT NULL;

-- Keep the earliest line when the same Autopart document/line was stored twice.
DELETE FROM "AutopartSalesLine" a
WHERE a."documentId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "AutopartSalesLine" b
    WHERE b."documentId" = a."documentId"
      AND b."lineNumber" = a."lineNumber"
      AND b."id" < a."id"
  );

CREATE UNIQUE INDEX "AutopartSalesLine_documentId_lineNumber_key"
  ON "AutopartSalesLine"("documentId", "lineNumber");
