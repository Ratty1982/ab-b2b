-- Phase 6C: controlled trade backorders (variant policy + order-line snapshots + partial despatch).

DO $$ BEGIN
  CREATE TYPE "BackorderPolicy" AS ENUM ('DENY', 'ALLOW');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "backorderPolicy" "BackorderPolicy" NOT NULL DEFAULT 'DENY';

CREATE INDEX IF NOT EXISTS "ProductVariant_backorderPolicy_idx" ON "ProductVariant"("backorderPolicy");

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "availableQtyAtOrder" INTEGER;

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "backorderQtyAtOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "OrderItem_backorderQtyAtOrder_idx" ON "OrderItem"("backorderQtyAtOrder");

DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DESPATCHED' BEFORE 'DISPATCHED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
