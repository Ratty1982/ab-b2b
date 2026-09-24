-- Phase 6B addendum: AB stock reservations + transactional email outbox
-- Additive only. Does NOT submit orders to Autopart.
-- Sync must NEVER reset Inventory.qtyReserved.

CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

CREATE TYPE "TransactionalEmailPurpose" AS ENUM ('ORDER_RECEIVED', 'ORDER_RECEIVED_INTERNAL');

CREATE TYPE "TransactionalEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEFERRED');

CREATE TABLE "OrderStockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "variantId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OrderStockReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransactionalEmail" (
    "id" TEXT NOT NULL,
    "purpose" "TransactionalEmailPurpose" NOT NULL,
    "status" "TransactionalEmailStatus" NOT NULL DEFAULT 'PENDING',
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionalEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStockReservation_orderId_idx" ON "OrderStockReservation"("orderId");
CREATE INDEX "OrderStockReservation_variantId_status_idx" ON "OrderStockReservation"("variantId", "status");
CREATE INDEX "OrderStockReservation_inventoryId_status_idx" ON "OrderStockReservation"("inventoryId", "status");

CREATE UNIQUE INDEX "TransactionalEmail_idempotencyKey_key" ON "TransactionalEmail"("idempotencyKey");
CREATE INDEX "TransactionalEmail_entityType_entityId_idx" ON "TransactionalEmail"("entityType", "entityId");
CREATE INDEX "TransactionalEmail_status_idx" ON "TransactionalEmail"("status");

ALTER TABLE "OrderStockReservation" ADD CONSTRAINT "OrderStockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStockReservation" ADD CONSTRAINT "OrderStockReservation_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
