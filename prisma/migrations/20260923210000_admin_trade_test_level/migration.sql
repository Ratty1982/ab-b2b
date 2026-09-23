-- Admin Trade Test Level: optional PriceList on User; nullable Basket.companyId for isolated admin test baskets.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeTestPriceListId" TEXT;

CREATE INDEX IF NOT EXISTS "User_tradeTestPriceListId_idx" ON "User"("tradeTestPriceListId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_tradeTestPriceListId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_tradeTestPriceListId_fkey"
      FOREIGN KEY ("tradeTestPriceListId") REFERENCES "PriceList"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Allow admin test baskets without a company.
ALTER TABLE "Basket" ALTER COLUMN "companyId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "Basket_userId_status_idx" ON "Basket"("userId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Basket_userId_fkey'
  ) THEN
    ALTER TABLE "Basket"
      ADD CONSTRAINT "Basket_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
