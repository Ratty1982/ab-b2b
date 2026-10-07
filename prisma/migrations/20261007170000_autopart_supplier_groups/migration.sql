-- Explicit Autopart Group → Supplier mapping.
-- Supplier.code is not used as a group. Existing product links stay MANUAL.

ALTER TABLE "AutopartProduct" ADD COLUMN "groupCode" TEXT;

CREATE INDEX "AutopartProduct_groupCode_idx" ON "AutopartProduct"("groupCode");

CREATE TYPE "ProductSupplierSource" AS ENUM ('MANUAL', 'AUTOPART_GROUP');

ALTER TABLE "ProductSupplier" ADD COLUMN "source" "ProductSupplierSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ProductSupplier" ADD COLUMN "autopartGroupCode" TEXT;
ALTER TABLE "ProductSupplier" ADD COLUMN "supplierAutopartGroupId" TEXT;

CREATE INDEX "ProductSupplier_source_idx" ON "ProductSupplier"("source");

CREATE TABLE "SupplierAutopartGroup" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAutopartGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierAutopartGroup_supplierId_groupCode_key" ON "SupplierAutopartGroup"("supplierId", "groupCode");
CREATE INDEX "SupplierAutopartGroup_supplierId_active_idx" ON "SupplierAutopartGroup"("supplierId", "active");
CREATE INDEX "SupplierAutopartGroup_groupCode_idx" ON "SupplierAutopartGroup"("groupCode");

-- One active Autopart Group belongs to only one supplier. Inactive history may repeat the code.
CREATE UNIQUE INDEX "SupplierAutopartGroup_groupCode_active_unique"
ON "SupplierAutopartGroup" ("groupCode")
WHERE "active" = true;

ALTER TABLE "SupplierAutopartGroup" ADD CONSTRAINT "SupplierAutopartGroup_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierAutopartGroupId_fkey" FOREIGN KEY ("supplierAutopartGroupId") REFERENCES "SupplierAutopartGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductSupplier_supplierAutopartGroupId_idx" ON "ProductSupplier"("supplierAutopartGroupId");
