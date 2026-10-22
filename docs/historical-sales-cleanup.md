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
- Sales lines whose `source` is null. Missing source is not treated as historical origin. A historical document that still has such a line is kept, so the line's document link is not cleared.
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

`--apply` still does not delete. If the confirmation phrase, a PostgreSQL restore tested within the last 7 days, and a storage backup path are missing, the command exits 1. If those gates pass, it exits 2 and names the SQL procedure. It does not run that procedure.

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

## Executable cleanup procedure

`scripts/historical-sales-cleanup.apply.sql` is the deletion procedure. It is separate from the dry-run and from every migration. Nothing in deploy, startup, or `package.json` runs it. Do not run it as part of reviewing this pull request.

After the production dry-run has been read, a backup has been restored and queried, and the file archive path has been recorded, a later reviewed session can run:

The procedure is disabled by default. Deploy does not set the session flags, and `psql -c` and `-f` are different sessions, so both flags have to be set in the same session as the file:

```sql
SET ab.historical_cleanup_enabled = 'on';
SET ab.historical_cleanup_confirm = 'ARCHIVE_AND_DELETE_HISTORICAL_SALES';
\i scripts/historical-sales-cleanup.apply.sql
```

The script starts a transaction and refuses to continue unless both settings are present. It deletes positively identified historical rows in child-before-parent order. It does not delete a sales line whose `source` is null. Before and after, it fingerprints protected records: companies, 407EXP accounts, aliases, orders, stock reservations, invoices, prices, products, inventory, audit events, customer-master batches, ongoing import runs and their diagnostics, ongoing 504/TRM documents (including documents originally imported as 561L or SLRB), discrepant 504 documents, and protected sales lines. A changed count or a changed fingerprint raises an exception and rolls the transaction back. A count that stays the same while a protected goods value or company field changes is still a failure.

## Rows a later approved session may delete

Only after the dry-run has been read and the backup has been tested. The SQL procedure deletes children before parents.

- `AutopartHistoryStagedLine`, `AutopartHistoryStagedDocument`, `AutopartHistoryReviewAccount`, `AutopartHistorySnapshotGap`, `AutopartHistoryImportLock`, then `AutopartHistoryAllImport`.
- `AutopartInvoiceLine`, `AutopartLedgerTransaction`, `AutopartDocumentMatch`.
- `AutopartImportIssue` rows whose batch kind is `INVOICE_LINES` or `LEDGER`, then those batches.
- `AutopartSalesLine` where `source` is `561L` or `SLRB` and the line is not on a document with `has504`, `hasTrm21qc`, or an ongoing source. Lines with `source` null are not deleted.
- `AutopartSalesDocument` where `source` is `561L` or `SLRB`, `has504` is false, `hasTrm21qc` is false, the source is not an ongoing source, and no sales line remains on the document.
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

1. Merge draft PR #46 first. Its only migration retires the 504C feed. It does not delete sales rows.
2. Merge draft PR #47 second. It has no migration. Leave it based on production so its diff stays the verification change and does not absorb PR #46.
3. Rebase this branch onto production after both merges, then merge it last. Until then this branch already contains the #46 and #47 commits, so its diff repeats them.

Do not merge, deploy, reset the database, delete production rows, bulk-verify accounts, run financial recovery, or change fulfilment settings from this change alone. Do not execute `scripts/historical-sales-cleanup.apply.sql` as part of review or deployment.
