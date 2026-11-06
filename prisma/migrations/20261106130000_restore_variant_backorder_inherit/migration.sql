-- PR #95 correction: new variants keep INHERIT so they follow the global backorder setting.
-- Unconfirmed stock remains independently non-orderable. Existing stored policies are unchanged.
ALTER TABLE "ProductVariant"
  ALTER COLUMN "backorderPolicy" SET DEFAULT 'INHERIT';
