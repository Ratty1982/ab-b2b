-- Unified customer sales enquiry: read-only reporting indexes.
-- No rows are inserted, updated, or deleted. Normalised-key expression indexes cannot be
-- expressed in schema.prisma, so they live here (same approach as other raw-SQL indexes).

CREATE INDEX IF NOT EXISTS "AutopartInvoiceLine_accountCode_norm_idx"
  ON "AutopartInvoiceLine" (UPPER(btrim("accountCode")));

CREATE INDEX IF NOT EXISTS "AutopartInvoiceLine_partNumber_norm_idx"
  ON "AutopartInvoiceLine" (UPPER(btrim("partNumber")));

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_sku_norm_idx"
  ON "AutopartSalesLine" (UPPER(btrim("sku")));

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_unassigned_code_norm_idx"
  ON "AutopartSalesLine" (UPPER(btrim("autopartCustomerCode")))
  WHERE "companyId" IS NULL;

CREATE INDEX IF NOT EXISTS "AutopartAccount_accountCode_norm_idx"
  ON "AutopartAccount" (UPPER(btrim("accountCode")));
