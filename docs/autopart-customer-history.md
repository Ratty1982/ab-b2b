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
- Detected report accounts must **exact-match** (case-insensitive, trimmed) the verified code.
- Prefix matches (YORKMOT vs YORKMOTO) are **blocked** unless an explicit `AutopartCustomerAccountAlias` is staff-verified.
- No fuzzy matching. Portal customers cannot upload reports.

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

## Security / audit

Company-scoped; IDOR-safe. Staff need `companies.edit` (history) / `credit.edit` or `companies.edit` (credit).

Audited: alias verified, history previewed/imported/reimported, credit imported/updated. Raw financial files are not stored in audit JSON; import runs store hashes + counts.

## Future automation boundary

Manual admin upload only in this phase. The same parser/import services are designed so a later scheduled Autopart email ingestion for **407P100** can call them without duplicating business logic. Do not implement email polling here.

561L/SLRB remain primarily onboarding/history.

## Key modules

- `src/domain/autopart-561l.ts` / `autopart-slrb.ts` / `autopart-407p100.ts`
- `src/server/companies/autopart-history.ts`
- `src/server/companies/autopart-credit-freshness.ts`
- `src/components/ab/AutopartCustomerHistoryPanel.tsx`
- `docs/autopart-customer-history.md`
