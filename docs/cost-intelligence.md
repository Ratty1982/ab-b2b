# Cost Intelligence

Internal catalogue workspace for Autopart **Latest Cost** movements from **231PO3NEW**.

Route: `/admin/cost-intelligence`  
Navigation: **Catalogue → Cost Intelligence**  
Permission: `products.cost.view` (or `admin.access`). Trade actors are always denied.

## Purpose

Answer operational questions:

- Which products changed cost?
- Which costs increased / decreased, by how much, and when?
- Which products moved repeatedly?
- Which products have no valid cost observation?
- Which significant movements may warrant a **human** pricing review?

This is **read-only commercial/product intelligence**. It is not automatic repricing, margin accounting, a customer feature, a replacement for Autopart, or a new stock importer.

## Source

- Report: Autopart **231PO3NEW**
- Field: **Latest Cost**
- Ingestion: the **existing** Automotive Brands stock poller / `applyStockFeed` path
- Models: `AutopartProductCostPosition` (current) + `AutopartProductCostSnapshot` (distinct daily history)

**Avail** remains authoritative sellable stock. Cost processing must not alter Inventory, reservations, or availability.

There is **no** separate Cost Poller / Cost Scheduler.

## Internal only

- Cost data is never shown to trade customers.
- Cost never automatically changes sell prices (`ProductVariant.tradePrice`, RRP, price lists, customer prices, quantity breaks, promotions).
- Server enforcement is mandatory on workspace queries and CSV export — hiding navigation is not enough.

## Semantics

| Term | Meaning |
| --- | --- |
| **Latest Cost** | Most recently observed valid Latest Cost from 231PO3NEW |
| **Previous Cost** | Previous **distinct** observed valid cost (not “last poll if unchanged”) |
| **Last Observed / Updated** | When AB most recently successfully observed the SKU/cost |
| **Last Changed** | When the current distinct cost replaced a different previous cost |
| **First Seen** | AB has a cost but no previous distinct value |
| **No Cost Data** | Active catalogue SKU with no valid Autopart Latest Cost observation |

Invalid / blank / malformed Latest Cost is **not** treated as £0 and must not overwrite a known valid cost. Genuine parsed `0.00` is allowed and distinct from missing data.

### Distinct movements

Multiple same-day polls with the same cost update **last observed** only. They do **not** create multiple change events.

Daily snapshots may still store the same Latest Cost on consecutive London business dates (one row per day). Product history APIs/UI **collapse** consecutive identical costs into a single distinct movement with first/last observed dates — a repeated observation is not a cost change.

Example: £3.01 four times → one history point for movement purposes.  
£3.01 → £3.10 → one distinct movement.  
£3.00 → £3.20 → £3.10 → two distinct movements (repeated mover).

### Product workspace accordion

On an individual admin Product → Commercial tab, Cost Intelligence is a **compact accordion** (collapsed by default) showing Latest Cost / Last Change in the summary row. Expanding reveals the full metrics, period controls, chart (only when ≥2 distinct costs), and movement table. The catalogue `/admin/cost-intelligence` workspace is unchanged.

### History limitation

AB only knows cost history from when recording began. A first observation of £3.01 on 29/09/2026 must **not** be described as “unchanged for 12 months”. It means: no earlier AB cost history.

## Workspace filters

- **Period:** 7 days, 30 days, 90 days, 12 months, All, Custom — Europe/London inclusive date-only; DB stores UTC. No sentinel 0001/9999 dates.
- **Movement:** All, Increased, Decreased, First Seen, Unchanged, No Cost Data
- **Magnitude:** Any, ≥1%, ≥5%, ≥10%, Custom (min % and/or min £). Thresholds use **absolute** magnitude; Movement filter sets direction.
- **Brand / Category:** current catalogue relationships (missing relations do not crash the page)
- **Search:** SKU and product name
- **Catalogue scope:** AB catalogue (default), Not in AB catalogue, All observed SKUs
- **Sort:** Latest change (default), largest %/£ increase/decrease, name, SKU, latest cost
- **Views:** All, Recent changes, Biggest increases, Biggest decreases, Repeated movers, Price review — these configure the same query; they do not invent separate calculations
- **URL state:** period, from, to, movement, brand, category, magnitude, search, sort, view, page, pageSize, catalogue
- **Pagination:** 25 / 50 / 100, server-side

## Price Review

Human review queue only. Neutral language: **Price Review** / **Review suggested**.

Default UI threshold: **≥ 5%** absolute cost movement when opening the Price Review view (no hardcoded permanent business setting was found). Cost decreases above threshold also qualify. Requires a genuine movement, catalogue product, and existing base trade price.

Shows Previous / Latest / change alongside **Base Trade** and **RRP** as context only.

Does **not** calculate suggested prices, required increases, or margins.

## Margin

**Not implemented.** Latest Cost cannot truthfully represent historic cost-at-sale for older transactions. Revisit later when cost history is sufficient.

## Product drill-down

Row click opens the existing `AutopartProductCostPanel` (shared product-level Cost Intelligence) in a drawer. Product-level history on the product workspace is preserved.

Chart behaviour: do not draw a flat trend from a single observation.

## CSV export

Permission-protected. Exports the current filtered result set with SKU, Product, Brand, Category, costs, change, movement, first/last observed/changed, Base Trade, RRP, Price Review flag, movements in period.

Viewing/filtering does not write AuditEvents. CSV may follow existing export audit conventions if/when the project adds them; this workspace does not invent noisy audit.

## Unmatched Autopart SKUs

Valid Autopart SKUs absent from the AB catalogue remain informational (**Not in AB catalogue**). Cost Intelligence can optionally show them via catalogue scope; products are never auto-created.

## Related docs

- [Autopart stock sync](./autopart-stock-sync.md) — 231PO3NEW Avail authority, polling, product cost persistence
