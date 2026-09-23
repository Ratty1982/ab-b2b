-- Distinguish NONE / BASE_TRADE / PRICE_LIST for admin Trade Testing.
-- Existing users with a selected PriceList become PRICE_LIST; others stay NONE.

DO $$ BEGIN
  CREATE TYPE "TradeTestPricingMode" AS ENUM ('NONE', 'BASE_TRADE', 'PRICE_LIST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "tradeTestPricingMode" "TradeTestPricingMode" NOT NULL DEFAULT 'NONE';

UPDATE "User"
SET "tradeTestPricingMode" = 'PRICE_LIST'
WHERE "tradeTestPriceListId" IS NOT NULL
  AND "tradeTestPricingMode" = 'NONE';
