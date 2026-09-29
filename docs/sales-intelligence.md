# Sales Intelligence

Internal staff module for factual Autopart historic sales enquiry, period gap comparison, and explainable range opportunities.

**Phase 1 ships:** Sales Enquiry (Customers + Products).

**Phase 2 ships:** Gap Analysis — factual period comparison (Customers + Products).

**Phase 3 ships:** Range Opportunities — current catalogue products a customer has not purchased, supported by comparable-customer evidence (not AI).

**Not yet built:** Cross-sell UI, AI recommendations, forecasting, churn scoring, salesperson scoring, Rebate Analysis, management dashboards.

## Route & navigation

| Surface | Route |
|---------|--------|
| Sales Enquiry | `/sales/sales-intelligence` |
| Gap Analysis | `/sales/sales-intelligence/gaps` |
| Range Opportunities | `/sales/sales-intelligence/opportunities` |

Nav section: **Sales Intelligence → Sales Enquiry | Gap Analysis | Range Opportunities**

CRM remains separate. Do not move the Sales Enquiry route unnecessarily.

URL-backed state examples:

- Enquiry: `?mode=customers&companyId=…&period=LAST_30`
- Enquiry: `?mode=products&sku=…&period=CUSTOM&from=2026-01-01&to=2026-09-29&compare=PREVIOUS`
- Gaps: `?mode=customers&companyId=…&period=LAST_30&compare=PREVIOUS_YEAR&status=ALL_CHANGES&sort=NET_DECREASE`
- Gaps: `?mode=products&sku=…&compare=CUSTOM&compareFrom=…&compareTo=…&salesRepId=…`
- Opportunities: `?companyId=…&period=LAST_365&sort=RANGE_MATCH`

## RBAC

Permission: `sales_intelligence.view` (shared by Enquiry, Gap Analysis, and Range Opportunities).

Granted to:

- Super Admin
- Management
- Sales Manager
- Sales Representative
- Accounts

Not granted to Marketing, Customer Service (by default), or any trade portal role.

Enforced server-side on every search, enquiry, gap analysis, opportunity analysis, and CSV export. Trade sessions receive 403 even with a direct URL or API call.

Company scope (single resolver used by Enquiry, Gap Analysis, and Range Opportunities):

- `sales.view_all_accounts` / `admin.access` → all companies
- own/team sales keys → assigned companies
- Accounts (permission without sales scope) → all companies for enquiry/gap/opportunities

Product gap results only include customers the actor is authorized to analyse (same scope). Manipulated URL company/SKU IDs do not bypass scope.

## Source of truth

| Source | Role |
|--------|------|
| **561L + SLRB** → `AutopartSalesDocument` / `AutopartSalesLine` | Authoritative invoiced sales & credits |
| Purchase History period semantics | Shared Europe/London date-only filtering |
| **AB Orders** | Excluded from Invoice/Credits/Net Sales |
| **504C** | Excluded (despatch feedback, not line-level history) |
| **231PO3NEW cost** | Not used in Gap Analysis ranking or margin |

Do not double-count Autopart historic sales and AB native orders.

Provenance note shown in UI:

> Autopart historic sales (561L + SLRB). AB Orders and 504C are not included in these totals.

## Metric definitions

Centralized in `src/domain/sales-intelligence.ts` and shared loaders in `src/server/sales-intelligence/historic-lines.ts`.

Sales Enquiry and Gap Analysis use the **same** loaders and totals so figures reconcile for the same customer/product + period.

| Metric | Definition |
|--------|------------|
| **Invoice Sales** | Sum of `INVOICE` line `salesNet` in the period |
| **Credits** | Sum of `CREDIT` line `salesNet` (signed; typically negative) |
| **Net Sales** | Invoice Sales + Credits (may be negative; never clamped) |
| **Units** | Signed net units in period |
| **Invoice Units** | Units on invoice lines only (gap volume / presence helper) |
| **Purchase Transactions** | Distinct `INVOICE` document references (credits never count) |
| **Products Purchased** | Distinct SKUs with qualifying lines (customer enquiry) |
| **Customers** | Distinct companies with qualifying lines (product enquiry) |

Rebate-ready helper:

```ts
getCustomerNetSales(actorUserId, companyId, from, to)
```

## Date semantics

Shared via `src/domain/sales-history-period.ts`:

- Europe/London civil calendar for “today”
- Date-only `YYYY-MM-DD` comparison on `AutopartSalesDocument.documentDate`
- Inclusive `[from, to]`
- Bounded periods exclude undated documents
- Filter transactions **before** aggregation

