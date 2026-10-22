# Historical sales cleanup

This is a controlled, manual cleanup. It is not a migration, not a startup task, and not run on deployment. This branch does not delete production rows.

This environment has no production database. Record counts, financial totals, company lists, and file paths come from the dry-run against the production database. Do not invent those figures from a local or empty database.

## What this change removes from the application

- Historical 561L and SLRB upload, preview, confirm, and the 561L-ALL / SLRB-ALL endpoint (the endpoint now returns HTTP 410).
- Historical staging, account-matching queues, publication, import locks, snapshot replacement, and resumable ALL-file controls.
- Admin screens and navigation for those imports. Customer master search, link, and prospect creation stay.
- Sales reporting no longer treats historical 561L or SLRB lines as certified sales. Ongoing 504 headers and TRM21QC lines stay.

Prisma models for the historical tables stay. A migration that dropped them would delete production data on deploy.

## What is preserved

- Company, contact, address, user, authentication, and permission records.
- 407EXP `AutopartAccount` master rows, Autopart customer IDs, aliases, and verified mappings.
- Customer pricing, negotiated prices, promotions, orders, sales representatives, and assignments.
- Ongoing 504 invoice and credit documents, TRM21QC product lines, and their import runs.
- A document whose original source is 561L or SLRB when `has504` or `hasTrm21qc` is set, or when its source is `ONGOING_504`, `ONGOING_TRM21QC`, or `ONGOING_504_BRIDGE`. A 561L line on that document is kept.
- The ongoing 504 documents with `valueMismatchMinor` set. They are repaired by the separate 504 financial recovery, not by this cleanup.
- `CUSTOMER_MASTER` import batches.

## Dry-run

Requires `DATABASE_URL` for the database being inventoried. The command only reads.

```bash
bun scripts/historical-sales-cleanup.ts
```

The JSON report is written under `HISTORICAL_CLEANUP_OUT` or `/tmp/historical-cleanup`. It lists:

- table, record count, and financial total where a money column exists
- up to 50 companies that still have historical-only documents
- stored file paths for `INVOICE_LINES` / `LEDGER` batches and 561L-ALL / SLRB-ALL uploads
- foreign keys that reference the historical tables
- the count of ongoing 504 documents with a monetary discrepancy (preserved)

`--apply` still does not delete. If the confirmation phrase, a PostgreSQL restore tested within the last 7 days, and a storage backup path are missing, the command exits 1. If those gates pass, it exits 2 and prints that deletion is not executed.

```bash
bun scripts/historical-sales-cleanup.ts \
  --apply \
  --confirm ARCHIVE_AND_DELETE_HISTORICAL_SALES \
  --postgres-restore-tested-at 2026-10-21T12:00:00Z \
  --storage-backup /secure/autopart-history-archive
```

## Backup before any deletion

1. Take a PostgreSQL backup of the production database with a method that can be restored independently of this application.
2. Restore that backup to a different database and query `AutopartInvoiceLine`, `AutopartSalesDocument`, and `Company` so the restore is proven.
3. Copy the file paths listed by the dry-run, plus any temporary ALL-file working directories, to restricted archive storage. Record the archive path.
4. Keep the archive for the legal and operational retention period agreed with the business. The operational copies are what a later approved session may delete.

## Rows a later approved session may delete

Only after the dry-run has been read and the backup has been tested. Delete children before parents.

- `AutopartHistoryStagedLine`, `AutopartHistoryStagedDocument`, `AutopartHistoryReviewAccount`, `AutopartHistorySnapshotGap`, `AutopartHistoryImportLock`, then `AutopartHistoryAllImport`.
- `AutopartInvoiceLine`, `AutopartLedgerTransaction`, `AutopartDocumentMatch`.
- `AutopartImportIssue` rows whose batch kind is `INVOICE_LINES` or `LEDGER`, then those batches.
- `AutopartSalesLine` where `source` is `561L` and the line is not on a document with `has504`, `hasTrm21qc`, or an ongoing source.
- `AutopartSalesDocument` where `source` is `561L` or `SLRB`, and `has504` is false, and `hasTrm21qc` is false, and `source` is not an ongoing source.
- `AutopartCustomerImportRun` where `type` is `HISTORY_561L_SLRB`, after `AutopartImportDiagnostic` rows that are not still referenced by a preserved document or line.

Do not delete `Company`, `AutopartAccount`, `AutopartCustomerAccountAlias`, `CUSTOMER_MASTER` batches, ongoing import runs, or any document with `has504` or `hasTrm21qc`.

## Foreign keys and reporting

The dry-run prints the live foreign keys. Expected links:

- staged history rows point at `AutopartHistoryAllImport` and review accounts
- invoice lines, ledger rows, and document matches point at historical import batches
- sales lines point at sales documents and, optionally, a customer import run
- companies point at sales documents; deleting a historical-only document does not delete the company (`ON DELETE` on the company side is not how these rows are removed)

After deletion, Sales Enquiry, portal purchases, purchasing, and customer-group sales already ignore historical lines. They show ongoing 504 and TRM21QC activity, or an empty state. They must not be described as a complete pre-portal purchase history.

## Verification and customer mapping

This cleanup does not verify Autopart IDs and does not create companies or portal users. Existing companies, assigned Autopart IDs, and verified aliases stay. Unambiguous verification of existing mappings is the separate account-verification change and is not a prerequisite of this cleanup. Historical sales are not a prerequisite of verification.

## Rollback

If an approved deletion is wrong, restore the tested PostgreSQL backup and the archived files. Do not run a second deletion on a partial result. Application code in this change can be reverted by not merging the pull request; that does not put deleted rows back.

## Integration order

1. Parser fix and controlled 504 financial recovery (draft PR #46), so the discrepant ongoing 504 documents stay on a repair path.
2. Unambiguous Autopart account verification (draft PR #47). Rebase it after #46. Do not add a second verification backfill here.
3. This historical-removal change last. Rebase it onto production after #46 and #47 so verification remains and historical promotion stays removed.

Do not merge, deploy, reset the database, delete production rows, bulk-verify accounts, or change fulfilment settings from this change alone.
