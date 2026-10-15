-- Counts, original-byte locations, and snapshot gaps for the all-accounts import.
-- No financial rows are updated.

ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "storagePath561l" TEXT;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "storagePathSlrb" TEXT;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "encoding561l" TEXT;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "encodingSlrb" TEXT;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "parsed561l" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "parsedSlrb" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "malformed561l" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "malformedSlrb" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "excludedLedger" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "stagedLineCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "importedLineCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "discrepancyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "peakRssBytes" INTEGER;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "elapsedMs" INTEGER;

CREATE TYPE "AutopartHistoryGapStatus" AS ENUM ('OPEN', 'RETIRED');

CREATE TABLE "AutopartHistorySnapshotGap" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "documentType" "AutopartHistoricDocumentType" NOT NULL,
  "documentReference" TEXT NOT NULL,
  "goodsNet" DECIMAL(14,2),
  "status" "AutopartHistoryGapStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "AutopartHistorySnapshotGap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartHistorySnapshotGap_importId_companyId_documentType_key"
  ON "AutopartHistorySnapshotGap"("importId", "companyId", "documentType", "documentReference");
CREATE INDEX "AutopartHistorySnapshotGap_importId_status_idx"
  ON "AutopartHistorySnapshotGap"("importId", "status");

ALTER TABLE "AutopartHistorySnapshotGap"
  ADD CONSTRAINT "AutopartHistorySnapshotGap_importId_fkey"
  FOREIGN KEY ("importId") REFERENCES "AutopartHistoryAllImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
