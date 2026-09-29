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
Malformed identities are skipped (no guessing). Credits stored with signed units/spend.

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

## Confirm import write path

Confirm does **not** hold one interactive Prisma `$transaction` across thousands of
row round-trips (that caused `Transaction not found` on large YORKMOTO-scale files).

1. Parse / validate / resolve SKUs **outside** any write transaction  
2. Create `AutopartCustomerImportRun` with status `PROCESSING`  
3. Bulk upsert documents then lines (Postgres `INSERT … ON CONFLICT`, chunked; duplicate line keys deduped)  
4. Mark run `COMMITTED` only after all writes succeed (`completedAt` set); on write failure mark `FAILED` with the root client  

Authoritative success (`hasSuccessfulHistoricImport`) requires `status = COMMITTED`,
`completedAt != null`, and persisted row evidence (`rowsImported`/`rowsUpdated` > 0 or
related documents/lines). Phantom `COMMITTED` rows from older create-before-write builds
are reclassified to `FAILED` so Preview never reports “already imported” after a failed
attempt. Active `PROCESSING` blocks confirm; stale `PROCESSING` (>15 minutes) is recovered
to `FAILED` for safe retry.

## Idempotency

Stable unique keys:

- Document: `(companyId, documentType, documentReference)`
- Line: `(companyId, documentType, documentReference, lineNumber)`

Re-import updates safely; does not duplicate spend/units. Exact file-hash matches warn “already imported” only after a successful `COMMITTED` run.

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

Company-scoped; IDOR-safe. Staff need `companies.edit` (history).

Audited: alias verified, history previewed/imported/reimported. Raw financial files are not stored in audit JSON; import runs store hashes + counts.

## Future automation boundary

Manual admin upload only in this phase for 561L/SLRB historic onboarding/history.

## Key modules

- `src/domain/autopart-561l.ts` / `autopart-slrb.ts`
- `src/server/companies/autopart-history.ts`
- `src/components/ab/AutopartCustomerHistoryPanel.tsx`
- `docs/autopart-customer-history.md`
