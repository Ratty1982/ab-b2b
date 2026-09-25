-- Autopart CSV export handoff metadata (manual import — no APC / no Autopart API).

CREATE TYPE "AutopartExportStatus" AS ENUM ('NOT_EXPORTED', 'EXPORTED');

CREATE TABLE "AutopartExportBatchSequence" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AutopartExportBatchSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopartOrderExportBatch" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "orderIds" JSONB NOT NULL,
    "isReexport" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AutopartOrderExportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartOrderExportBatch_reference_key" ON "AutopartOrderExportBatch"("reference");
CREATE INDEX "AutopartOrderExportBatch_createdAt_idx" ON "AutopartOrderExportBatch"("createdAt");
CREATE INDEX "AutopartOrderExportBatch_createdByUserId_idx" ON "AutopartOrderExportBatch"("createdByUserId");

ALTER TABLE "AutopartOrderExportBatch" ADD CONSTRAINT "AutopartOrderExportBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "autopartExportStatus" "AutopartExportStatus" NOT NULL DEFAULT 'NOT_EXPORTED';
ALTER TABLE "Order" ADD COLUMN "autopartExportedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "autopartExportedByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "autopartExportBatchId" TEXT;
ALTER TABLE "Order" ADD COLUMN "autopartExportCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Order_autopartExportStatus_idx" ON "Order"("autopartExportStatus");
CREATE INDEX "Order_autopartExportBatchId_idx" ON "Order"("autopartExportBatchId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_autopartExportedByUserId_fkey" FOREIGN KEY ("autopartExportedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_autopartExportBatchId_fkey" FOREIGN KEY ("autopartExportBatchId") REFERENCES "AutopartOrderExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AutopartExportBatchSequence" ("id", "nextValue") VALUES ('default', 1)
ON CONFLICT ("id") DO NOTHING;
