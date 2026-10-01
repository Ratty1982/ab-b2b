# Autopart customer history onboarding

Automotive Brands B2B (AB) is **not** the accounting system. Autopart/MAM remains authoritative for the customer financial ledger, invoices, credits, payments, and warehouse processing.

**Automotive Brands does not manage customer credit control.** Credit limits, account stop status and available credit remain authoritative in Autopart/MAM and are managed operationally by Accounts.

AB consumes Autopart historic sales reports (561L + SLRB) so existing trade customers see useful purchase context in the portal. AB does **not** import or display current credit position (407P100).

## Business workflow

**Existing Autopart customer**

1. Customer registers (may claim Autopart account number)
2. Trade application submitted
3. Admin reviews / verifies company
4. Admin verifies Autopart account (`Company.autopartCustomerCode` + verifiedAt/By)
5. Admin uploads historic reports (561L + SLRB)
6. AB validates → preview (dry-run) → admin confirms
7. Historic purchase data stored
8. Admin activates/invites customer
9. Customer logs in with useful account history

**New customer (no Autopart history)**

register → approve → activate as today. Historic import is **optional**.

## Source reports

| Report | Purpose | AB use |
|--------|---------|--------|
| **561L** | Historic product-level sales/credit lines | `AutopartSalesLine` |
| **SLRB** | Document headers/dates (and ledger rows) | `AutopartSalesDocument` dates/headers |

Native parsers only — no LLM parsing. Historic document type `CREDIT` in 561L/SLRB is sales-history netting only — not AB credit control.

### 561L

Native printed layout (fixed-width). Header example:

`.Acct. Inv & Ln    Part Number   Description              Units     Sales`

`.Acct.` is **exactly 7 characters**. Inv & Ln begins immediately after — fields may
touch with no whitespace, e.g. `YORKMOTC/SC500093/127113` → account `YORKMOT`,
Inv & Ln `C/SC500093/1`, part `27113`.

`I/…/n` → INVOICE, `C/…/n` → CREDIT (from Inv & Ln identity, never from signed money).
Autopart Amazon/listing rows may omit the line number after the trailing slash
(`I/OIN022047/`). Those are valid financial lines; AB assigns a deterministic
`lineNumber` within the document on import (does not invent document refs or money).
Malformed identities (e.g. bare `I/BADLINE` without `/`) are skipped. Credits stored with signed units/spend.

Report selection `[Start Customer YORKMOTO]` is the authoritative selected customer.
The 7-character body account (`YORKMOT`) is the truncated row representation.

### SLRB

Native printed layout includes Name:

`A/C        Name                               Sacct      Type Ref         Date …`

A/C is the **full** account (`YORKMOTO`). Name is separate (`YORK MOTOR FACTORS`) —
never concatenated into the account field.

`INV` → INVOICE, `CRN` → CREDIT; payments/journals preserved as ledger/diagnostics.  
Dates such as `06 Oct 14` → `2014-10-06` (date-only, no timezone shift).

## Account validation

- Imports require a **staff-verified** `Company.autopartCustomerCode`.
- Account codes are read **only** from the report account column/field (never from Units/Sales/VAT/Run Bal).
- Pure numeric / money values (e.g. `-104.38`, `-1`) are never treated as account codes.
- Format detection is **content-based** (`.txt` and `.csv` both accepted; extension is irrelevant).
Account validation is **source-aware** (not a flat set of equivalent codes):

| Source | Semantics |
|--------|-----------|
| `[Start Customer XXX]` | Full report customer identity |
| SLRB `A/C` | Full account (exact / alias) |
| 561L `.Acct.` | May be the legacy shortened form (e.g. `YORKMOT` for `YORKMOTO`) — validated as that representation, **not** an alias |

- `reportCustomer=YORKMOTO` + `SLRB=YORKMOTO` + `561L=YORKMOT` + verified `YORKMOTO` → **Matched** (no alias).
- Conflicting SLRB full account (e.g. `OTHERACC`) → blocked.
- **561L-only fallback:** unambiguous shortened form with no full identity → `MATCHED_TRUNCATED`. Ambiguous across verified AB accounts → blocked.
- Genuine alternative codes still use `AutopartCustomerAccountAlias`. No global prefix matching.

## Matching rules

