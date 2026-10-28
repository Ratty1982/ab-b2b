-- Read-only reporting indexes for the bounded RETAILA OIN forecast.
-- No rows are inserted, updated, or deleted.

CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_oin_account_date_idx"
  ON "AutopartSalesDocument" ("autopartCustomerCode", "documentDate", "documentReference")
  WHERE "documentReference" LIKE 'OIN%';

CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_oin_company_date_idx"
  ON "AutopartSalesDocument" ("companyId", "documentDate", "documentReference")
  WHERE "documentReference" LIKE 'OIN%';

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_oin_account_ref_idx"
  ON "AutopartSalesLine" ("autopartCustomerCode", "documentReference")
  WHERE "documentReference" LIKE 'OIN%'
    AND source IN ('561L', 'ONGOING_TRM21QC');

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_oin_company_ref_idx"
  ON "AutopartSalesLine" ("companyId", "documentReference")
  WHERE "documentReference" LIKE 'OIN%'
    AND source IN ('561L', 'ONGOING_TRM21QC');

CREATE INDEX IF NOT EXISTS "FbaReplenishmentDocument_account_date_idx"
  ON "FbaReplenishmentDocument" ("customerAccount", "documentDate");
