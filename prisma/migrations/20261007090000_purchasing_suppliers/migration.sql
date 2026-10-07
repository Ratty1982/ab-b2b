-- Purchasing Intelligence Phase 2: supplier master + product ↔ supplier relationships.
-- No supplier data is seeded or inferred. Relationships are assigned manually.

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "accountNumber" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "defaultLeadTimeDays" INTEGER,
    "defaultMinimumOrderValue" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "autopartProductId" TEXT,
    "variantId" TEXT,
    "supplierSku" TEXT,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "leadTimeDays" INTEGER,
    "minimumOrderQty" INTEGER,
    "orderMultiple" INTEGER,
    "unitCost" DECIMAL(12,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_active_idx" ON "Supplier"("active");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "ProductSupplier_matchKey_idx" ON "ProductSupplier"("matchKey");

-- CreateIndex
CREATE INDEX "ProductSupplier_autopartProductId_idx" ON "ProductSupplier"("autopartProductId");

-- CreateIndex
CREATE INDEX "ProductSupplier_variantId_idx" ON "ProductSupplier"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_supplierId_matchKey_key" ON "ProductSupplier"("supplierId", "matchKey");

-- At most one ACTIVE preferred supplier per purchasing product (SKU matchKey).
CREATE UNIQUE INDEX IF NOT EXISTS "ProductSupplier_matchKey_preferred_active_unique"
ON "ProductSupplier" ("matchKey")
WHERE "isPreferred" = true AND "active" = true;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_autopartProductId_fkey" FOREIGN KEY ("autopartProductId") REFERENCES "AutopartProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
