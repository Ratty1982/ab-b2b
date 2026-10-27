-- Amazon UK is stored only when the file declares it. A missing marketplace is not UK.

ALTER TABLE "FbaAmazonSalesImport" ALTER COLUMN "marketplace" SET DEFAULT '';
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "ukMarketplaceAttested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FbaAmazonSalesImport" ADD COLUMN "normalizedUkOnly" BOOLEAN NOT NULL DEFAULT false;
