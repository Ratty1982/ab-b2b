# Autopart customer history & credit onboarding

Automotive Brands B2B (AB) is **not** the accounting system. Autopart/MAM remains authoritative for the customer financial ledger, invoices, credits, payments, credit exposure, credit limit, and warehouse processing.

AB consumes selected Autopart reports so existing trade customers see useful historic purchase context and a current credit snapshot in the portal.

## Business workflow

**Existing Autopart customer**

1. Customer registers (may claim Autopart account number)
2. Trade application submitted
3. Admin reviews / verifies company
4. Admin verifies Autopart account (`Company.autopartCustomerCode` + verifiedAt/By)
5. Admin uploads historic reports (561L + SLRB) and/or 407P100
6. AB validates → preview (dry-run) → admin confirms
7. Historic purchase data + credit position stored
8. Admin activates/invites customer
9. Customer logs in with useful account history

**New customer (no Autopart history)**

register → approve → activate as today. Historic import is **optional**.

## Source reports

| Report | Purpose | AB use |
|--------|---------|--------|
| **561L** | Historic product-level sales/credit lines | `AutopartSalesLine` |
| **SLRB** | Document headers/dates (and ledger rows) | `AutopartSalesDocument` dates/headers |
| **407P100** | Current credit exposure | `AutopartCreditPosition` |

Native parsers only — no LLM parsing.

### 561L

Fields: Acct., Inv & Ln, Part Number, Description, Units, Sales.

`I/SS306008/1` → type INVOICE, ref SS306008, line 1.  
`C/...` → CREDIT. Malformed identities are skipped (no guessing).

Credits are stored with signed units/spend (negative) so net history is correct.

### SLRB

Fields: A/C, Type, Ref, Date, Tot Goods, Tot VAT, Total, Run Bal.

`INV` → INVOICE, `CRN` → CREDIT; payments/journals preserved as ledger/diagnostics.  
Dates such as `06 Oct 14` → `2014-10-06` (date-only, no timezone shift).

SLRB is **not** the authoritative current credit calculation when 407P100 is available.

### 407P100

Components: Invoices, Picking, DropShip, CrossDock, Suspends, UnConsol, Total, Credit Limit.

```
Used Credit (customer term) = Total
Available Credit (raw) = Credit Limit − Total
```

Example: £5,000 − £3,494.75 = £1,505.25 available.

Over-limit raw negatives are preserved (`availableCreditRaw`); UI may show £0 available + over-limit amount.

## Account validation

- Imports require a **staff-verified** `Company.autopartCustomerCode`.
- Account codes are read **only** from the report account column/field (never from Units/Sales/VAT/Run Bal).
- Pure numeric / money values (e.g. `-104.38`, `-1`) are never treated as account codes.
- Format detection is **content-based** (`.txt` and `.csv` both accepted; extension is irrelevant).
- Exact match to verified code or staff-verified `AutopartCustomerAccountAlias` is preferred.
- **561L / SLRB only:** when the parser confirms a truncated report account field width (consistent printed length / fixed-width layout), an unambiguous match of the report account to the first N characters of the company's verified code is accepted as `MATCHED_TRUNCATED` (e.g. report `YORKMOT`, verified `YORKMOTO`, width 7). If two verified AB accounts share that truncated form → `AMBIGUOUS_TRUNCATED` (blocked). This does **not** apply to 407P100.
- No general `startsWith` / fuzzy matching. Portal customers cannot upload reports.

## Matching rules

- **Document:** company + normalised document reference (exact). Amount/date-only matching is forbidden.
- **SKU:** trim + case-insensitive exact against `ProductVariant.sku`. Unmatched → `NOT_IN_AB_CATALOGUE` (informational, still stored).
- **Last purchased:** latest SLRB `documentDate` among lines for that SKU that have a dated document. No invented dates.

## Data model (separate from Orders)

- `AutopartSalesDocument` / `AutopartSalesLine` — historic Autopart data only  
- `AutopartCreditPosition` — one current snapshot per company  
- `AutopartCustomerImportRun` — preview/commit metadata + hashes  
- `AutopartCustomerAccountAlias` — explicit verified aliases  

