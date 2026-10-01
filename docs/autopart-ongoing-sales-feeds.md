# Autopart ongoing sales data architecture

## Sources

| Source | Role |
| --- | --- |
| **231PO3NEW** | Current stock Avail + Latest Cost (Cost Intelligence) |
| **561L + SLRB** | Historical customer/product sales baseline |
| **AB Orders** | Operational AB-originated orders (SKU/qty/price) — not SI realised-sales rows |
| **504** | Ongoing Autopart invoice/credit **documents** (Goods net, VAT, Value, Customer Order Number) |
| **TRM21QC** | Ongoing Autopart **product lines** (signed Qty + NET Sales EX VAT) |
| **504C** | Legacy/fallback order-despatch feed — **kept** until 504 is proven in production |

Do **not** use 504UF.

## Join

```text
504.Document  =  TRM21QC.Document   (exact)
```

Reconciliation:

```text
SUM(TRM21QC.Sales)  ≈  504.Goods     (NET to NET, ±1p)
```

Do not compare TRM21QC Sales to 504 gross Value.

### TRM21QC Description quoting (Autopart inch marks)

Autopart sometimes emits an unescaped `"` (inch) inside an already-quoted Description, e.g. `"14" Phoenix…"`. Strict CSV would shift Qty/Sales. The TRM21QC parser recovers these rows by taking the first five fields (Cust…Part Number) and the last five financial fields (Qty…Perc%) from structural boundaries; the middle is Description. If the five trailing financial tokens cannot be identified confidently, the row is rejected as `PARSE_ERROR` — never with an invented Sales value. `INVALID_NET_SALES` is reserved for blank/invalid Sales after confident recovery.

## Credits

Credit notes are first-class:

- negative 504 Goods/VAT/Value
- negative TRM21QC Qty/Sales
- reduce Net Sales / units in Sales Intelligence
- never create purchase presence
- never create despatch / stock movements / credit-control

## AB order match

```text
504.Customer Order Number  =  Order.orderNumber   (exact AB-######)
```

No fuzzy matching. Non-AB references are ignored for despatch. Credits may link to an AB order but never despatch.

## Deduplication / no double counting

- Historic document uniqueness remains company-scoped: `(companyId, documentType, documentReference)`
- Ongoing documents also use a partial unique index on `(documentType, documentReference)` where `has504` or `hasTrm21qc`
- Imports find existing rows by Autopart document number first — never create a second financial sale for the same document
- Line natural key: `(companyId, documentType, documentReference, lineNumber)` with stable TRM21QC fingerprints (supports repeated SKUs)
- Overlapping 13:00 / 18:00 / manual / email imports are idempotent
- Sales Intelligence reads `AutopartSalesLine` only (historic + ongoing) — **not** AB `OrderItem` rows, so realised Autopart invoice lines are not double-counted with order placement

## Schedule

Autopart is asked to email **both** 504 and TRM21QC at:

- 13:00 Europe/London Mon–Fri (interim)
- 18:00 Europe/London Mon–Fri (final expected daily feed)

In-app scheduler follows the 504C pattern (minute tick, window keys, no Coolify cron). Defaults **OFF**.

Polling must tolerate late arrival. Missing companion report mid-day → `AWAITING_504` / `AWAITING_LINES` (not fatal). After the final expected 18:00 window, unresolved companion gaps are more visible in diagnostics. No Saturday/Sunday missing-feed warnings.

## Freshness

Sales Intelligence shows latest successful 504 / TRM21QC import times. If feeds diverge materially, the UI notes that they are not fully aligned.

## Admin

Settings → **Autopart ongoing sales feeds**:

- Manual upload + **preview** + **confirm** for 504 and TRM21QC
- Poll Now (requires configured + enabled)
- Import history with run detail / diagnostics / CSV export

Legacy **Autopart invoice / despatch feed (504C)** panel remains above.

### Preview workflow

1. Choose a 504 or TRM21QC file.
2. The server parses with the **same** rules as commit (no financial writes).
3. Preview shows would-insert / would-update / already-known / would-skip / warnings / errors, with reason codes for skip/warning/error rows.
4. Confirm only after review (`Confirm 504 import` / `Confirm TRM21QC import`).

### Commit workflow

Confirm creates an `AutopartCustomerImportRun`, writes `AutopartSalesDocument` / `AutopartSalesLine` idempotently, and persists row diagnostics in `AutopartImportDiagnostic`.

Re-uploading the same report must not create duplicate financial sales (document + stable line keys).

### Import statuses (run)

| Status | Meaning |
| --- | --- |
| PROCESSING | Confirm in progress |
| COMMITTED | Finished successfully |
| FAILED | Aborted; no reliance on partial financial writes |

### Diagnostic row statuses

| Status | Meaning |
| --- | --- |
| INSERTED | New document/line written |
| UPDATED | Existing row enriched/changed |
| UNCHANGED | Identical data already present (`ALREADY_IMPORTED`) |
| SKIPPED | Not written (e.g. unmapped customer lines) |
| WARNING | Processed with a warning flag (e.g. SKU not in catalogue) |
| ERROR | Parse / malformed failure |

