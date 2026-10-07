-- Current Amazon FBA stock, stored separately from SS warehouse Avail.
-- Location FBA is the user-facing stock. sourceBranch keeps the Autopart code OPTIMUS.
-- Inventory and AutopartProduct.availQty are not modified by this migration.

CREATE TABLE "AutopartFbaStockImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actorUserId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productsProcessed" INTEGER NOT NULL DEFAULT 0,
    "matchedExisting" INTEGER NOT NULL DEFAULT 0,
    "newProducts" INTEGER NOT NULL DEFAULT 0,
    "productsWithStock" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "changedQuantities" INTEGER NOT NULL DEFAULT 0,
    "zeroStock" INTEGER NOT NULL DEFAULT 0,
    "absentZeroed" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateSkus" INTEGER NOT NULL DEFAULT 0,
    "completeSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "sourceBranch" TEXT NOT NULL,
    "warnings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopartFbaStockImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartFbaStockImport_fileHash_key" ON "AutopartFbaStockImport"("fileHash");
CREATE INDEX "AutopartFbaStockImport_importedAt_idx" ON "AutopartFbaStockImport"("importedAt");
CREATE INDEX "AutopartFbaStockImport_actorUserId_idx" ON "AutopartFbaStockImport"("actorUserId");

CREATE TABLE "AutopartLocationStock" (
    "id" TEXT NOT NULL,
    "autopartProductId" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "sourceBranch" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "sourceImportedAt" TIMESTAMP(3) NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartLocationStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopartLocationStock_autopartProductId_locationCode_key" ON "AutopartLocationStock"("autopartProductId", "locationCode");
CREATE INDEX "AutopartLocationStock_locationCode_idx" ON "AutopartLocationStock"("locationCode");
CREATE INDEX "AutopartLocationStock_importId_idx" ON "AutopartLocationStock"("importId");

ALTER TABLE "AutopartLocationStock" ADD CONSTRAINT "AutopartLocationStock_autopartProductId_fkey" FOREIGN KEY ("autopartProductId") REFERENCES "AutopartProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopartLocationStock" ADD CONSTRAINT "AutopartLocationStock_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AutopartFbaStockImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