Do **not** create AB `Order` / `OrderItem` / `Invoice` rows for historic Autopart transactions.

## Idempotency

Stable unique keys:

- Document: `(companyId, documentType, documentReference)`
- Line: `(companyId, documentType, documentReference, lineNumber)`
- Credit: upsert by `companyId`

Re-import updates safely; does not duplicate spend/units. Exact file-hash matches warn “already imported”.

## Credit display precedence

When a trusted 407P100 snapshot exists, portal **Account credit** uses the imported Autopart credit limit / used / available.

`Company.creditLimit` may remain for legacy/admin fields but must not invent available credit from AB orders.

Freshness: `CURRENT` | `STALE` (>7 days) | `NOT_AVAILABLE`. Europe/London DD/MM/YYYY HH:mm.

Historic 561L/SLRB data is **not** a financial ledger and must **never** drive current credit decisions. Operational credit control (holds, pending AB exposure, Autopart export gating) is documented in `docs/credit-control.md`.

## Portal

- Dashboard: Account credit panel when snapshot exists; otherwise “not currently available”
- `/portal/purchases`: Previously purchased (net units/spend, last purchased when dated, Buy again → current catalogue rules)

Buy again never reuses historic price.

## Admin

Customer workspace → **Autopart** tab:

- verified account status
- historic / credit import status
- import historic (561L+SLRB) preview/confirm
- update credit (407P100) preview/confirm
- aliases
- top purchased summary

### Bulk 407P100 (Settings → Autopart)

Admin → System → Settings → Autopart → **Customer credit**:

1. Upload one multi-customer 407P100 CSV (manual mode)
2. Dry-run preview (no writes)
3. Confirm → transactional upsert of matched verified companies

Matching (exact normalised only):

- `Company.autopartCustomerCode` (staff-verified) → `MATCHED`
- `AutopartCustomerAccountAlias` (staff-verified, company must also be verified) → `MATCHED_ALIAS`
- No AB company → `NOT_IN_AB` (informational; does **not** fail import, create companies, or raise Needs Attention)
- Same account twice in file → `DUPLICATE` (blocked for that account only)
- Bad Total / Credit Limit → `INVALID` (blocked for that row only)

Partial success is expected. `NOT_IN_AB` alone is healthy. Duplicates/invalid rows yield `SUCCESS_WITH_WARNINGS`.

Change detection compares against the existing `AutopartCreditPosition`. Financially identical rows still refresh `sourceImportedAt` (freshness) on confirm. Exact file-hash re-upload of a committed bulk run is blocked with “already imported”.

Import runs use `AutopartCustomerImportType.CREDIT_407P100_BULK` with `companyId = null` and summary counts on the run.

Per-customer Autopart tab import remains available and shares `parseAutopart407p100`.

## Security / audit

Company-scoped; IDOR-safe. Staff need `companies.edit` (history) / `credit.edit` or `companies.edit` (credit). Bulk import requires `credit.edit` (or `settings.edit` / `admin.access`).

Audited: alias verified, history previewed/imported/reimported, credit imported/updated, `autopart.credit_bulk_imported`. Raw financial files are not stored in audit JSON; import runs store hashes + counts.

## Future automation boundary

Manual admin upload only in this phase. The same parser + `previewBulkAutopartCreditImport` / `confirmBulkAutopartCreditImport` services are the single path a later scheduled Autopart mailbox ingestion for **407P100** must call. Do not implement IMAP/email polling/scheduler here.

561L/SLRB remain primarily onboarding/history.

## Key modules

- `src/domain/autopart-561l.ts` / `autopart-slrb.ts` / `autopart-407p100.ts`
- `src/server/companies/autopart-history.ts`
- `src/server/companies/autopart-credit-bulk.ts`
- `src/server/companies/autopart-credit-freshness.ts`
- `src/components/ab/AutopartCustomerHistoryPanel.tsx`
- `src/components/ab/AutopartBulkCreditImportPanel.tsx`
- `docs/autopart-customer-history.md`
