# Sales Intelligence

Internal staff module for factual Autopart historic sales enquiry, period gap comparison, explainable range opportunities, and trusted rebate / net-spend analysis.

**Phase 1 ships:** Sales Enquiry (Customers + Products).

**Phase 2 ships:** Gap Analysis — factual period comparison (Customers + Products).

**Phase 3 ships:** Range Opportunities — current catalogue products a customer has not purchased, supported by comparable-customer evidence (not AI).

**Phase 4 ships:** Rebate / Net Spend Analysis — auditable customer and multi-customer historic net spend for rebate checking (no schemes yet).

**Phase 5 ships:** Sales Actions / Follow-Ups — human-initiated CRM Task creation from Sales Intelligence evidence (no automatic CRM actions).

**Not yet built:** Cross-sell UI, AI recommendations, forecasting, churn scoring, salesperson scoring, rebate schemes / percentages / accruals, management dashboards, follow-up conversion analytics.

## Route & navigation

| Surface | Route |
|---------|--------|
| Sales Enquiry | `/sales/sales-intelligence` |
| Gap Analysis | `/sales/sales-intelligence/gaps` |
| Range Opportunities | `/sales/sales-intelligence/opportunities` |
| Rebate Analysis | `/sales/sales-intelligence/rebates` |
| CRM Tasks (incl. SI follow-ups) | `/crm/tasks` |

Nav section: **Sales Intelligence → Sales Enquiry | Gap Analysis | Range Opportunities | Rebate Analysis**

CRM remains separate. Do not move the Sales Enquiry route unnecessarily.

### Customer Groups

Sales Enquiry customer search can return **Customer Groups** (kind `GROUP`) alongside companies.

Selecting a group loads consolidated Autopart realised sales across member companies (same NET / EX VAT lines, credits negative, no Company+MAM double counting). Drill into a company for the normal company enquiry, or open the Customer Group workspace for MAM / document / product-line drill-down.

Customer Groups are an Automotive Brands reporting layer — they are **not** Autopart account hierarchy and do not change CompanyUser access.

URL-backed state examples:

- Enquiry: `?mode=customers&companyId=…&period=LAST_30`
- Enquiry: `?mode=customers&customerGroupId=…&period=LAST_30`
- Enquiry: `?mode=products&sku=…&period=CUSTOM&from=2026-01-01&to=2026-09-29&compare=PREVIOUS`
- Gaps: `?mode=customers&companyId=…&period=LAST_30&compare=PREVIOUS_YEAR&status=ALL_CHANGES&sort=NET_DECREASE`
- Gaps: `?mode=products&sku=…&compare=CUSTOM&compareFrom=…&compareTo=…&salesRepId=…`
- Opportunities: `?companyId=…&period=LAST_365&sort=RANGE_MATCH`
- Rebates: `?companyId=…&period=ALL`
- Rebates: `?companyId=…&period=CUSTOM&from=2026-01-01&to=2026-06-30&tab=documents`
- Rebates multi: `?mode=multi&period=THIS_QUARTER&sort=NET_DESC`

## RBAC

Permission: `sales_intelligence.view` (shared by Enquiry, Gap Analysis, Range Opportunities, and Rebate Analysis).

Granted to:

- Super Admin
- Management
- Sales Manager
- Sales Representative
- Accounts

Not granted to Marketing, Customer Service (by default), or any trade portal role.

Enforced server-side on every search, enquiry, gap analysis, opportunity analysis, rebate analysis, and CSV export. Trade sessions receive 403 even with a direct URL or API call.

Company scope (single resolver used by Enquiry, Gap Analysis, Range Opportunities, and Rebate Analysis):

- `sales.view_all_accounts` / `admin.access` → all companies
- own/team sales keys → assigned companies
- Accounts (permission without sales scope) → all companies for enquiry/gap/opportunities/rebates

Product gap results and multi-customer rebate aggregates only include customers the actor is authorized to analyse (same scope). Manipulated URL company/SKU IDs do not bypass scope.

## Source of truth

