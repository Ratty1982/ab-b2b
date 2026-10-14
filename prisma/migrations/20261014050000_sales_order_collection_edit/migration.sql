-- Sales order collection, blank draft quantities, backorder acknowledgement, and commercial edits.

CREATE TYPE "OrderFulfilmentChoice" AS ENUM ('DELIVERY', 'COLLECTION');

ALTER TABLE "Order"
  ADD COLUMN "fulfilmentChoice" "OrderFulfilmentChoice" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "backorderAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "backorderAcknowledgedByUserId" TEXT,
  ADD COLUMN "editIdempotencyKey" TEXT;

ALTER TABLE "SalesOrderDraft"
  ADD COLUMN "fulfilmentChoice" "OrderFulfilmentChoice" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "editingOrderId" TEXT;

ALTER TABLE "SalesOrderDraftLine" ALTER COLUMN "qty" DROP NOT NULL;

CREATE UNIQUE INDEX "Order_editIdempotencyKey_key" ON "Order"("editIdempotencyKey");
CREATE INDEX "Order_backorderAcknowledgedByUserId_idx" ON "Order"("backorderAcknowledgedByUserId");
CREATE INDEX "Order_fulfilmentChoice_idx" ON "Order"("fulfilmentChoice");
CREATE INDEX "SalesOrderDraft_editingOrderId_idx" ON "SalesOrderDraft"("editingOrderId");

-- One open edit draft per order. Placed and abandoned drafts do not hold the slot.
CREATE UNIQUE INDEX "SalesOrderDraft_open_edit_order_key"
  ON "SalesOrderDraft" ("editingOrderId")
  WHERE status = 'OPEN' AND "editingOrderId" IS NOT NULL;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_backorderAcknowledgedByUserId_fkey"
  FOREIGN KEY ("backorderAcknowledgedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesOrderDraft"
  ADD CONSTRAINT "SalesOrderDraft_editingOrderId_fkey"
  FOREIGN KEY ("editingOrderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
