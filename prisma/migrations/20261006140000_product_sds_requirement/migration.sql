-- Internal SDS requirement governance on Product (coverage / missing documents).
-- Default REQUIRED so existing catalogue products need a current SDS unless explicitly marked otherwise.

CREATE TYPE "ProductSdsRequirement" AS ENUM ('REQUIRED', 'NOT_REQUIRED');

ALTER TABLE "Product"
    ADD COLUMN "sdsRequirement" "ProductSdsRequirement" NOT NULL DEFAULT 'REQUIRED',
    ADD COLUMN "sdsNotRequiredReason" TEXT,
    ADD COLUMN "sdsRequirementUpdatedAt" TIMESTAMP(3),
    ADD COLUMN "sdsRequirementUpdatedById" TEXT;

CREATE INDEX "Product_sdsRequirement_idx" ON "Product"("sdsRequirement");
CREATE INDEX "Product_sdsRequirementUpdatedById_idx" ON "Product"("sdsRequirementUpdatedById");

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_sdsRequirementUpdatedById_fkey"
    FOREIGN KEY ("sdsRequirementUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
