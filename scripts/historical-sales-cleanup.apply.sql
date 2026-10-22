-- Reviewed historical Autopart sales cleanup.
--
-- This file is not a Prisma migration. Deploy, server start, and
-- `bun scripts/historical-sales-cleanup.ts` do not execute it.
-- Run it only after:
--   1. the dry-run report has been read,
--   2. a PostgreSQL backup has been restored to a different database and queried,
--   3. the listed historical files have been copied to restricted archive storage.
--
-- Operator session (psql, ON_ERROR_STOP):
--   SET ab.historical_cleanup_confirm = 'ARCHIVE_AND_DELETE_HISTORICAL_SALES';
--   \i scripts/historical-sales-cleanup.apply.sql
--
-- The setting must be supplied by the operator. This file does not set it.
-- A mismatch raises an exception and the transaction rolls back.
-- Company, 407EXP accounts, verified aliases, ongoing 504/TRM documents and
-- lines, discrepant 504 documents, customer-master batches, orders, invoices,
-- stock, pricing, products, and audit events are counted before and after.
-- Any change to those counts aborts the transaction.

BEGIN;

DO $$
BEGIN
  IF current_setting('ab.historical_cleanup_confirm', true)
       IS DISTINCT FROM 'ARCHIVE_AND_DELETE_HISTORICAL_SALES' THEN
    RAISE EXCEPTION
      'Refusing historical cleanup. Set ab.historical_cleanup_confirm to ARCHIVE_AND_DELETE_HISTORICAL_SALES in this session after the dry-run and a tested backup restore.';
  END IF;
END $$;

