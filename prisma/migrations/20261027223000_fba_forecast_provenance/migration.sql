-- Per-SKU FBA verification uses AutopartLocationStock.sourceImportedAt (already present).
-- Amended OIN lines are retired instead of summed with the replacement.
-- Amazon sales coverage and FBA scope are declared on the import, not inferred.

ALTER TABLE "FbaReplenishmentLine" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "FbaReplenishmentLine" ADD COLUMN "supersededByImportId" TEXT;

CREATE INDEX "FbaReplenishmentLine_supersededAt_idx" ON "FbaReplenishmentLine"("supersededAt");

ALTER TABLE "FbaReplenishmentLine"
  ADD CONSTRAINT "FbaReplenishmentLine_supersededByImportId_fkey"
  FOREIGN KEY ("supersededByImportId") REFERENCES "FbaReplenishmentImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "fulfilmentScope" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "extractedOn" DATE;
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "declaredComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "fbaOnlyAttested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "zerosOmitted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "coverageHasGaps" BOOLEAN NOT NULL DEFAULT false;
