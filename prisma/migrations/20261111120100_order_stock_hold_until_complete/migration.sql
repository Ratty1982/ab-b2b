-- Hold-until-complete stock release policy (orthogonal to OrderStatus).
-- Defaults only — no historical order mutation beyond new column defaults.

CREATE TYPE "OrderStockReleasePolicy" AS ENUM ('SHIP_AS_AVAILABLE', 'HOLD_UNTIL_COMPLETE');
CREATE TYPE "OrderStockHoldState" AS ENUM ('NONE', 'WAITING_STOCK', 'READY_TO_EXPORT', 'CANCELLED_HOLD');

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE IF NOT EXISTS 'ORDER_STOCK_HOLD_READY_INTERNAL';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "stockReleasePolicy" "OrderStockReleasePolicy" NOT NULL DEFAULT 'SHIP_AS_AVAILABLE',
  ADD COLUMN IF NOT EXISTS "stockHoldState" "OrderStockHoldState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "stockHeldAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockHeldByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "stockHoldLastCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockHoldLastCheckResult" JSONB,
  ADD COLUMN IF NOT EXISTS "stockReleasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockReleaseReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stockHoldCancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockHoldCancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stockHoldCancelledByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Order_stockHoldState_stockHeldAt_idx"
  ON "Order"("stockHoldState", "stockHeldAt");
CREATE INDEX IF NOT EXISTS "Order_stockHeldByUserId_idx"
  ON "Order"("stockHeldByUserId");
CREATE INDEX IF NOT EXISTS "Order_stockHoldCancelledByUserId_idx"
  ON "Order"("stockHoldCancelledByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_stockHeldByUserId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_stockHeldByUserId_fkey"
      FOREIGN KEY ("stockHeldByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_stockHoldCancelledByUserId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_stockHoldCancelledByUserId_fkey"
      FOREIGN KEY ("stockHoldCancelledByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
