-- Trade application onboarding fields (claim metadata, consent, customer-facing messages).
ALTER TABLE "TradeApplication" ADD COLUMN IF NOT EXISTS "howHeardAboutUs" TEXT;
ALTER TABLE "TradeApplication" ADD COLUMN IF NOT EXISTS "customerMessage" TEXT;
ALTER TABLE "TradeApplication" ADD COLUMN IF NOT EXISTS "existingAccountClaim" TEXT;
ALTER TABLE "TradeApplication" ADD COLUMN IF NOT EXISTS "consentAcceptedAt" TIMESTAMP(3);