Presets: This month, Last month, Last 30 days, Last 3 months, Last 6 months, YTD, Last year, Custom.

## Period comparison (Enquiry)

- Off (default)
- Previous equivalent period (same length, ending the day before primary `from`)
- Same period previous year (calendar shift; leap-day 29 Feb → 28 Feb in non-leap prior year)
- Custom comparison `compareFrom` / `compareTo`

Shows primary, comparison, absolute difference, and % change. Base = 0 → `%` is `null` (never Infinity/NaN). No evaluative wording.

## Gap Analysis purpose

Factual historical comparison between a **Selected Period** and a **Comparison Period**.

Answers (Customers mode):

- Which products did this customer buy previously but not now? (**Stopped buying**)
- Which products are they buying less / more of?
- Which products are continuing unchanged?
- Which products are new in the selected period?

Answers (Products mode):

- Which customers bought this product previously but not now?
- Which customers are buying less / more / continuing / new?

Gap Analysis **does not** invent lost sales, opportunity value, churn scores, or AI recommendations.

### Classification definitions

Presence = **invoice purchase activity** (`invoiceRefs` or `invoiceUnits` ≠ 0). Credits alone never create purchase presence.

| Status | Rule |
|--------|------|
| **STOPPED** | Comparison has invoice presence; selected has none |
| **NEW** | Selected has invoice presence; comparison has none |
| **DECREASED** | Invoice presence in both; selected metric &lt; comparison |
| **INCREASED** | Invoice presence in both; selected metric &gt; comparison |
| **UNCHANGED** | Invoice presence in both; selected metric = comparison |

Default compare-by metric for Increased/Decreased/Unchanged: **invoice units**. Optional compare-by: **Net Sales** (financial movement only — presence still invoice-based).

Credits affect Invoice Sales / Credits / Net Sales / signed units displays. Example: comparison invoice qty 10, selected credit-only −2 → **STOPPED**, with selected net reflecting the credit.

Neither period invoice presence → row omitted (credit-only both sides ignored).

Default status filter **All changes** excludes **Unchanged**. Explicitly select Unchanged to include them. No materiality threshold — all factual changes shown.

### Last purchased

Last actual **INVOICE** purchase date for the SKU/customer pair across the two loaded periods (credits never set last purchased).

### Historic-only SKUs

Historic Autopart SKUs not in the AB catalogue remain in Customer Gap Analysis (critical for Stopped buying). Labelled **Historic only**. Availability does not alter classification. No Buy Again for non-catalogue SKUs; View Enquiry still works.

### Availability (optional enrichment)

Customer gap rows may show In Stock / Low Stock / Out of Stock / Available to Backorder via the central stock helper. Availability never hides or reclassifies a gap.

### Brand / category movement

Customer mode includes compact factual Brand and Category tables: Comparison Net Sales, Selected Net Sales, Change. No forecasting charts required.

### Wording

Use **Net Sales Change** / **Unit Change**. Do **not** call differences Lost Sales, Missed Revenue, or Opportunity Value.

### CSV export

Server-generated, RBAC-protected. Exports the full filtered dataset (not only the current page).

Customer columns include customer/account, both period bounds, status, SKU/product/brand/category, qty and invoice/credits/net for both periods, net change, last purchased.

Product columns include SKU/product, both period bounds, status, customer/account/salesperson, qty and financials, last purchased.

## Range Opportunity methodology

Range Opportunities answer:

> Which **current catalogue** products has this customer **not** invoice-purchased in the analysis lookback, where **comparable customers** (within the actor’s Sales Intelligence scope) provide factual purchasing evidence?

This is **not** AI, forecasting, or “the customer will buy”.

### Analysis period

Presets: Last 3 / 6 / 12 / 24 months, or Custom. Default: **Last 12 months** (`LAST_365`). Europe/London inclusive date-only bounds (shared helpers).

### Customer purchase profile

For the selected customer + analysis period (shared historic loaders):

- Invoice SKU set (credits never create presence)
- Brand / category sets from catalogue enrichment (unknown IDs excluded)
- Invoice Sales, Credits, Net Sales, Units, Purchase Transactions

Profile money/units/transactions **reconcile with Sales Enquiry** for the same customer + period.

### Qualifying active customers (comparable population)

