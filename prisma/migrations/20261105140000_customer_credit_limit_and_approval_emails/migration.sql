-- Informational company credit limit (nullable GBP Decimal). Never used to block orders.
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(12, 2);

-- New transactional email purposes for missing Autopart-code alert and internal approval notice.
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_APPLICATION_MISSING_AUTOPART_CODE';
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'TRADE_ACCOUNT_APPROVED_INTERNAL';