- **Document:** company + normalised document reference (exact). Amount/date-only matching is forbidden.
- **SKU:** trim + case-insensitive exact against `ProductVariant.sku`. Unmatched → `NOT_IN_AB_CATALOGUE` (informational, still stored).
- **Last purchased:** latest SLRB `documentDate` among lines for that SKU that have a dated document. No invented dates.

## Data model (separate from Orders)

- `AutopartSalesDocument` / `AutopartSalesLine` — historic Autopart data only  
- `AutopartCustomerImportRun` — preview/commit metadata + hashes (`HISTORY_561L_SLRB`)  
- `AutopartCustomerAccountAlias` — explicit verified aliases  

Do **not** create AB `Order` / `OrderItem` / `Invoice` rows for historic Autopart transactions.

## Large historic imports (retail / high-volume)

A production RETAIL-scale pair (~62k 561L lines, ~70k SLRB documents) previously failed with:

`too many bind variables in prepared statement; expected maximum of 32767, received 32768`

**Root cause:** `bulkUpsertHistoricDocuments` preloaded existing rows with a single

`prisma.autopartSalesDocument.findMany({ where: { companyId, documentReference: { in: refs } } })`

where `|refs| ≈ 32_767`. Prisma binds `companyId` plus every `IN` element → **32_768** binds
(PostgreSQL prepared-statement ceiling is **32_767**). The same pattern existed on the
post-write ID refresh and on line existence lookups.

**Always Preview first** on large customer histories before Confirm.

### Central chunking (`src/server/db/prisma-in-chunks.ts`)

| Constant | Value | Rationale |
|----------|------:|-----------|
| `POSTGRES_MAX_BIND_PARAMS` | 32_767 | Postgres ceiling |
| `SAFE_IN_LIST_CHUNK` | 4_000 | `IN` list + a few companion WHERE binds ≪ ceiling |
| `SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK` | 200 | ~13 binds/row → ~2_600/statement |
| `SAFE_HISTORIC_LINE_UPSERT_CHUNK` | 150 | ~18 binds/row → ~2_700/statement |
| `SAFE_SKU_EQUALS_CHUNK` | 200 | OR-equals SKU resolve batches |

Do **not** use chunk sizes near 32_000. Batch size is driven by **bind parameters**, not row count alone.

### Confirm import write path

Confirm does **not** hold one interactive Prisma `$transaction` across hundreds of thousands
of operations (timeouts, lock duration, connection pressure).

1. Parse / validate / resolve SKUs **outside** any write transaction (Preview remains read-only)  
2. Create `AutopartCustomerImportRun` with status `PROCESSING` + audit `history_import_started`  
3. Persist progress on `diagnostics.progress` (phase/message/counts)  
4. Bulk upsert documents then lines via Postgres `INSERT … ON CONFLICT`, in safe chunks  
5. Mark run `COMMITTED` only after all writes succeed; on fatal error mark `FAILED` with
   truthful partial-progress diagnostics (never “nothing written” if batches persisted)  
6. Audit `history_imported` / `history_reimported` / `history_import_failed` — **summary counts only**, not per-document events  

**Small imports** (combined docs+lines &lt; 12_000): Confirm awaits completion synchronously.  
**Large imports** (≥ 12_000): Confirm returns immediately with `async: true` and `runId`;
work continues **in-process** on the Node server (no Redis/BullMQ/Coolify cron). The admin UI
polls `getHistoricImportRunStatus`. Browser refresh/close is safe — progress lives on the run row.

### Retry / idempotency

Stable unique keys:

- Document: `(companyId, documentType, documentReference)`
- Line: `(companyId, documentType, documentReference, lineNumber)`

Failed runs after partial batches are **safe to retry**: ON CONFLICT upserts recognise already
written rows; no duplicate financial documents or product lines. Status stays `FAILED` until a
later run reaches `COMMITTED`.

Authoritative success (`hasSuccessfulHistoricImport`) requires `status = COMMITTED`,
`completedAt != null`, and persisted row evidence (`rowsImported`/`rowsUpdated` > 0 or
related documents/lines). Phantom `COMMITTED` rows from older create-before-write builds
are reclassified to `FAILED` so Preview never reports “already imported” after a failed
attempt. Active `PROCESSING` blocks confirm; stale `PROCESSING` (>15 minutes) is recovered
to `FAILED` for safe retry.

## Matching counts (561L ↔ SLRB)

