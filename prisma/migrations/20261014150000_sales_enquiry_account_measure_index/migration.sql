-- Sales Enquiry reads historical 561L lines by normalised account code and NET_EX_VAT only.
-- The existing account-code expression index still applies. This partial index matches that filter
-- so a single customer's lines can be fetched without scanning every invoice line.
--
-- Locking: CREATE INDEX takes SHARE on "AutopartInvoiceLine". Selects continue. Inserts and
-- updates (561L imports) wait until the build finishes. No invoice, credit note, mapping, or
-- sales row is rewritten. Deploy when an Autopart line import is not running.

CREATE INDEX IF NOT EXISTS "AutopartInvoiceLine_net_account_norm_idx"
  ON "AutopartInvoiceLine" (UPPER(btrim("accountCode")))
  WHERE "salesMeasure" = 'NET_EX_VAT';
