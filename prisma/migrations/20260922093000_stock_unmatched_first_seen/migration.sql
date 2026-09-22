-- Current-state unmatched Autopart SKUs: firstSeenAt for upsert diagnostics.
-- Additive. Does not change Inventory or ProductVariant.

ALTER TABLE "StockFeedUnmatched" ADD COLUMN "firstSeenAt" TIMESTAMP(3);

UPDATE "StockFeedUnmatched" SET "firstSeenAt" = "lastSeenAt" WHERE "firstSeenAt" IS NULL;

ALTER TABLE "StockFeedUnmatched" ALTER COLUMN "firstSeenAt" SET NOT NULL;

CREATE INDEX "StockFeedUnmatched_lastSeenAt_idx" ON "StockFeedUnmatched"("lastSeenAt");
