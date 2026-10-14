-- Super Admin archive for test orders. Does not delete financial or fulfilment history.

ALTER TABLE "Order" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "archivedByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "Order_archivedAt_idx" ON "Order"("archivedAt");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
