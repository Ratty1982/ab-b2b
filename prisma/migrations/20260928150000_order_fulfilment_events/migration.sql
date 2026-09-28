-- Customer fulfilment tracking + ORDER_PART_DESPATCHED (Phase 6C follow-on).

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE IF NOT EXISTS 'ORDER_PART_DESPATCHED';

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "despatchedQty" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "OrderItem_despatchedQty_idx" ON "OrderItem"("despatchedQty");

DO $$ BEGIN
  CREATE TYPE "OrderFulfilmentEventKind" AS ENUM (
    'ORDER_RECEIVED',
    'EXPORTED_FOR_PROCESSING',
    'INVOICE_LINKED',
    'PART_DESPATCHED',
    'DESPATCHED',
    'NOTE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "OrderFulfilmentEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" "OrderFulfilmentEventKind" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "invoiceId" TEXT,
  "lineQuantitiesKnown" BOOLEAN NOT NULL DEFAULT false,
  "limitation" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFulfilmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderFulfilmentEvent_orderId_occurredAt_idx"
  ON "OrderFulfilmentEvent"("orderId", "occurredAt");

DO $$ BEGIN
  ALTER TABLE "OrderFulfilmentEvent"
    ADD CONSTRAINT "OrderFulfilmentEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrderFulfilmentEvent"
    ADD CONSTRAINT "OrderFulfilmentEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
