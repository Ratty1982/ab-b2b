-- Account history lists order invoice lines by account then raw invoice reference,
-- ledger rows by account, date, then reference, and document matches by account
-- then document reference. The previous accountCode indexes are the leading
-- column of the new invoice and ledger indexes, so they are replaced.
-- The unique (accountCode, documentType, documentReference) index cannot serve
-- an account + document reference sort because documentType sits in the middle.
-- These statements lock the tables for the build. At the expected volume
-- (about 492,000 invoice lines and 337,000 ledger rows) that is seconds.

DROP INDEX IF EXISTS "AutopartInvoiceLine_accountCode_idx";

CREATE INDEX "AutopartInvoiceLine_account_rawInv_idx"
  ON "AutopartInvoiceLine" ("accountCode", "rawInvAndLn");

DROP INDEX IF EXISTS "AutopartLedgerTransaction_accountCode_idx";

CREATE INDEX "AutopartLedger_account_date_ref_idx"
  ON "AutopartLedgerTransaction" ("accountCode", "transactionDate", "reference");

CREATE INDEX "AutopartDocumentMatch_account_docref_idx"
  ON "AutopartDocumentMatch" ("accountCode", "documentReference");
