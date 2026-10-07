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

The latest **COMMITTED** snapshot is the current outstanding position. Previous snapshots are retained.

Comparison vs the previous successful snapshot:

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

Expected: working days, ~18:15 Europe/London, 90-minute grace. Weekends use the last working day's report and do not alert merely because Saturday/Sunday had no file.

## Purchasing forecast

Stock Forecast / SKU drill-down may show `Customer Backorders: N units`. This is a separate signal. Outstanding backorder quantity is **not** added to historical weekly demand and does **not** change forecast weights.

## IMAP

Reuses the Autopart mailbox. Automatic polling is **off** until Purchasing manage enables the 216V feed. 216V polling does not auto-archive messages (504 / TRM / stock may share the mailbox).

Permissions: `purchasing.view` to view, `purchasing.manage` to upload / enable / poll. Trade and public have no access.
