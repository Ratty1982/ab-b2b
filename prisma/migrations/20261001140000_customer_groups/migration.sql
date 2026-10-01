-- Customer Group: Automotive Brands reporting aggregation above Company.
-- Does NOT model Autopart/MAM parent–child hierarchy.

CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerGroup_name_idx" ON "CustomerGroup"("name");
CREATE INDEX "CustomerGroup_active_idx" ON "CustomerGroup"("active");

ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Company" ADD COLUMN "customerGroupId" TEXT;

CREATE INDEX "Company_customerGroupId_idx" ON "Company"("customerGroupId");

ALTER TABLE "Company" ADD CONSTRAINT "Company_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopartCustomerAccountAlias" ADD COLUMN "label" TEXT;
