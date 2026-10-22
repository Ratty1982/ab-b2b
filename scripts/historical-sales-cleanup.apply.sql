-- Reviewed historical Autopart sales cleanup.
--
-- This file is not a Prisma migration. Deploy, server start, and
-- `bun scripts/historical-sales-cleanup.ts` do not execute it.
-- It is disabled unless the operator opts in during the same psql session.
-- Run it only after:
--   1. the dry-run report has been read,
--   2. a PostgreSQL backup has been restored to a different database and queried,
--   3. the listed historical files have been copied to restricted archive storage.
--
-- Operator session (psql, ON_ERROR_STOP). Both settings are required.
-- psql -c and -f are different sessions, so neither flag can be set with -c:
--   SET ab.historical_cleanup_enabled = 'on';
--   SET ab.historical_cleanup_confirm = 'ARCHIVE_AND_DELETE_HISTORICAL_SALES';
--   \i scripts/historical-sales-cleanup.apply.sql
--
-- This file does not set either value. A mismatch raises an exception and
-- the transaction rolls back. Protected rows are fingerprinted before and
-- after the deletes. A changed count or a changed fingerprint aborts.
-- Protected rows include companies, 407EXP accounts, verified aliases,
-- orders, stock reservations, invoices, prices, products, inventory, audit
-- events, customer-master batches, ongoing 504/TRM runs and diagnostics,
-- ongoing documents (including a document that started as 561L or SLRB),
-- discrepant 504 documents, ongoing TRM21QC lines, and sales lines whose
-- source is null.

BEGIN;

DO $$
BEGIN
  IF current_setting('ab.historical_cleanup_enabled', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Refusing historical cleanup. It is disabled unless this session sets ab.historical_cleanup_enabled to on. Deploy does not set it.';
  END IF;
  IF current_setting('ab.historical_cleanup_confirm', true)
       IS DISTINCT FROM 'ARCHIVE_AND_DELETE_HISTORICAL_SALES' THEN
    RAISE EXCEPTION
      'Refusing historical cleanup. Set ab.historical_cleanup_confirm to ARCHIVE_AND_DELETE_HISTORICAL_SALES in this session after the dry-run and a tested backup restore.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.historical_cleanup_fingerprint()
RETURNS TABLE (subject text, records bigint, fingerprint text)
LANGUAGE sql
STABLE
AS $fp$
  SELECT 'Company'::text,
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, name, status::text, "autopartCustomerCode", "autopartCustomerCodeVerifiedAt"::text, "autopartCustomerCodeVerifiedById")), '|' ORDER BY id), ''))
  FROM "Company"
  UNION ALL
  SELECT 'AutopartAccount',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "accountCode", "companyId", classification::text, "portalEligible"::text, "historicalAccessEnabled"::text)), '|' ORDER BY id), ''))
  FROM "AutopartAccount"
  UNION ALL
  SELECT 'AutopartCustomerAccountAlias',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "companyId", alias, "verifiedAt"::text, "verifiedById")), '|' ORDER BY id), ''))
  FROM "AutopartCustomerAccountAlias"
  UNION ALL
  SELECT 'Order',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "orderNumber", "companyId", status::text, subtotal::text, "vatTotal"::text, "grandTotal"::text)), '|' ORDER BY id), ''))
  FROM "Order"
  UNION ALL
  SELECT 'OrderStockReservation',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "orderId", "inventoryId", "variantId", quantity::text, status::text)), '|' ORDER BY id), ''))
  FROM "OrderStockReservation"
  UNION ALL
  SELECT 'Invoice',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "invoiceNumber", "companyId", "orderId", status::text, subtotal::text, "vatTotal"::text, "grandTotal"::text, "externalRef")), '|' ORDER BY id), ''))
  FROM "Invoice"
  UNION ALL
  SELECT 'CustomerPrice',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "companyId", "variantId", "unitPrice"::text)), '|' ORDER BY id), ''))
  FROM "CustomerPrice"
  UNION ALL
  SELECT 'Product',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, slug, name, status::text, "isActive"::text)), '|' ORDER BY id), ''))
  FROM "Product"
  UNION ALL
  SELECT 'Inventory',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "variantId", "warehouseId", "qtyOnHand"::text, "qtyReserved"::text, status::text)), '|' ORDER BY id), ''))
  FROM "Inventory"
  UNION ALL
  SELECT 'AuditEvent',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, action, "entityType", "entityId", "companyId", "actorUserId", "createdAt"::text)), '|' ORDER BY id), ''))
  FROM "AuditEvent"
  UNION ALL
  SELECT 'Customer master batches',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, kind::text, status::text, "fileHash", "totalRows"::text, "importedRows"::text)), '|' ORDER BY id), ''))
  FROM "AutopartImportBatch"
  WHERE kind = 'CUSTOMER_MASTER'
  UNION ALL
  SELECT 'Ongoing import runs',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, type::text, status::text, "rowsImported"::text, "rowsUpdated"::text, "rowsSkipped"::text, "fileHash")), '|' ORDER BY id), ''))
  FROM "AutopartCustomerImportRun"
  WHERE type IN ('ONGOING_504', 'ONGOING_TRM21QC')
  UNION ALL
  SELECT 'Ongoing import diagnostics',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', diagnostic.id, diagnostic."importRunId", diagnostic.status::text, diagnostic."reasonCode", diagnostic."documentReference", diagnostic.quantity, diagnostic."salesNet")), '|' ORDER BY diagnostic.id), ''))
  FROM "AutopartImportDiagnostic" AS diagnostic
  JOIN "AutopartCustomerImportRun" AS run ON run.id = diagnostic."importRunId"
  WHERE run.type IN ('ONGOING_504', 'ONGOING_TRM21QC')
  UNION ALL
  SELECT 'Ongoing sales documents',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "companyId", source, "has504"::text, "hasTrm21qc"::text, "documentType"::text, "documentReference", "goodsNet"::text, vat::text, "grossTotal"::text, "linesNetSum"::text, "valueMismatchMinor"::text)), '|' ORDER BY id), ''))
  FROM "AutopartSalesDocument"
  WHERE "has504" = TRUE
     OR "hasTrm21qc" = TRUE
     OR source IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
     OR source IS NULL
  UNION ALL
  SELECT 'Discrepant 504 documents',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', id, "companyId", source, "documentReference", "goodsNet"::text, vat::text, "grossTotal"::text, "linesNetSum"::text, "valueMismatchMinor"::text)), '|' ORDER BY id), ''))
  FROM "AutopartSalesDocument"
  WHERE "has504" = TRUE
    AND "valueMismatchMinor" IS NOT NULL
  UNION ALL
  SELECT 'Protected sales lines',
         COUNT(*)::bigint,
         md5(COALESCE(string_agg(md5(concat_ws('|', line.id, line."companyId", line."documentId", line.source, line."documentType"::text, line."documentReference", line."lineNumber"::text, line.sku, line.units::text, line."salesNet"::text)), '|' ORDER BY line.id), ''))
  FROM "AutopartSalesLine" AS line
  WHERE line.source IS NULL
     OR line.source NOT IN ('561L', 'SLRB')
     OR EXISTS (
       SELECT 1
       FROM "AutopartSalesDocument" AS document
       WHERE document.id = line."documentId"
         AND (
           document."has504" = TRUE
           OR document."hasTrm21qc" = TRUE
           OR document.source IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
         )
     );