### Diagnostic reason codes (real importer behaviour)

| Code | When |
| --- | --- |
| `INSERTED` | New financial row |
| `UPDATED` | Existing row refreshed |
| `ALREADY_IMPORTED` | Idempotent re-import; values unchanged |
| `BLANK_ROW` | Empty source row |
| `PARSE_ERROR` / `MALFORMED_ROW` | Generic invalid source row (prefer field-specific codes below). Includes TRM21QC rows whose Description quoting is too corrupt to recover the five trailing financial fields. |
| `MISSING_DOCUMENT` / `MISSING_PART_NUMBER` | Required identity field missing |
| `INVALID_NET_SALES` / `INVALID_QUANTITY` / `INVALID_DOCUMENT` | After confident column recovery, Sales (or qty/doc) is blank/unparseable — no financial value invented. Not used for Description quote-shift failures. |
| `UNRECOGNISED_ROW_TYPE` | Total / subtotal / page / non-product report artefact |
| `UNMAPPED_CUSTOMER` | Autopart account not linked to an AB company — **TRM21QC lines are skipped** (headers may still be retained) |
| `NOT_IN_AB_CATALOGUE` | Exact SKU match failed; line **is still imported** with unmatched status (warning) |

### Investigating skipped records

Open **Import history → run** and filter **Skipped**.

For TRM21QC, skipped lines are almost always `UNMAPPED_CUSTOMER` (lines require `companyId`).

Use **Map account** on the diagnostic row (keeps the Autopart account context) or open:

**Customers → Autopart accounts** (`/admin/customers/autopart-accounts`)

to work through unique unmapped accounts sorted by net sales affected.

Historic runs created before row diagnostics: the UI shows an aggregate explanation and does **not** invent row-level history. Use **Export run diagnostics CSV** for future runs.

### Customer Groups (reporting layer)

Customer Groups are an **Automotive Brands-owned** commercial/reporting aggregation:

```
Customer Group  →  Company  →  MAM account(s)  →  documents  →  product lines
```

Examples: **Vertu** (many dealership companies) and **Retail Accounts** (independent MAM accounts grouped for AB reporting only).

Customer Groups do **not**:

- represent or modify Autopart/MAM parent–child hierarchy
- rewrite financial ownership (sales stay on the resolved Company)
- grant trade users cross-company portal access
- auto-create from Autopart names

Independent customers may remain ungrouped (`customerGroupId = null`).

Manage via **Customers → Customer Groups**. Account mapping still always targets a **Company** first; the Company's optional group is shown informationally.

### Customer account mapping

Ongoing 504 / TRM21QC matching is deterministic:

1. Exact Autopart account → `Company.autopartCustomerCode` (case-insensitive)
2. Exact Autopart account → `AutopartCustomerAccountAlias.alias`
3. For AB-originated 504 rows: `Customer Order Number` → `Order.orderNumber` → Company (unchanged)

No fuzzy name matching. Staff must explicitly map.

**Map existing customer**

Search by company name, Autopart account, contact, email, postcode, VAT → select company → confirm **Map account**.

- Company with no primary Autopart code → set + verify primary
- Company with a different verified primary → add as alias
- Same Autopart code cannot silently point at two companies; reassignment requires explicit confirmation and is audited

**Create missing customer**

From the mapping drawer: **Create new customer** retains the originating Autopart account, creates the company with staff-entered details only (nothing invented from TRM rows), then maps the account.

**Recover previously skipped lines**

Raw report text is not retained after import. After mapping, **re-upload** the TRM21QC/504 file (from the mapping drawer or Settings import). The standard pipeline runs again:

- already-written lines → `UNCHANGED`
- newly mapped accounts → `INSERTED`
- remaining unmapped accounts stay `SKIPPED`
- no duplicate financial sales

### Errors vs catalogue warnings

Filter **Errors** on a run to see the exact row and reason (`INVALID_NET_SALES`, `MISSING_DOCUMENT`, `UNRECOGNISED_ROW_TYPE`, etc.).

`NOT_IN_AB_CATALOGUE` is an **informational warning**, not an error and not an import failure:

- common for retail-only Autopart products not stocked in B2B
- line is still written when the customer is mapped
- no automatic Product / ProductVariant creation
- no fuzzy SKU matching

### Warning vs skip vs error

- **Skip** — not written to financial lines/documents (except retained unmapped document headers).
- **Warning** — written, but needs attention (e.g. SKU not in catalogue).
- **Error** — source row invalid / unparseable.

### 504 vs 504C

| Feed | Role |
| --- | --- |
| **504** | Ongoing Autopart invoice/credit **documents** (Goods net, VAT, Value, Customer Order Number) |
| **504C** | Legacy/fallback **despatch/status** feed — kept until 504 is proven |

Parsers and detectors remain distinct. Do not treat a 504 upload as 504C.

## Automatic import

Defaults **OFF**. Enable only after Autopart configures the scheduled emails. Reuses stock IMAP credentials; attachment pattern broadened to `*.csv` for this poll; content detection distinguishes 504 vs 504C vs TRM21QC.
