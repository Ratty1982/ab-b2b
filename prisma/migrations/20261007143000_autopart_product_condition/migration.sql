-- Current Autopart product condition from the 231PO3NEW C column.
-- Nullable so existing rows stay unchanged until the next successful import.
ALTER TABLE "AutopartProduct" ADD COLUMN "conditionCode" TEXT;