| Metric | Definition |
|--------|------------|
| **matchedDocuments** | Distinct **561L** document references that also appear in SLRB |
| **unmatched561Documents** | Distinct 561L refs with no SLRB header |
| **slrbDocumentsWithoutLines** | Distinct **SLRB** document references with no 561L product lines |

These are set arithmetic on document references (not invoice-only counts). Therefore:

`|SLRB document refs| = matchedDocuments + slrbDocumentsWithoutLines`

(when unmatched 561L is zero). The admin Preview “SLRB: N invoices” figure is
`invoiceDocuments` only — credits are separate (`creditDocuments`). A RETAIL-style
preview can show ~69_953 invoices while `matched + slrbWithoutLines` equals the full
INV+CRN document-ref set (~70_493). The **12_107** SLRB-without-561L figure is
informational (ledger/header-only or lines outside the 561L extract) — **do not fabricate
product lines**. Semantics are unchanged.

## NOT_IN_AB_CATALOGUE

Historic SKUs with no current `ProductVariant` stay stored with source SKU, description,
quantity, and sales value. They are **not** blocking, not fuzzy-matched, and not
auto-created as catalogue products. Expected for retail-only / discontinued lines. They
remain available to Sales Intelligence, Customer Groups, and CSV/reporting.

## Customer Groups

Historic imports always target a **Company / MAM account**. Customer Groups aggregate
member companies — there is no separate group-level financial import. After RETAIL (or any
member) history is imported, the group workspace reflects it automatically.

Group document/product drill-downs are **database-paginated**; summary cards use
aggregation/`groupBy` when line volume is large so the UI never loads tens of thousands of
raw rows into the browser.

## Idempotency (summary)

Re-import updates safely; does not duplicate spend/units. Exact file-hash matches warn
“already imported” only after a successful `COMMITTED` run.

Historic 561L/SLRB data is **not** a financial ledger and must **never** drive current credit decisions.

## Portal

- `/portal/purchases` — **Purchase History** (customer-facing)

### Purchase History semantics

Authoritative source for this screen: imported `AutopartSalesLine` / `AutopartSalesDocument` only.
AB `Order` / `OrderItem` rows are **not** merged. Combining them later must use a non-overlapping
boundary so the same commercial event is never counted twice if it also appears in a later Autopart
historic import.

| Metric | Definition |
|--------|------------|
| Products purchased | Distinct historic SKUs (after credit netting of units/spend) |
| Purchase transactions | Distinct **INVOICE** documents that have at least one product line |
| Historic net spend | Sum of signed line `salesNet` (credits negative) |
| Units purchased | Sum of signed line `units` (credits negative) |
| Purchases (per SKU) | Count of distinct **INVOICE** `documentReference` values — not 561L line rows |
| Last / first purchased | Latest / earliest reliable SLRB `documentDate` on invoice lines — never fabricated |
| Monthly trend | Dated lines only, grouped by UTC date-only month (`YYYY-MM`); credits land in their own credit document month |

**Undated lines:** included in net units/spend and invoice purchase counts, but excluded from date
filters and monthly charts. Date filters never treat undated activity as inside the selected period.

**Credits:** reduce net units/spend; never increment purchase count.

**Historic-only products:** no current trade-visible catalogue match → show historic description +
“Historic product”; no Buy again.

**Buy again:** navigates to the current catalogue product and uses live price / case / stock /
backorder rules. Never reuses historic price or quantity.

**Trends are factual only** — no predicted next order date, reorder reminders, or demand forecasting.

Implementation: `src/server/companies/purchase-history.ts`.

## Admin

Customer workspace → **Autopart** tab:

- verified account status
- historic import status
- import historic (561L+SLRB) preview/confirm
- aliases
- top purchased summary

## Security / audit

Company-scoped; IDOR-safe. Staff need `companies.edit` (history). Trade/customer users
must not access historic import, progress, or internal diagnostics (server-enforced).

Audited (summary only): alias verified, history previewed/started/imported/reimported/failed.
Raw financial files are not stored in audit JSON; import runs store hashes + counts + progress.

## Future automation boundary

Manual admin upload only in this phase for 561L/SLRB historic onboarding/history.

## Key modules

- `src/domain/autopart-561l.ts` / `autopart-slrb.ts`
- `src/server/companies/autopart-history.ts`
- `src/components/ab/AutopartCustomerHistoryPanel.tsx`
- `docs/autopart-customer-history.md`
