# Purchasing Intelligence (Phase 1)

Internal decision-support for Automotive Brands purchasers. It answers what needs ordering now, what is already incoming, how fast SKUs sell, and roughly how much to buy — **without placing orders**.

This module **must not**:

- create Autopart purchase orders
- write purchasing data back to Autopart
- change sell prices, Avail, stock bands, baskets, or reservations
- treat a forecast as a guarantee
- invent an incoming arrival date

The human purchaser remains responsible.

## Routes

| Surface | Path |
| --- | --- |
| Dashboard | `/purchasing` |
| Stock Forecast | `/purchasing/forecast` |
| SKU drill-down | `/purchasing/forecast/$sku` |
| Purchase Planner | `/purchasing/planner` |
| Overstock | `/purchasing/overstock` |

Navigation: **Purchasing** (after Catalogue, before CRM). Trade users never see it.

## RBAC

| Permission | Super Admin | Management | Accounts | Sales | Trade |
| --- | --- | --- | --- | --- | --- |
| `purchasing.view` | yes | yes | yes | no | no |
| `purchasing.manage` | yes | yes | no | no | no |

There is no dedicated Purchaser role in this codebase. Server loaders, mutations and CSV export all call `requirePurchasingAccess` / `purchasing.manage`. Hiding the nav is not security.

Audited actions (not table views/filters): purchasing defaults, SKU purchasing settings, planned qty, purchasing note.

## Data sources

| Question | Source |
| --- | --- |
| Current sellable stock | 231PO3NEW **Avail** → `Inventory.qtyOnHand` for catalogue SKUs; `AutopartProduct.availQty` for external Autopart products |
| Incoming / on order | 231PO3NEW **P/Ord Qty** → `Inventory.incomingQty` (catalogue) or `AutopartProduct.incomingQty` (external). UI: Incoming |
| Demand | `AutopartSalesLine` signed net units via `AutopartSalesDocument.documentDate` (same financial source as Sales Intelligence) |
| Latest Cost | Cost Intelligence `AutopartProductCostPosition` (catalogue) or `AutopartProduct.latestCost` (external) |
| SKU purchasing params | `VariantPurchasingSettings` for catalogue SKUs; `AutopartProductPurchasingSettings` for external Autopart products (null = not configured) |
| System defaults | `PurchasingSettings` singleton |
| Planned qty / note | `PurchasingPlanLine` (catalogue) or `AutopartPurchasingPlanLine` (external) |

**Not used:** B2B `OrderItem` rows. Historic 561L and ongoing 504/TRM already land in `AutopartSalesLine`; they are not double-counted.

## 231PO3NEW Incoming

Incoming is outstanding quantity on purchase orders. The **source field is `P/Ord Qty`**, located by that header label in the fixed-width 231PO3NEW report (tolerates concatenated labels such as `P/Ord QtySub Grp`).

**Do not** take the field after Physical Stk — that is `Ryr` / usage history.

If a 231PO3NEW file has no recognised `P/Ord Qty` column, Incoming is **not** derived from another position. Avail is still imported. Previous `incomingQty` is left unchanged and the run records that Incoming could not be refreshed.

When `P/Ord Qty` **is** present, a successful import **replaces** `incomingQty` for matched SKUs (including `0`), so one full import repairs values previously taken from the wrong column.

| Cell | Behaviour |
| --- | --- |
| Positive integer (including `.0000`) | Persist as incoming qty |
| `0` | Persist 0 |
| Blank | Persist null (displayed as 0 on-order) — clears a previously wrong value |
| Malformed / negative | **Skip Incoming update**; Avail is still applied; diagnostic recorded |

**Avail = 36, P/Ord Qty = 240 → sellable stock is 36, not 276.**

Incoming is never exposed on public/trade catalogue, basket, or order availability APIs.

Phase 1 does **not** invent an ETA. UI copy: `240 on order — arrival date not available`.

## Demand-rate algorithm

Weekly rate for a window:

`weeklyRate = (netUnits / coverageDays) × 7` when `coverageDays ≥ 7`, else unknown.

Coverage days are clipped to actual Autopart sales history. Missing history is **not** treated as zero demand.

**Recommended weekly demand** (deterministic, no ML):

1. Take 30-day rate (weight 50%), 90-day (30%), 365-day (20%).
2. Drop any missing window and **renormalise** remaining weights.
3. If same-period-last-year weekly rate exists with ≥80% coverage, blend: `0.85 × base + 0.15 × lastYear`.
4. Floor at 0 for ordering (raw period nets remain visible, including credits).

The UI lists each rate and its weight. This is **not** last-30-days × 12.

Credits/returns reduce net units (signed). Invoice-presence / last-sale uses `documentType = INVOICE` only.

## Trend

Compares last 30-day net vs previous 30-day net.

