-- Staff manual resolution. Existing orders stay NONE / NOT_RECORDED.
-- No production order is updated by this migration.

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "manualResolutionKind" "OrderManualResolutionKind" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "manualResolutionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualResolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualResolvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "manualResolutionFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceEvidence" "OrderInvoiceEvidence" NOT NULL DEFAULT 'NOT_RECORDED';

CREATE INDEX IF NOT EXISTS "Order_manualResolutionKind_idx" ON "Order"("manualResolutionKind");
CREATE INDEX IF NOT EXISTS "Order_manualResolvedByUserId_idx" ON "Order"("manualResolvedByUserId");

DO $$
BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_manualResolvedByUserId_fkey"
    FOREIGN KEY ("manualResolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