| Source | Role |
|--------|------|
| **561L + SLRB** → `AutopartSalesDocument` / `AutopartSalesLine` | Authoritative invoiced sales & credits |
| Purchase History period semantics | Shared Europe/London date-only filtering |
| **AB Orders** | Excluded from Invoice/Credits/Net Sales |
| **504C** | Excluded (despatch feedback, not line-level history) |
| **231PO3NEW cost** | Not used in Gap Analysis ranking, Range Opportunities, or Rebate / Net Spend |

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
| **Net Spend** | Same calculation as Net Sales; preferred label on Rebate Analysis |
| **Units** | Signed net units in period |
| **Invoice Units** | Units on invoice lines only (gap volume / presence helper) |
| **Purchase Transactions** | Distinct `INVOICE` document references (credits never count) |
| **Invoice Documents** | Same as Purchase Transactions (Rebate Analysis wording) |
| **Credit Documents** | Distinct `CREDIT` document references in period |
| **Products Purchased** | Distinct SKUs with qualifying lines (customer enquiry) |
| **Customers** | Distinct companies with qualifying lines (product enquiry / multi-customer rebate) |

Rebate-ready helpers:

```ts
getCustomerNetSales(actorUserId, companyId, from, to)
getCustomerNetSpend(actorUserId, companyId, from, to)
getCustomerRebateAnalysis(actorUserId, raw)
getMultiCustomerRebateAnalysis(actorUserId, raw)
```

Money uses scaled-integer `Money` (`MONEY_SCALE` 4). UI/CSV present to 2 decimal places via `moneyMinorToDto`; internal aggregation never uses IEEE floats.

## Date semantics

Shared via `src/domain/sales-history-period.ts`:

- Europe/London civil calendar for “today”
- Date-only `YYYY-MM-DD` comparison on `AutopartSalesDocument.documentDate`
- Inclusive `[from, to]`
- Bounded periods exclude undated documents (do not substitute `createdAt` / import timestamps)
- Filter transactions **before** aggregation
- Credits belong to the period of their document date (not backdated to an original invoice)

Enquiry presets: This month, Last month, Last 30 days, Last 3 months, Last 6 months, YTD, Last year, Custom.

Rebate Analysis adds:

- **All history** (`ALL`) — all **dated** imported invoice/credit history (same query semantics as the former blank Custom sentinel window; undated documents remain excluded). Public UI/CSV/URL never show `0001-01-01` / `9999-12-31`.
- **This quarter** / **Previous quarter** — calendar quarters Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec (not financial-year quarters)
- **Last 12 months** (`LAST_365`)
- **Custom** — requires both FROM and TO (`from <= to`); incomplete blank Custom URLs resolve to All history for backwards compatibility

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

Server computes SKU co-purchase counts among the comparable cohort (`computeSkuCoPurchase`) for a future Cross-sell UI. **No Cross Sell UI** in Phase 3/4.

### CSV

Server-generated, RBAC-protected, full filtered set. Columns: customer, account, analysis bounds, SKU/product/brand/category, range match, comparable customers, buyers, adoption %, units, availability. No comparable identities.

## Rebate / Net Spend Analysis (Phase 4)

Purpose: answer “what was this customer’s historic net spend between two dates?” with an auditable document/line trail for Sales/Accounts rebate checking.

### What Phase 4 is / is not

| Ships | Does **not** ship |
|-------|-------------------|
| Trusted TOTAL / HISTORIC NET SPEND | Rebate schemes, % rates, thresholds |
| Invoice / credit document drilldown | Accruals, payments, forecasts |
| Product / brand / category breakdown | Customer-facing rebate balances |
| Multi-customer cohort report | “2% rebate = £X” calculations |
| CSV + browser print report | Qualifying-spend exclusions (architecture only) |

Disclaimer shown in UI:

> Net spend includes all imported invoice and credit activity in the selected period. Rebate eligibility rules are not applied.

### Definitions (must match Sales Enquiry)

For the same customer + period:

| Rebate Analysis | Sales Enquiry |
|-----------------|---------------|
| Invoice Sales | Invoice Sales |
| Credits | Credits |
| **Net Spend** | **Net Sales** |
| Units | Units |
| Invoice Documents | Purchase Transactions |

`NET SPEND = Invoice Sales + signed Credits` (never clamped to zero).

