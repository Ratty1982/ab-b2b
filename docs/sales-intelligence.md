# Sales Intelligence

Internal staff module for factual Autopart historic sales enquiry.

**Phase 1 ships:** Sales Enquiry (Customers + Products).

**Not yet built:** Gap Analysis, Rebate Analysis, Reports, salesperson performance, dashboards.

## Route & navigation

- Route: `/sales/sales-intelligence`
- Nav section: **Sales Intelligence → Sales Enquiry**
- CRM remains separate

URL-backed state examples:

- `?mode=customers&companyId=…&period=LAST_30`
- `?mode=products&sku=…&period=CUSTOM&from=2026-01-01&to=2026-09-29&compare=PREVIOUS`

## RBAC

Permission: `sales_intelligence.view`

Granted to:

- Super Admin
- Management
- Sales Manager
- Sales Representative
- Accounts

Not granted to Marketing, Customer Service (by default), or any trade portal role.

Enforced server-side on every search, enquiry, and CSV export. Trade sessions receive 403 even with a direct URL or API call.

Company scope:

- `sales.view_all_accounts` / `admin.access` → all companies
- own/team sales keys → assigned companies
- Accounts (permission without sales scope) → all companies for enquiry

## Source of truth

| Source | Role in Sales Enquiry |
|--------|------------------------|
| **561L + SLRB** → `AutopartSalesDocument` / `AutopartSalesLine` | Authoritative invoiced sales & credits |
| Purchase History period semantics | Shared Europe/London date-only filtering |
| **AB Orders** | Excluded from Invoice/Credits/Net Sales |
| **504C** | Excluded (despatch feedback, not line-level history) |
| **231PO3NEW cost** | Optional informational “Latest Autopart cost” only — never historic margin |

Do not double-count Autopart historic sales and AB native orders.

## Metric definitions

Centralized in `src/domain/sales-intelligence.ts` and computed in `src/server/sales-intelligence/enquiry.ts`.

| Metric | Definition |
|--------|------------|
| **Invoice Sales** | Sum of `INVOICE` line `salesNet` in the selected period |
| **Credits** | Sum of `CREDIT` line `salesNet` (signed; typically negative) |
| **Net Sales** | Invoice Sales + Credits |
| **Units** | Signed net units in period |
| **Purchase Transactions** | Distinct `INVOICE` document references (credits never count; line count ≠ transaction count) |
| **Products Purchased** | Distinct SKUs with qualifying lines (customer enquiry) |
| **Customers** | Distinct companies with qualifying lines (product enquiry) |

Rebate-ready helper:

```ts
getCustomerNetSales(actorUserId, companyId, from, to)
```

## Date semantics

Shared with Purchase History via `src/domain/sales-history-period.ts`:

- Europe/London civil calendar for “today”
- Date-only `YYYY-MM-DD` comparison on `AutopartSalesDocument.documentDate`
- Inclusive `[from, to]`
- Bounded periods exclude undated documents
- Filter transactions **before** aggregation

Presets: This month, Last month, Last 30 days, Last 3 months, Last 6 months, YTD, Last year, Custom.

## Period comparison

- Off (default)
- Previous equivalent period (same length, ending the day before primary `from`)
- Custom comparison `compareFrom` / `compareTo`

Shows primary, comparison, absolute difference, and % change. Base = 0 → `%` is `null` (never Infinity). No evaluative wording.

## Historic SKUs

SKUs present only in Autopart history (`NOT_IN_AB_CATALOGUE`) remain searchable and appear in breakdowns. Catalogue match is optional enrichment (name, brand, category, availability).

## CSV export

Internal only. Server-generated for the current enquiry breakdown (customer→products or product→customers). Not Autopart order export.

## Indexes

Added `AutopartSalesLine(sku, companyId)` for product-first enquiry across companies. Existing `(companyId, documentDate)` on documents and `(companyId, sku)` on lines remain for customer-first paths.

## Future phases (do not implement here)

1. Gap Analysis (products a customer should buy / stopped buying)
2. Rebate Analysis (thresholds/schemes on top of Net Sales)
3. Salesperson performance
4. Management dashboards / Sales-i style analysis