CREATE TEMP TABLE historical_cleanup_guard ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*) FROM "Company") AS companies,
  (SELECT COUNT(*) FROM "AutopartAccount") AS accounts,
  (SELECT COUNT(*) FROM "AutopartCustomerAccountAlias") AS aliases,
  (SELECT COUNT(*) FROM "Order") AS orders,
  (SELECT COUNT(*) FROM "Invoice") AS invoices,
  (SELECT COUNT(*) FROM "CustomerPrice") AS prices,
  (SELECT COUNT(*) FROM "Product") AS products,
  (SELECT COUNT(*) FROM "Inventory") AS inventory,
  (SELECT COUNT(*) FROM "AuditEvent") AS audit_events,
  (SELECT COUNT(*) FROM "AutopartImportBatch" WHERE kind = 'CUSTOMER_MASTER') AS customer_master_batches,
  (SELECT COUNT(*) FROM "AutopartCustomerImportRun" WHERE type IN ('ONGOING_504', 'ONGOING_TRM21QC')) AS ongoing_runs,
  (SELECT COUNT(*) FROM "AutopartSalesDocument"
    WHERE "has504" = TRUE
       OR "hasTrm21qc" = TRUE
       OR source IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')) AS ongoing_documents,
  (SELECT COUNT(*) FROM "AutopartSalesDocument"
    WHERE "has504" = TRUE AND "valueMismatchMinor" IS NOT NULL) AS discrepant_504_documents,
  (SELECT COUNT(*) FROM "AutopartSalesLine" WHERE source = 'ONGOING_TRM21QC') AS ongoing_lines;

-- Staged history, children before the parent import.
DELETE FROM "AutopartHistoryStagedLine";
DELETE FROM "AutopartHistoryStagedDocument";
DELETE FROM "AutopartHistoryReviewAccount";
DELETE FROM "AutopartHistorySnapshotGap";
DELETE FROM "AutopartHistoryImportLock";
DELETE FROM "AutopartHistoryAllImport";

-- Global 561L lines, SLRB ledger rows, and their document matches.
DELETE FROM "AutopartInvoiceLine";
DELETE FROM "AutopartLedgerTransaction";
DELETE FROM "AutopartDocumentMatch";

DELETE FROM "AutopartImportIssue" AS issue
USING "AutopartImportBatch" AS batch
WHERE issue."batchId" = batch.id
  AND batch.kind IN ('INVOICE_LINES', 'LEDGER');

DELETE FROM "AutopartImportBatch"
WHERE kind IN ('INVOICE_LINES', 'LEDGER');

-- Historical-only product lines. A 561L line on an ongoing document stays.
DELETE FROM "AutopartSalesLine" AS line
WHERE line.source IS DISTINCT FROM 'ONGOING_TRM21QC'
  AND (line.source IN ('561L', 'SLRB') OR line.source IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM "AutopartSalesDocument" AS document
    WHERE document.id = line."documentId"
      AND (
        document."has504" = TRUE
        OR document."hasTrm21qc" = TRUE
        OR document.source IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
      )
  );

-- Historical-only documents. Ongoing and discrepant 504 documents stay.
DELETE FROM "AutopartSalesDocument" AS document
WHERE document.source IN ('561L', 'SLRB')
  AND document."has504" = FALSE
  AND document."hasTrm21qc" = FALSE
  AND document.source NOT IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE');

-- Diagnostics and runs for HISTORY_561L_SLRB only when nothing preserved still points at them.
DELETE FROM "AutopartImportDiagnostic" AS diagnostic
USING "AutopartCustomerImportRun" AS run
WHERE diagnostic."importRunId" = run.id
  AND run.type = 'HISTORY_561L_SLRB'
  AND NOT EXISTS (
    SELECT 1 FROM "AutopartSalesDocument" AS document WHERE document."importRunId" = run.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "AutopartSalesLine" AS line WHERE line."importRunId" = run.id
  );

DELETE FROM "AutopartCustomerImportRun" AS run
WHERE run.type = 'HISTORY_561L_SLRB'
  AND NOT EXISTS (
    SELECT 1 FROM "AutopartSalesDocument" AS document WHERE document."importRunId" = run.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "AutopartSalesLine" AS line WHERE line."importRunId" = run.id
  );

DO $$
DECLARE
  guard historical_cleanup_guard%ROWTYPE;
  companies bigint;
  accounts bigint;
  aliases bigint;
  orders bigint;
  invoices bigint;
  prices bigint;
  products bigint;
  inventory bigint;
  audit_events bigint;
  customer_master_batches bigint;
  ongoing_runs bigint;
  ongoing_documents bigint;
  discrepant_504_documents bigint;
  ongoing_lines bigint;
BEGIN
  SELECT * INTO guard FROM historical_cleanup_guard;

  SELECT COUNT(*) INTO companies FROM "Company";
  SELECT COUNT(*) INTO accounts FROM "AutopartAccount";
  SELECT COUNT(*) INTO aliases FROM "AutopartCustomerAccountAlias";
  SELECT COUNT(*) INTO orders FROM "Order";
  SELECT COUNT(*) INTO invoices FROM "Invoice";
  SELECT COUNT(*) INTO prices FROM "CustomerPrice";
  SELECT COUNT(*) INTO products FROM "Product";
  SELECT COUNT(*) INTO inventory FROM "Inventory";
  SELECT COUNT(*) INTO audit_events FROM "AuditEvent";
  SELECT COUNT(*) INTO customer_master_batches FROM "AutopartImportBatch" WHERE kind = 'CUSTOMER_MASTER';
  SELECT COUNT(*) INTO ongoing_runs FROM "AutopartCustomerImportRun" WHERE type IN ('ONGOING_504', 'ONGOING_TRM21QC');
  SELECT COUNT(*) INTO ongoing_documents FROM "AutopartSalesDocument"
    WHERE "has504" = TRUE
       OR "hasTrm21qc" = TRUE
       OR source IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE');
  SELECT COUNT(*) INTO discrepant_504_documents FROM "AutopartSalesDocument"
    WHERE "has504" = TRUE AND "valueMismatchMinor" IS NOT NULL;
  SELECT COUNT(*) INTO ongoing_lines FROM "AutopartSalesLine" WHERE source = 'ONGOING_TRM21QC';

  IF companies IS DISTINCT FROM guard.companies
     OR accounts IS DISTINCT FROM guard.accounts
     OR aliases IS DISTINCT FROM guard.aliases
     OR orders IS DISTINCT FROM guard.orders
     OR invoices IS DISTINCT FROM guard.invoices
     OR prices IS DISTINCT FROM guard.prices
     OR products IS DISTINCT FROM guard.products
     OR inventory IS DISTINCT FROM guard.inventory
     OR audit_events IS DISTINCT FROM guard.audit_events
     OR customer_master_batches IS DISTINCT FROM guard.customer_master_batches
     OR ongoing_runs IS DISTINCT FROM guard.ongoing_runs
     OR ongoing_documents IS DISTINCT FROM guard.ongoing_documents
     OR discrepant_504_documents IS DISTINCT FROM guard.discrepant_504_documents
     OR ongoing_lines IS DISTINCT FROM guard.ongoing_lines
  THEN
    RAISE EXCEPTION
      'Historical cleanup would change a preserved table. Transaction rolled back. Companies % -> %, accounts % -> %, aliases % -> %, orders % -> %, invoices % -> %, prices % -> %, products % -> %, inventory % -> %, audit % -> %, customer master % -> %, ongoing runs % -> %, ongoing documents % -> %, discrepant 504 % -> %, ongoing lines % -> %.',
      guard.companies, companies,
      guard.accounts, accounts,
      guard.aliases, aliases,
      guard.orders, orders,
      guard.invoices, invoices,
      guard.prices, prices,
      guard.products, products,
      guard.inventory, inventory,
      guard.audit_events, audit_events,
      guard.customer_master_batches, customer_master_batches,
      guard.ongoing_runs, ongoing_runs,
      guard.ongoing_documents, ongoing_documents,
      guard.discrepant_504_documents, discrepant_504_documents,
      guard.ongoing_lines, ongoing_lines;
  END IF;

  RAISE NOTICE
    'Historical cleanup preserved companies %, 407EXP accounts %, aliases %, ongoing documents %, discrepant 504 documents %, ongoing lines %.',
    companies, accounts, aliases, ongoing_documents, discrepant_504_documents, ongoing_lines;
END $$;

COMMIT;