- Need ≥7 coverage days on both windows and base volume ≥ 10 units.
- Absolute change must be ≥ 8 units or the trend is **STABLE** (1→2 is not a surge).
- ≥40% → strongly increasing/decreasing; ≥15% → increasing/decreasing.

## Unusual demand

Last 7-day units vs 90-day weekly rate. Flag only if last 7 days ≥ 20 units, at least 15 above the 90-day weekly rate, **and** ≥ 2.5× that rate. The spike does **not** replace recommended demand.

## Weeks of cover

`currentCover = Avail / recommendedWeekly`

Incoming is **not** included.

`projectedCover = (Avail + Incoming) / recommendedWeekly` is labelled separately as including stock not yet received.

If recommended demand is 0 or unknown: do not divide; show **No recent demand**.

## Stockout

`estimatedStockoutDate = today (Europe/London) + Avail / dailyRecommended`

Incoming **never** extends this date because arrival is unknown.

## Lead time / reorder

When `leadTimeDays` is set:

`leadTimeDemand = ceil(recommendedDaily × leadTimeDays)`  
`reorderPoint = leadTimeDemand + safetyStock`

If Avail ≤ reorder point **and** Incoming already covers the target, status is **INCOMING_COVERS_REQUIREMENT** with “arrival date unavailable” — not “order the gap”.

If lead time is not configured, cover thresholds still drive Watch / Critical.

## Suggested purchase

```
targetStock = ceil(recommendedWeekly × targetCoverWeeks) + safetyStock
rawRequirement = max(0, targetStock − Avail − Incoming)
if MOQ set and raw > 0: qty = max(raw, MOQ)
if orderMultiple > 1 and qty > 0: qty = ceil(qty / multiple) × multiple   // round UP
```

Never negative. Missing MOQ / multiple: skip that step. Target cover defaults to the editable system setting (initially 8 weeks). SKU override if set.

Example: target 500, Avail 100, Incoming 240 → raw 160; MOQ 120; multiple 24 → **168**.

## Status rules (deterministic)

| Status | Meaning |
| --- | --- |
| DATA_STALE | Autopart stock older than the existing 36-hour freshness policy |
| INSUFFICIENT_DATA | Not enough sales history for a weekly rate |
| NO_RECENT_DEMAND | Stock on hand, recommended demand 0 |
| CRITICAL | Cover below critical weeks or runout within 7 days, and extra qty still suggested |
| INCOMING_COVERS_REQUIREMENT | Current stock low/critical but Incoming covers the target |
| OVERSTOCK | Current cover ≥ overstock weeks |
| REORDER | Below reorder after Incoming, extra qty suggested |
| WATCH | Cover below watch weeks |
| HEALTHY | Adequate cover |

## Latest Cost

Suggested purchase value, current stock value, and overstock value = qty × Latest Cost.

Missing cost → **—**, never £0, and excluded from monetary totals with a missing-cost count.

Latest Cost is internal only. Purchasing screens are internal-only; public APIs do not include it.

## Purchase Planner

Purchaser can enter **planned order qty** and a **note**. Stored on `PurchasingPlanLine` with actor and timestamp. Not written to Autopart. Incoming is never modified.

CSV is a human worksheet (supplier, SKU, description, product type, demand, suggested/planned qty, Latest Cost, note, forecast confidence, sales-history coverage days, 30/90/365 coverage, seasonal comparison). It is **not** an Autopart purchase-order import.

External Autopart products (Retail third-party SKUs with live 231PO3NEW stock but no B2B ProductVariant) use the same forecast algorithm. See [autopart-products.md](./autopart-products.md).

## Forecast confidence vs stock freshness

These are **different** signals. Do not combine them into one status.

| Signal | Answers | Source |
| --- | --- | --- |
| Stock freshness (`DATA_STALE`) | Is **current 231PO3NEW stock** (Avail / Incoming) up to date? | Existing 36-hour stock freshness policy |
| Forecast confidence | How much **verified continuous Autopart sales history** supports the demand forecast? | Inclusive days from Purchasing setting `verifiedSalesHistoryFrom` through London today |

A SKU can have fresh stock and low forecast confidence, or stale stock and strong historical coverage.

**Low or unverified confidence does not mean the calculation is incorrect. It means complete historic coverage is limited or has not yet been confirmed.**

Confidence is informational. It does **not** multiply recommended demand, change Avail, Incoming, Latest Cost, MOQ, order multiples, lead time, or suggested-order maths. Purchasing statuses (`CRITICAL`, `REORDER`, `OVERSTOCK`, …) stay as they are; confidence is shown beside them.

Historic Autopart invoices outside the verified window remain in the database for Sales Intelligence, customer history, and financial reporting. Purchasing simply must not describe that older data as complete forecast coverage.

### Sales-history coverage

