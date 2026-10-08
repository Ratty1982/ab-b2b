# Autopart customer master and historical imports

This path imports the Autopart customer list (407EXP) and the bulk invoice-line and ledger exports (561L and SLRB). It is separate from live orders, stock, fulfilment, and the existing per-company 561L/SLRB importer.

Importing a file does not create a portal user, send email, post an order, or turn historical access on.

## Source inspection — 407EXP (8 Oct 2026 file)

The attached export was inspected in memory. It was not imported into the database.

| Item                                 | Result          |
| ------------------------------------ | --------------- |
| Encoding                             | UTF-8, no BOM   |
| Newlines                             | CRLF only       |
| Size                                 | 1,404,491 bytes |
| Physical lines                       | 25,438          |
| Longest line                         | 81 characters   |
| Page banners                         | 1,288           |
| Repeated column headers              | 323             |
| Data rows                            | 22,859          |
| Distinct account codes               | 22,859          |
| Duplicate account codes              | 0               |
| Rejected rows                        | 0               |
| Blank area                           | 21,927          |
| Blank rep                            | 20,425          |
| Names filling the 30-character field | 159             |

Header positions, measured on the export rather than assumed from spaces:

- Account: columns 0–10
- Separator at column 10
- Name: columns 11–41 (30 characters)
- Area: columns 41–46
- Rep: column 46 to the end of the line

The account value keeps punctuation and leading zeroes. Only the fixed-width padding spaces are removed.

Blank area and blank rep are present on the source rows. They do not by themselves mark an account unidentified.

A name is flagged as possibly truncated when the 30-character name field is full and has no trailing space. That flag is not proof the trading name was cut, and it does not change the classification.

Classifications from the automatic rules on this file:

| Classification  | Accounts |
| --------------- | -------- |
| TRADE_CANDIDATE | 22,827   |
| INTERNAL        | 13       |
| DO_NOT_USE      | 12       |
| STAFF           | 5        |
| CASH            | 2        |
| OBSOLETE        | 0        |
| UNIDENTIFIED    | 0        |
| REQUIRES_REVIEW | 0        |

None of these accounts become portal-eligible because they were parsed.

## 561L and SLRB

`561L-ALL.CSV` and `SLRB-ALL.CSV` were not attached. No row counts, date range, transaction-type census, unmatched-account count, or financial reconciliation of those files has been run. The column layouts below are the documented structures and stay provisional until an administrator uploads the real files and reviews the dry-run preview.

Expected 561L columns: `.Acct.`, `Inv & Ln`, `Part Number`, `Description`, `Units`, `Sales`.

Expected SLRB columns: `A/C`, `Name`, `Sacct`, `Type`, `Ref`, `Date`, `Tot Goods`, an unnamed separator, `Tot VAT`, an unnamed separator, `Total`, `Run Bal`.

## Matching rules

1. Historical rows attach to an Autopart account only when the account code matches exactly, including punctuation and leading zeroes.
2. A company link uses an existing `AutopartAccount` row or an administrator action. Company names are never used to merge or invent a match.
3. Account codes that appear only on 561L or SLRB stay stored with a null company. They do not create a company.
4. One company may have several Autopart accounts after each link is made explicitly.
5. Reimport uses a stable identity: SHA-256 of the natural key plus the occurrence of that key inside the file. Row number is not the identity. A repeated identical line in one file is kept as the next occurrence. A repeated export of the same ordered file updates the existing row.

Invoice natural key: account, raw `Inv & Ln`, part, quantity, sales.

Ledger natural key: account, raw type, reference, date, goods, VAT, total, running balance.

Document match key: account code, document type (`INVOICE` or `CREDIT`), and the uppercased parsed document reference. Payments, journals, and unknown types are stored as ledger rows and are not treated as sales documents.

`I/…/n` is an invoice line. `C/…/n` is a credit line. The full original reference is kept. A reference that does not match that shape is stored with the parse issue and a null document reference, so it is not dropped and it does not match a document.

Amount comparison is the sum of 561L line sales against SLRB goods, at two decimal places. Line sales follow the existing 561L rule: signed net ex VAT. They are not the invoice total. A running balance is the historical source value and is not the current amount due.

## CSV recovery

Interior inch marks are recovered when the quoted field still closes. An unclosed quote that is followed by a complete next record is quarantined, and the next record is kept. A quoted field may continue for up to eight physical lines. Anything past that is quarantined. Quarantined and invalid rows are counted and stored as import issues, up to 2,000 issue rows per batch. Rejected rows above that cap are still counted, and the batch records that the issue log was truncated.

Dates use the existing Autopart date parser (`06 Oct 14` is 6 October 2014). Invalid money rejects the row. An unknown ledger type is stored as `UNKNOWN` with a warning when the amounts parse.

Quantity on the bulk path is stored through the two-decimal money helper, in a `Decimal(14,3)` column. A whole unit such as `-1` is stored as `-1.00`.

## Classification

Automatic classification, in order:

1. Name contains `DO NOT USE` → `DO_NOT_USE`
2. Name contains `OBSOLETE` or `OLD ACCOUNT` → `OBSOLETE`
3. Account is `CASH` or `CASHSALE`, or the name is `CASH`, `CASH CUSTOMER`, or `CASH SALES` → `CASH`
4. The word `STAFF` in the name or account → `STAFF`
5. Name contains Automotive Brands, `FBA`, or Amazon → `INTERNAL`
6. Otherwise → `TRADE_CANDIDATE`

An empty account code is rejected and is not imported. A manual classification is locked, so a later import updates the name, area, and rep without changing that classification. Moving an account off `TRADE_CANDIDATE` turns historical access off.

## Access

`AUTOPART_PORTAL_HISTORY_ENABLED` must be the string `true` before a trade user can call the historical purchase view. The default is off. Even then, the account must be linked, classified `TRADE_CANDIDATE`, belong to an active company with an active portal user, and have historical access granted by someone with `autopart.portal-access.manage`. Granting history does not create a user and does not send email.

Customer-facing route `/portal/autopart-history` is not in the trade navigation.

## Operations

Admin route: `/admin/customers/autopart-imports`.

Upload limit defaults to 250 MB (`AUTOPART_IMPORT_MAX_BYTES`, default `262144000`). Files stream to `AUTOPART_IMPORT_DIR` or `data/autopart-imports`, which is gitignored and outside `public`. The stored path is not returned to the browser. A committed import deletes its temp file. A failed import keeps the file so it can be retried.

Confirmation returns while the batch is `RUNNING`. The work continues in the same Node process, with a heartbeat. A same-kind import already `RUNNING` is rejected. A `RUNNING` batch whose heartbeat is older than 15 minutes and is not active in this process is marked failed and can be retried.

Deploying the application runs the additive migration and RBAC bootstrap. It does not upload or import 407EXP, 561L, or SLRB, and it does not activate any customer. The first real import of the large files must stay a dry run until the preview counts are accepted.
