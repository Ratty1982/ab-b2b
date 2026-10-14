-- Tombstone so a deleted order number is never allocated again.
-- No foreign key to Order: the row must survive order deletion.
CREATE TABLE "RetiredOrderNumber" (
    "orderNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT,
    "previousStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "retiredByUserId" TEXT,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetiredOrderNumber_pkey" PRIMARY KEY ("orderNumber")
);

CREATE INDEX "RetiredOrderNumber_orderId_idx" ON "RetiredOrderNumber"("orderId");
CREATE INDEX "RetiredOrderNumber_retiredByUserId_idx" ON "RetiredOrderNumber"("retiredByUserId");