Coverage is a **verified continuous import window**, not “days since this SKU first sold” and not `MIN(AutopartSalesDocument.documentDate)`.

An old invoice proves that invoice exists. It does **not** prove every invoice between that date and today has been imported. Historic 561L/SLRB runs are per-customer file imports (`AutopartCustomerImportRun`) with filename/hash/row counts — they do not record a complete-dataset start date. Ongoing 504/TRM is incremental. Until a purchaser confirms the reliable start, coverage is **unverified**.

1. Super Admin / Management set **Verified sales history from** on Purchasing defaults (`PurchasingSettings.verifiedSalesHistoryFrom`). Null is the default. Never auto-fill from the oldest document.
2. Inclusive day count from that date through Europe/London today is `salesHistoryCoverageDays`.
3. Each 7/30/90/365 demand window is clipped to that verified start for both SQL totals and `coverageDaysForPeriod`. Missing history is **not** treated as zero sales.
4. Clearing verification returns confidence to **Unverified**. Changes are audited (actor, old value, new value, timestamp).

SKU-first-sale is **not** used: that would imply continuous coverage for dates when Autopart history had not been imported.

Human labels: `Coverage not verified`, `74 days verified history`, `8.5 months verified history`, or `365+ days verified history`.

### Confidence thresholds

Centralised in `FORECAST_CONFIDENCE_MIN_DAYS` (`src/domain/purchasing-forecast.ts`). Do not copy magic numbers into UI.

| Inclusive verified coverage | Level |
| --- | --- |
| Not configured | Unverified |
| 0–29 days | Very Low |
| 30–89 days | Low |
| 90–179 days | Building |
| 180–364 days | Good |
| 365+ days | Strong |

Unverified / Very Low / Low recommendations that would otherwise drive Critical, Reorder, Overstock, or a suggested purchase keep the recommendation **visible**, with a warning such as “Sales-history coverage has not yet been verified — review before ordering.” Overstock + limited or unverified confidence is labelled **Potential overstock**.

### Missing history vs genuine zero demand

- **Unverified:** sales records may exist, but Purchasing cannot confirm the start of a complete continuous window. 30/90/365 components show “Coverage not verified”, not Full. Same-period-last-year is not eligible.
- **Missing history:** if a verified window only overlaps 14 days of a 90-day request, the 90-day weekly rate is partial, not “90 days of zero”. Weights are dropped and remaining 30/90/365 weights are renormalised. Same-period-last-year is unused until that comparable window lies inside verified history with ≥80% coverage **and** a weekly rate (≥7 coverage days).
- **Genuine zero:** if the verified window is long enough for a rate (`coverageDays ≥ 7`) and net units are 0, weekly rate is 0. That is evidence of no demand in the available verified history.

`NO_RECENT_DEMAND` copy names the known verified coverage (`No meaningful net demand in 14 days of available sales history`) and never claims “no sales in 90 days” when only 14 verified days exist. When verification is unset, that copy does not invent a coverage length.

### Demand-component eligibility

A period contributes a weekly rate only when its clipped coverage is **≥ 7 days**. Full vs partial is claimed only inside a verified window:

- Unverified: 30/90/365 show “Coverage not verified” whenever a rate can be computed from currently available records; never Full.
- 30-day: full at 30 verified days of coverage; partial from 7–29; unavailable below 7.
- 90-day: full at 90; partial from 7–89; unavailable below 7.
- 365-day: full at 365; partial from 7–364; unavailable below 7.
- Last-year comparison: available only when the comparable window is inside verified history, has a weekly rate, and ≥80% of its requested length.

Insufficient components show “—” / “Insufficient history” on the SKU drill-down. They are not silently treated as zero. Recommended demand uses available periods only; longer windows become eligible automatically as the verified window grows.

### SQL / performance

Demand uses PostgreSQL `GROUP BY sku` over bounded `documentDate` ranges. Forecast list does **not** run a per-SKU sales-history query. Catalogue variants and current external Autopart products are loaded in batches; purchasing math runs in-process on the grouped maps.

Coverage uses the configured verified start, loaded once with Purchasing settings — not `MIN(documentDate)`, and not per SKU. Do not add per-SKU `MIN`/`MAX`/`COUNT` coverage queries.

## Known limitations

- No Incoming ETA in 231PO3NEW — stockout and cover-including-incoming must stay distinct.
- No Supplier ERP; supplier is optional free text per SKU.
- No automatic purchase orders.
- Demand sources (customer mix) on the SKU page is last-90-days grouped SQL, capped at 12 rows.
- Forecast is explainable weighting, not a statistical guarantee.
- During initial Autopart sales import, confidence stays **Unverified** until a purchaser sets **Verified sales history from**. After that it is uniform across SKUs for the verified window length; that is expected, not a per-SKU defect.
