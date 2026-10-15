-- Keep the original 561L and SLRB files with the customer import run.
-- Nullable so existing runs stay valid. Application startup does not backfill them.
ALTER TABLE "AutopartCustomerImportRun"
  ADD COLUMN IF NOT EXISTS "fileBody561l" BYTEA,
  ADD COLUMN IF NOT EXISTS "fileBodySlrb" BYTEA;
