# Performance review — 8 October 2026

Local measurements against the development database. Production was not queried, imported, or migrated.

Local volumes used for timing: 98,228 `AutopartProduct` rows, 87 supplier links, 419 companies, 13,964 historic sales lines. `AutopartAccount`, `AutopartInvoiceLine`, and `AutopartLedgerTransaction` were empty, so history-index timings at the expected 22,859 / 492,000 / 337,000 volumes were not measured. Query plans for those lists were checked with sequential scans disabled.

## Measured bottlenecks

- Every Stock Overview request scanned `AutopartProduct` to find low-stock ids. `EXPLAIN ANALYZE` was a sequential scan, about 179ms cold and 265ms with further disk reads, returning 0 rows.
- Filtered stock valuation walked every matching product in batches of 500 and loaded supplier and inventory rows in JavaScript. On the full 98,228-row set that was 197 queries and 1,512ms. The same totals from one grouped SQL query were 148–167ms.
- The current-feed catalogue is small here (2 rows in the latest feed), so the default page was dominated by the low-stock scan rather than valuation.
- Duplicate Autopart names grouped the whole account table in Node and then sliced a page.
- Customer 360 loaded every distinct SKU with `groupBy` only to read the group count.
- Stock CSV export repeated offset queries. The response is still the existing `{ csv, truncated, exported, total }` payload.
- Invoice, ledger, and document-match lists were already paginated, but the sort columns were not covered by a matching index.

## Changes

- Low stock starts from the purchasing-settings tables. Variant safety stock still wins. The summary card counts only the current feed.
- Filtered valuation is one SQL aggregate. Supplier choice matches the purchasing rule: one preferred cost, otherwise the only usable supplier cost, otherwise latest cost when it is greater than zero. Lines are rounded to pence and then summed. Several suppliers cannot duplicate a product. FBA location stock is not read. A missing cost is not stored as £0.
- CSV export reads at most 20,000 rows in one ordered query.
- Duplicate account names are grouped in SQL with `HAVING` and `LIMIT`/`OFFSET`.
- Customer 360 uses `COUNT(DISTINCT sku)` for products purchased. The top-10 spend query stays.
- List pages for accounts, history, ledger, reconciliation, document matches, and import batches are capped at 10,000.
- Listing import batches marks a `RUNNING` batch failed when its heartbeat is older than 15 minutes and this process is not running it. A fresh heartbeat is left alone. No job queue was added.
- Migration `20261008233000_history_list_indexes` replaces the invoice and ledger `accountCode` indexes with the list sort, and adds `(accountCode, documentReference)` on document matches. The global `transactionDate` index stays.

## Timings

| Path                               | Before                                          | After                                                                   |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Low-stock id query                 | 179–265ms sequential scan                       | 0.3ms warm index nested loop (14.7ms on the first settings-driven plan) |
| Valuation of 98,228 products       | 1,512ms, 197 queries                            | 148–167ms, 1 query                                                      |
| Stock Overview, all feeds, warm    | valuation alone was 1,512ms                     | 199ms for the page, including totals                                    |
| Stock Overview, current feed, warm | low-stock scan about 265ms on the critical path | 37ms for the page                                                       |
| Historic feed page, warm           | same walk shape as the full set                 | 245ms                                                                   |

Full-set totals matched before and after: physical £25,749.83, sellable £11,570.83, 90,364 missing costs, 7,864 valued physical lines, 145 valued sellable lines.

With sequential scans disabled, account history plans are index scans on `AutopartInvoiceLine_account_rawInv_idx`, `AutopartLedger_account_date_ref_idx`, and `AutopartDocumentMatch_account_docref_idx`. The ledger list orders date descending and reference ascending, so Postgres scans that index backward and incrementally sorts the reference tie-break.

## Left unchanged

- Physical and sellable quantities, trade prices, catalogue visibility, and historical amounts.
- Company name search. A few hundred local companies, and about 22,000 expected accounts, do not justify a trigram index from this measurement.
- Catalogue list queries. They are already page-limited (10–100, export capped at 5,000, public page 24).
- Stock and price caches.
- A background job queue. Imports remain in the Node process. Chunked upserts on `sourceIdentity` stay idempotent, so a deploy can interrupt a run and the operator can retry it. Listing batches now clears a stale `RUNNING` row instead of leaving it running until the batch is opened.

## Deploy note

`20261008233000_history_list_indexes` runs inside Prisma's migration transaction. `CREATE INDEX` takes a share lock and blocks writes until the build finishes. Reads continue. `DROP INDEX` then takes a brief exclusive lock. The new index is created before the old `accountCode` index is dropped. At the expected history volume each build is seconds. Deploy it when no Autopart import is writing those tables. `CREATE INDEX CONCURRENTLY` would avoid the write block and cannot run inside this transaction. The migration was applied only to the local development database.

## Review follow-up

A reused Inv & Ln such as `/1` on two product rows is stored as two lines. The older test expected one row, which is the last-wins behaviour the importer no longer uses.

Sole non-preferred supplier cost is the existing `resolvePlanningSupplier` rule: one active supplier is used even when it is not marked preferred. Several active suppliers with no single preferred stay ambiguous and fall back to latest cost. The SQL aggregate follows that rule.

Security PR #2 upload checks, formula-safe reconciliation, price-list, and FBA CSV cells, ledger redaction, and page clamps are included on this branch. Session-cache and general server-function changes remain on that pull request.