Document totals are summed from imported `AutopartSalesLine.salesNet` values (same source as the headline). Brand/category rollups include **Unassigned** for historic SKUs without catalogue mapping — nothing is discarded financially.

### Modes

- **Customer** — select one company; summary, documents, products, brands, categories; optional comparison
- **Multi-Customer** — authorized cohort for the period; salesperson / search / min–max net spend filters; drillthrough preserves period into Customer mode

Headline summary always reflects the full selected customer/period (or full filtered authorized cohort in multi). Detail filters may show a separate **Filtered net spend**; they do not silently rewrite the headline.

### Eligibility extension point

`applyRebateEligibilityRules(lines, rules)` in `src/domain/sales-rebate.ts` is currently identity. Future Rebate Schemes may filter by brand/category/SKU/date before summing **Qualifying Net Spend**, without rewriting the historic-sales engine. Phase 4 does not display a fake qualifying figure.

### CSV / print

Customer: Export summary, documents, product breakdown (server-generated, full sets).

Multi-customer: full filtered authorized table (not page-only).

Print: browser print CSS with organisation, customer, account, period, generated timestamp, and spend summary.

## Sales Actions / Follow-Ups

Purpose: let a salesperson create a CRM follow-up **from evidence they are looking at** in Sales Intelligence, without retyping customer/product/period facts.

### Human-initiated only

Sales Intelligence provides evidence. The salesperson decides whether to act.

**Never automatic:**

- No auto-created Tasks, Leads, or Opportunities
- No customer emails
- No “at risk” assignment
- No inferred sale probability or expected revenue

Every CRM action requires an explicit staff click on **Create follow-up**.

### Supported SI sources

| Source module | Typical reason | Where the action appears |
|---------------|----------------|--------------------------|
| `GAP_ANALYSIS` | `STOPPED` / `DECREASED` / `INCREASED` / `NEW` | Changed customer/product rows (not status-count cards) |
| `RANGE_OPPORTUNITY` | `RANGE_GAP` | Candidate product rows (only when a real candidate exists) |
| `SALES_ENQUIRY` | `CUSTOMER` / `PRODUCT` | Customer context and product rows |
| `REBATE_ANALYSIS` | `NET_SPEND_REVIEW` | Customer header only (not every invoice/credit line) |

Gap status cards remain filters only.

### Task reuse

Follow-ups reuse the existing CRM **`Task`** model (status `OPEN` / `IN_PROGRESS` / `DONE` / `CANCELLED`, priority `LOW` / `NORMAL` / `HIGH`).

Additive fields only:

- `sourceModule`, `sourceReason`, `sourceSku`, `productId`, `sourceContext` (JSON snapshot)

No `SalesIntelligenceTask` / parallel task store.

### Source snapshot semantics

`sourceContext` is a **concise snapshot of what the salesperson saw at creation time**:

- source module + reason
- company (+ Autopart account when useful)
- product id (if catalogue), SKU, name, brand, category
- selected / comparison periods
- factual metrics (qty, net sales, adoption labels, etc.)
- deep-link path back into SI
- `capturedAt`

Server rebuilds authoritative Gap / Range / Enquiry / Rebate evidence before write. Client-supplied money/qty/classification values are not trusted.

If live SI later changes (new invoice arrives), the Task snapshot stays unchanged. **View Sales Intelligence** opens the current live analysis for the same customer/SKU/periods.

Do not dump full 561L/SLRB histories, gap result sets, or comparable customer identities into the snapshot.

### Assignee rules

Default assignee = authoritative Company → CompanyAssignment → SalesRep → User when present and assignable.

If none: current authenticated staff user (valid task owner).

No arbitrary fallback to a named person. Non-managers may only assign to the company sales rep or themselves (existing CRM scope). Managers keep broader assign rights via existing permissions.

### Due date & priority

Due date: salesperson chooses (`Today` / `Tomorrow` / `In 3 days` / `In 1 week` / `Custom`). Europe/London date-only semantics. No invented business deadline.

Priority: existing Task priority; default `NORMAL`. Never inferred from Stopped / adoption / spend.

Subject: editable default such as `Follow up — Catalytic Converter Cleaner` or `Range opportunity — Brake Cleaner 500ml`.

