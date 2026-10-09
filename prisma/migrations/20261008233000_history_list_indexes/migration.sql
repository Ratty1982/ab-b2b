-- Account history lists order invoice lines by account then raw invoice reference,
-- ledger rows by account, date, then reference, and document matches by account
-- then document reference. The previous accountCode indexes are the leading
-- column of the new invoice and ledger indexes, so they are replaced.
-- The unique (accountCode, documentType, documentReference) index cannot serve
-- an account + document reference sort because documentType sits in the middle.
-- CREATE INDEX takes SHARE lock and blocks writes until the build finishes.
-- Reads continue. DROP INDEX takes a brief exclusive lock. Create the
-- replacement first so account-code reads keep an index during the build.
-- At the expected volume (about 492,000 invoice lines and 337,000 ledger
-- rows) each build is seconds. Run this when no Autopart import is writing.
-- CREATE INDEX CONCURRENTLY cannot run inside this Prisma transaction.

CREATE INDEX "AutopartInvoiceLine_account_rawInv_idx"
  ON "AutopartInvoiceLine" ("accountCode", "rawInvAndLn");

DROP INDEX IF EXISTS "AutopartInvoiceLine_accountCode_idx";

CREATE INDEX "AutopartLedger_account_date_ref_idx"
  ON "AutopartLedgerTransaction" ("accountCode", "transactionDate", "reference");

DROP INDEX IF EXISTS "AutopartLedgerTransaction_accountCode_idx";

CREATE INDEX "AutopartDocumentMatch_account_docref_idx"
  ON "AutopartDocumentMatch" ("accountCode", "documentReference");
