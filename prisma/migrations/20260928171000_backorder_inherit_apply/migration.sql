-- Step 2: apply INHERIT after the enum value from the previous migration is committed.
-- Existing DENY values were the prior migration default for every SKU (not
-- distinguishable from explicit admin disables). Migrate them to INHERIT so
-- production catalogue becomes backorderable by default via the global setting.
-- Explicit ALLOW overrides are preserved.

ALTER TABLE "ProductVariant"
  ALTER COLUMN "backorderPolicy" SET DEFAULT 'INHERIT';

UPDATE "ProductVariant"
SET "backorderPolicy" = 'INHERIT'
WHERE "backorderPolicy" = 'DENY';