### Duplicate warning

Before create, open tasks (`OPEN` / `IN_PROGRESS`) matching same company + source module + reason + SKU (when product-context) surface:

> An open follow-up already exists…

Options: **View existing** or **Create another** (explicit `allowDuplicate`). Completed/cancelled tasks do not block.

### Deep links & CRM display

- Task detail shows structured source context (not raw JSON) + optional salesperson notes
- **View Sales Intelligence** uses the stored deep-link path
- **View task** opens `/crm/tasks?taskId=…`
- CRM Tasks list shows a subtle Sales Intelligence source badge and optional source filter
- Company activity timeline records `FOLLOW_UP` “Sales follow-up created” when the bridge creates the task (Task create itself does not auto-write activities elsewhere)

### Security

Requires `sales_intelligence.view` **and** (`tasks.manage` or `crm.activities.create`). Trade users denied. Company must be in the actor’s SI scope. Assignees validated. Gap/Range rows must exist for the requested periods/SKU; mismatched classification is rejected.

Accounts may view SI but cannot create follow-ups unless CRM task permissions are granted (they are not, by default).

### Explicit non-goals

- No automatic Lead / Opportunity creation
- No customer contact / outbound email from this bridge
- No follow-up conversion % / revenue attribution reporting yet
- No CRM redesign; existing Task lifecycle for completion

### Current limitations

- Assignee picker is intentionally small (default + self) rather than a full staff directory
- Rebate follow-up is customer-level Net Spend Review only — no rebate eligibility claim
- Historic-only Gap SKUs may have null `productId` (SKU + description still snapshotted; catalogue products are never auto-created)

## Indexes

`AutopartSalesLine(sku, companyId)` for product-first enquiry across companies. Existing `(companyId, documentDate)` on documents and `(companyId, sku)` on lines remain for customer-first / rebate paths. **No new indexes** for Range Opportunities or Rebate Analysis (set-based period loads + in-process aggregation).

Task follow-up indexes: `(companyId, sourceModule, sourceReason, sourceSku, status)`, `(sourceModule, status)`, `(productId)`.

## Architecture

| Layer | Role |
|-------|------|
| `src/domain/sales-history-period.ts` | Date presets, quarters, previous equivalent, same-period-previous-year |
| `src/domain/sales-intelligence.ts` | Money totals, line aggregation, enquiry URL helpers |
| `src/domain/sales-gap.ts` | Gap classification, URL state, period resolution |
| `src/domain/sales-opportunity.ts` | Similarity, adoption, range match, opportunity URL/config |
| `src/domain/sales-rebate.ts` | Rebate URL state, eligibility stub, document-count helpers |
| `src/domain/sales-followup.ts` | Follow-up subjects, due presets, snapshot helpers |
| `src/server/sales-intelligence/historic-lines.ts` | Shared DB loaders + summarizers |
| `src/server/sales-intelligence/scope.ts` | Shared company scope |
| `src/server/sales-intelligence/enquiry.ts` | Sales Enquiry service |
| `src/server/sales-intelligence/gap.ts` | Gap Analysis service + CSV |
| `src/server/sales-intelligence/opportunity.ts` | Range Opportunities service + CSV |
| `src/server/sales-intelligence/rebate.ts` | Rebate / Net Spend service + CSV |
| `src/server/sales-intelligence/followup.ts` | SI → CRM Task preview/create + CRM task list/detail/complete |
| `src/components/sales-intelligence/create-followup-drawer.tsx` | Shared Create Follow-up drawer |

Query approach: one scoped historic-line load for the selected period, then in-process document/SKU/brand/category (or multi-customer) aggregation — not one query per customer/document/SKU.

## Future phases (do not implement here)

1. Cross-sell UI (co-purchase foundation already computed server-side)
2. **Rebate Schemes** — date range, customer/group, brand/category/SKU inclusion/exclusion, spend thresholds, tier/fixed percentages, accruals/payments (on top of trusted Net Spend)
3. Salesperson performance
4. Management dashboards / Sales-i style analysis
5. Follow-up conversion / attribution analytics (only after the workflow is proven useful)
