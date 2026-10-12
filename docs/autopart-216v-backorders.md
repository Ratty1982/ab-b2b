# Autopart 216V backorder intelligence

Purchasing → **Backorders** (`/purchasing/backorders`) is the operational workspace for the daily Autopart **216V** outstanding-backorder report.

216V is emailed once per working day at approximately **18:15 Europe/London**. It is **not** the 231PO3NEW stock feed and does not use the 36-hour stock freshness rule.

## Detection

Content is authoritative. Filename (`216V.CSV`, `216V.csv`, and other safe names) is only a candidate hint.

Production headers are awkward and must be accepted as-is:

```
"Order No","Custome","r and Name","","Part Number","Description","","Ord No","OSQty","Unit","O/S Val"
```

Interpreted as:

| Source header | Meaning |
| --- | --- |
| Order No | Autopart sales order number |
| Custome | Customer account |
| r and Name | Customer name snapshot |
| (blank) | ignored |
| Part Number | SKU |
| Description | Description snapshot |
| (blank) | ignored |
| Ord No | Customer order / reference |
| OSQty | Outstanding quantity |
| Unit | Unit value from this report — **not** Latest Cost |
| O/S Val | Outstanding value |

A file is 216V only when those columns are present. TRM21QC, 231PO3NEW, and 504 listings are rejected.

## Line identity

Strongest stable business identity (base):

`Order No | customer account | SKU matchKey`

Customer Name and Product Description never participate in identity.

When that base is unique in a snapshot, it identifies the line alone. Customer Order / Reference is **not** required in that case — Autopart may expand truncated references between daily files (for example `ADDITIV` → `ADDITIVELAUNCHSTOCK`) without creating false CLEARED + NEW movement. Matched lines keep a continuous `identityKey` / first-seen history while displaying the latest full reference, name, and description.

When the same base repeats in one file, Customer Order / Reference is a secondary discriminator. Identical refs keep a 1-based `#n` suffix. Across snapshots, duplicate-base groups may match only via unambiguous prefix-compatible references (one value is a genuine prefix/truncation of the other). Ambiguous groups are left unmatched (previous → CLEARED, next → NEW) rather than guessed. Part number alone is not unique. Legitimate multiple order lines are not collapsed.

## Snapshots

Each successful import is an `AutopartBackorderSnapshot` with `AutopartBackorderLine` rows.

The current outstanding position is the latest **verified Monday–Friday** COMMITTED snapshot. Tie-break is email received time, then import time, then id. Import time alone never makes an older report current. Previous snapshots stay for history and audit. A duplicate file hash does not create a second snapshot; if that file is already the latest verified report, it remains current.

Report date comes from `216V_YYYYMMDD` in the filename, then the email received day, then the import day. A mailbox poll updates the poll clock only. It updates last successful import only when a file is actually committed, and that timestamp is not the report date.

Scheduled 216V reports are Monday to Friday. A Saturday or Sunday date on the filename or the email receipt is stored as that observed calendar date and flagged for review. It does not become the current position while a Monday–Friday snapshot exists, and it is not rewritten to the previous Friday. The CSV has no date column, so the reporting business day cannot be taken from the file body.

### `216V_20261010.csv`

10 October 2026 is a Saturday. This application does not rename mailbox attachments, so `216V_YYYYMMDD` is the name on the email. The chronology record pairs that name with receipt time `2026-10-10T17:01:37Z` (18:01 Europe/London) and import time `2026-10-12T17:16:07Z` (Monday 18:16 Europe/London). Local databases do not hold this production file, and this change does not read or write production snapshots.

The Saturday stamp matches the attachment name and the receipt day. It does not match the import day. Filename and receipt on the same Saturday fit a file generated and emailed that day. They do not establish a scheduled reporting business day, because Autopart does not send 216V on Saturday or Sunday. The file stays in history with date 10 October 2026 and a review flag.

Comparison vs the previous report in that chronology:

| Status | Meaning |
| --- | --- |
| NEW | Identity not outstanding yesterday |
| UNCHANGED | Same outstanding qty |
| QUANTITY REDUCED | Qty fell |
| QUANTITY INCREASED | Qty rose |
| CLEARED | Present yesterday, absent from this valid snapshot |

**CLEARED is only derived from a successful new parse.** A missing, failed, or malformed file never clears yesterday's backorders. The workspace keeps showing the latest available snapshot with a stale warning.

A strongly identified empty 216V (real header, zero data rows) may clear all previous outstanding lines. That is audited as `purchasing.backorders.empty_snapshot`. Filename alone is not enough.

Duplicate `fileHash` does not create a second snapshot.

## Customers and products

- Companies are **not** required. Unmapped Autopart accounts still appear (account code + name snapshot).
- Companies are **not** auto-created.
- If a mapping exists, the line links to the AB Company.
- Part numbers match `AutopartProduct` via existing SKU `matchKey`. Catalogue products are **not** created.
- Classification: Catalogue / External product / Historic/not current.

## Stock cover

Cross-reference current 231PO3NEW / AutopartProduct:

- **Avail** remains authoritative sellable stock.
- **Incoming** remains P/Ord Qty. **No ETA is invented.**

Cover is calculated at **SKU level** against total outstanding demand, then shown on each line as indicative — not a reservation or allocation.

Examples:

- Avail 20 / backorder 6 → STOCK AVAILABLE
- Avail 10 / total backorder 16 → PART STOCK AVAILABLE (`10 available against 16 backordered`)
- Avail 0 / Incoming 20 / backorder 12 → INCOMING COVERS
- Avail 0 / Incoming 5 / backorder 12 → INCOMING PART COVERS
- Avail 0 / Incoming 0 → NO STOCK / NO INCOMING
- SKU absent from current stock feed → PRODUCT NOT IN CURRENT STOCK FEED

## Age

216V does not include original order date. Age is **Backorder first seen** from snapshot history (`Seen for 1 day`, `Seen for 4 days`, …). SB order numbers are not parsed as dates.

## Freshness

Expected: Monday to Friday, ~18:15 Europe/London, 90-minute grace (overdue from 19:45). Freshness uses the verified Monday–Friday report date, not the import clock and not a weekend filename. After 19:45 Europe/London, a missing Monday–Friday report is REPORT OVERDUE, including Monday when Monday's file has not arrived. On Saturday and Sunday the latest verified working-day snapshot stays on screen, with no overdue warning only because a weekend file did not arrive. A weekend-dated file that is the only snapshot stays visible and flagged; it still does not count as Monday's report.

## Purchasing forecast

Stock Forecast / SKU drill-down may show `Customer Backorders: N units`. This is a separate signal. Outstanding backorder quantity is **not** added to historical weekly demand and does **not** change forecast weights.

## IMAP

Reuses the Autopart mailbox. Automatic polling is **off** until Purchasing manage enables the 216V feed. 216V polling does not auto-archive messages (504 / TRM / stock may share the mailbox).

Permissions: `purchasing.view` to view, `purchasing.manage` to upload / enable / poll. Trade and public have no access.
