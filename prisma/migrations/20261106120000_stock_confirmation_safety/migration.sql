-- New catalogue variants default to DENY (do not inherit global ALLOW for unknown stock).
-- Existing ProductVariant.backorderPolicy values are preserved.
ALTER TABLE "ProductVariant"
  ALTER COLUMN "backorderPolicy" SET DEFAULT 'DENY';

-- Manual stock override (survives Autopart polls; qtyOnHand remains latest Autopart Avail).
ALTER TABLE "Inventory"
  ADD COLUMN IF NOT EXISTS "manualOverrideQty" INTEGER,
  ADD COLUMN IF NOT EXISTS "manualOverrideReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualOverrideAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualOverrideByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Inventory_manualOverrideQty_idx" ON "Inventory"("manualOverrideQty");

-- First-time inventory confirmations (including Avail 0) — distinct from unchanged.
ALTER TABLE "StockSyncRun"
  ADD COLUMN IF NOT EXISTS "newlyConfirmed" INTEGER NOT NULL DEFAULT 0;

-- Confirm-before-apply staging for manual 231PO3NEW uploads.
CREATE TABLE IF NOT EXISTS "StockSyncPreview" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "encoding" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "fileText" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "consumedRunId" TEXT,

    CONSTRAINT "StockSyncPreview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockSyncPreview_actorUserId_createdAt_idx"
  ON "StockSyncPreview"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockSyncPreview_expiresAt_idx"
  ON "StockSyncPreview"("expiresAt");
CREATE INDEX IF NOT EXISTS "StockSyncPreview_fileHash_idx"
  ON "StockSyncPreview"("fileHash");