- Limited to the actor’s Sales Intelligence company scope (same resolver as Enquiry/Gap)
- Must have qualifying **INVOICE** purchase activity in the analysis period
- Target customer excluded from their own cohort
- **Privacy:** only aggregate evidence is returned (e.g. “18 of 27 comparable customers”). Other customer names, accounts, and IDs are never exposed in opportunity results/CSV — including when the actor has broad scope

### Similarity formula

Deterministic weighted Jaccard on purchase sets:

| Dimension | Weight | Set |
|-----------|--------|-----|
| Category overlap | 50% | Catalogue category IDs with invoice purchases |
| Brand overlap | 30% | Catalogue brand IDs with invoice purchases |
| SKU overlap | 20% | Uppercase invoice SKUs |

`Jaccard = |A ∩ B| / |A ∪ B|`

- Both sets empty for a dimension → dimension **unused** (not a match); remaining weights renormalized
- One empty → similarity 0 for that dimension
- Unknown/unassigned brand or category never joins a set (so “both unknown” is not a strong match)

Minimum similarity to enter cohort: **0.25** (`RANGE_OPPORTUNITY_CONFIG.minSimilarity`).

Minimum comparable customers after thresholding: **3**. Below this → empty evidence state (no manufactured results).

### Candidate eligibility

A candidate SKU must:

1. Be bought (invoice) by ≥ **2** comparable customers
2. **Never** have invoice purchase by the target customer in the analysis lookback (credits alone do not count as purchase)
3. Exist in the current AB catalogue, active, trade-visible, `ACTIVE`
4. Not be historic-only / discontinued
5. Pass availability filter (default **Orderable** = In Stock / Low Stock / Available to Backorder / Partial). Out of Stock with backorders denied is excluded by default
6. Have a range relationship by default (Same Brand+Category / Same Category / Same Brand). Broader range is excluded unless explicitly included

### Range match

| Label | Meaning |
|-------|---------|
| Same brand + category | Target already buys that brand and category |
| Same category | Target buys the category |
| Same brand | Target buys the brand |
| Broader range | No brand/category overlap (optional filter) |

### Observed adoption

```
Adoption = comparable customers who invoice-purchased candidate
         / eligible comparable customers
```

Display as buyers/cohort and percent. Credits do not create adoption. Not called probability/likelihood.

### Ranking / sorting

Transparent sorts (no mystery score):

1. Strongest range match (default), then adoption, then buyers
2. Highest adoption
3. Most comparable buyers
4. Most comparable units
5. Product A–Z

### Cost / pricing / CRM

- Latest Autopart cost is **not** used for ranking
- No margin/profit/expected revenue
- No automatic CRM lead/task/email creation

### Cross-sell foundation

Server computes SKU co-purchase counts among the comparable cohort (`computeSkuCoPurchase`) for future Phase 4. **No Cross Sell UI** in Phase 3.

### CSV

Server-generated, RBAC-protected, full filtered set. Columns: customer, account, analysis bounds, SKU/product/brand/category, range match, comparable customers, buyers, adoption %, units, availability. No comparable identities.

## Indexes

`AutopartSalesLine(sku, companyId)` for product-first enquiry across companies. Existing `(companyId, documentDate)` on documents and `(companyId, sku)` on lines remain for customer-first paths. **No new indexes** for Range Opportunities (on-demand set aggregation over scoped period lines).

## Architecture

| Layer | Role |
|-------|------|
| `src/domain/sales-history-period.ts` | Date presets, previous equivalent, same-period-previous-year |
| `src/domain/sales-intelligence.ts` | Money totals, line aggregation, enquiry URL helpers |
| `src/domain/sales-gap.ts` | Gap classification, URL state, period resolution |
| `src/domain/sales-opportunity.ts` | Similarity, adoption, range match, opportunity URL/config |
| `src/server/sales-intelligence/historic-lines.ts` | Shared DB loaders + summarizers |
| `src/server/sales-intelligence/scope.ts` | Shared company scope |
| `src/server/sales-intelligence/enquiry.ts` | Sales Enquiry service |
| `src/server/sales-intelligence/gap.ts` | Gap Analysis service + CSV |
| `src/server/sales-intelligence/opportunity.ts` | Range Opportunities service + CSV |

Query approach: one scoped historic-line load for the analysis period, catalogue enrichment, deterministic in-memory similarity + candidate aggregation (not one query per SKU/customer).

## Future phases (do not implement here)

1. Cross-sell UI (co-purchase foundation already computed server-side)
2. Rebate Analysis (thresholds/schemes on top of Net Sales)
3. Salesperson performance
4. Management dashboards / Sales-i style analysis