$fp$;

CREATE TEMP TABLE historical_cleanup_guard ON COMMIT DROP AS
SELECT * FROM pg_temp.historical_cleanup_fingerprint();

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

-- Positively identified historical lines only. Null source stays.
-- A 561L or SLRB line on an ongoing document stays, including a document
-- that was originally imported as history and later accepted by 504 or TRM.
DELETE FROM "AutopartSalesLine" AS line
WHERE line.source IN ('561L', 'SLRB')
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

-- Historical-only documents with no remaining line. A remaining null-source
-- line keeps its document, because deleting the document would clear that
-- line's document link. Ongoing and discrepant 504 documents stay.
DELETE FROM "AutopartSalesDocument" AS document
WHERE document.source IN ('561L', 'SLRB')
  AND document."has504" = FALSE
  AND document."hasTrm21qc" = FALSE
  AND document.source NOT IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
  AND NOT EXISTS (
    SELECT 1
    FROM "AutopartSalesLine" AS line
    WHERE line."documentId" = document.id
  );

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
  changed text;
  before_count bigint;
  after_count bigint;
BEGIN
  SELECT COUNT(*) INTO before_count FROM historical_cleanup_guard;
  SELECT COUNT(*) INTO after_count FROM pg_temp.historical_cleanup_fingerprint();
  IF before_count IS DISTINCT FROM after_count THEN
    RAISE EXCEPTION
      'Historical cleanup preservation check changed shape (% subjects before, % after). Transaction rolled back.',
      before_count, after_count;
  END IF;

  SELECT string_agg(
           format(
             '%s records %s -> %s fingerprint %s -> %s',
             before.subject,
             before.records,
             after.records,
             before.fingerprint,
             after.fingerprint
           ),
           '; ' ORDER BY before.subject
         )
    INTO changed
  FROM historical_cleanup_guard AS before
  JOIN pg_temp.historical_cleanup_fingerprint() AS after USING (subject)
  WHERE before.records IS DISTINCT FROM after.records
     OR before.fingerprint IS DISTINCT FROM after.fingerprint;

  IF changed IS NOT NULL THEN
    RAISE EXCEPTION
      'Historical cleanup would change a preserved record. Transaction rolled back. %',
      changed;
  END IF;

  RAISE NOTICE 'Historical cleanup preserved % fingerprinted subjects.', before_count;
END $$;

COMMIT;
