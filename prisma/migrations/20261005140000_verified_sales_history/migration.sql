-- Purchasing forecast confidence: explicit verified sales-history start.
-- Null means coverage is unverified. Do not backfill from MIN(documentDate).

ALTER TABLE "PurchasingSettings" ADD COLUMN "verifiedSalesHistoryFrom" DATE;
