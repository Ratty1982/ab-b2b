-- Explicit sales-history coverage confirmation. Does not alter sales lines or forecast settings.

CREATE TYPE "SalesHistoryCoverageScope" AS ENUM ('BRAND', 'ALL');

CREATE TABLE "SalesHistoryCoverageVerification" (
    "id" TEXT NOT NULL,
    "scope" "SalesHistoryCoverageScope" NOT NULL,
    "brandId" TEXT,
    "coverageFrom" DATE NOT NULL,
    "coverageTo" DATE NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesHistoryCoverageVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesHistoryCoverageVerification_scope_brandId_idx" ON "SalesHistoryCoverageVerification"("scope", "brandId");
CREATE INDEX "SalesHistoryCoverageVerification_verifiedAt_idx" ON "SalesHistoryCoverageVerification"("verifiedAt");
CREATE INDEX "SalesHistoryCoverageVerification_verifiedById_idx" ON "SalesHistoryCoverageVerification"("verifiedById");

ALTER TABLE "SalesHistoryCoverageVerification" ADD CONSTRAINT "SalesHistoryCoverageVerification_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesHistoryCoverageVerification" ADD CONSTRAINT "SalesHistoryCoverageVerification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
