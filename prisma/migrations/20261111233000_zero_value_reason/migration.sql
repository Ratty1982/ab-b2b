-- Nullable reasons for lines supplied at a £0.00 selling price.
-- Existing rows stay null. Historical zero-price lines are not rewritten.
ALTER TABLE "OrderItem" ADD COLUMN "zeroValueReasonCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "zeroValueReasonDetail" TEXT;

ALTER TABLE "SalesOrderDraftLine" ADD COLUMN "zeroValueReasonCode" TEXT;
ALTER TABLE "SalesOrderDraftLine" ADD COLUMN "zeroValueReasonDetail" TEXT;

ALTER TABLE "QuoteItem" ADD COLUMN "zeroValueReasonCode" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN "zeroValueReasonDetail" TEXT;
