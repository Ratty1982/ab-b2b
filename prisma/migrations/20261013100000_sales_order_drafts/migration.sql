-- Staff-owned sales order drafts and on-behalf order attribution.
-- Drafts do not reserve stock. Customer baskets are not modified.

CREATE TYPE "SalesOrderDraftStatus" AS ENUM ('OPEN', 'ABANDONED', 'PLACED');
CREATE TYPE "SalesOrderEntrySource" AS ENUM ('TELEPHONE', 'EMAIL', 'CUSTOMER_VISIT');

ALTER TABLE "Order" ADD COLUMN "entrySource" "SalesOrderEntrySource";
ALTER TABLE "Order" ADD COLUMN "placedByStaffUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "placedByStaffName" TEXT;
ALTER TABLE "Order" ADD COLUMN "salesOrderDraftId" TEXT;

CREATE UNIQUE INDEX "Order_salesOrderDraftId_key" ON "Order"("salesOrderDraftId");
CREATE INDEX "Order_placedByStaffUserId_idx" ON "Order"("placedByStaffUserId");
CREATE INDEX "Order_entrySource_idx" ON "Order"("entrySource");

CREATE TABLE "SalesOrderDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" "SalesOrderDraftStatus" NOT NULL DEFAULT 'OPEN',
    "source" "SalesOrderEntrySource",
    "contactId" TEXT,
    "addressId" TEXT,
    "oneOffAddress" JSONB,
    "poNumber" TEXT,
    "deliveryInstructions" TEXT,
    "internalNote" TEXT,
    "placedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderDraft_placedOrderId_key" ON "SalesOrderDraft"("placedOrderId");
CREATE INDEX "SalesOrderDraft_createdByUserId_status_idx" ON "SalesOrderDraft"("createdByUserId", "status");
CREATE INDEX "SalesOrderDraft_companyId_status_idx" ON "SalesOrderDraft"("companyId", "status");
CREATE INDEX "SalesOrderDraft_createdByUserId_companyId_status_idx" ON "SalesOrderDraft"("createdByUserId", "companyId", "status");

CREATE TABLE "SalesOrderDraftLine" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderDraftLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderDraftLine_draftId_variantId_key" ON "SalesOrderDraftLine"("draftId", "variantId");
CREATE INDEX "SalesOrderDraftLine_variantId_idx" ON "SalesOrderDraftLine"("variantId");

ALTER TABLE "SalesOrderDraft" ADD CONSTRAINT "SalesOrderDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderDraft" ADD CONSTRAINT "SalesOrderDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderDraftLine" ADD CONSTRAINT "SalesOrderDraftLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SalesOrderDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderDraftLine" ADD CONSTRAINT "SalesOrderDraftLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
