-- Phase 6B: B2B checkout & authoritative order snapshots
-- Additive only. Does NOT submit orders to Autopart.

CREATE TABLE "OrderNumberSequence" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "OrderNumberSequence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderNumberSequence" ("id", "nextValue") VALUES ('default', 1);

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "billingAddress" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "contactSnapshot" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryInstructions" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentTermsSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autopartCustomerCodeSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autopartAccountLinked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "salesRepIdSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "salesRepCodeSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "salesRepNameSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryMethodLabel" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "basketId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Order_poNumber_idx" ON "Order"("poNumber");

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "customerUnitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "vatCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "lineVat" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "lineGross" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "caseQty" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "orderingMode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "priceSource" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "quantityBreakId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "promotionId" TEXT;
