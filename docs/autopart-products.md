# Internal Autopart products

Automotive Brands sells products from other manufacturers and suppliers to Retail accounts. Those SKUs can appear in Autopart sales history and live 231PO3NEW stock **without** being Automotive Brands B2B catalogue products.

**Autopart product ≠ B2B catalogue product.** The internal `AutopartProduct` layer holds stock, incoming, latest cost, and intelligence joins. It never auto-creates `Product`, `ProductVariant`, Brand, Category, or public catalogue rows.

## Three product states

| State | Meaning |
| --- | --- |
| **Catalogue product** | Autopart SKU linked to exactly one B2B `ProductVariant`. Inventory (including AB reservations) remains the catalogue stock authority. |
| **External product** | Current Autopart product from 231PO3NEW with stock / incoming / cost / sales intelligence, and **no** B2B listing. Retail accounts can still buy these through Autopart. They stay off public catalogue, trade catalogue, search, basket, ordering, homepage, and category pages. |
| **Historic only** | Sales history exists, but the SKU is not on the current Autopart stock master (`presentInLatestFeed = false` and no catalogue link). |

External products exist so Retail-account sales, stock, and purchasing intelligence stay complete when Automotive Brands does not list the SKU on the B2B website.

## 231PO3NEW

Every valid product row on a live apply upserts `AutopartProduct` (batched). Semantics are unchanged:

- **Avail** → sellable stock (`availQty`)
- **Physical Stk** → `physicalQty` when parseable
- **P/Ord Qty** → Incoming (`incomingQty`). The field after Physical Stk is not Incoming.
- **Latest Cost** → internal latest cost

Duplicate catalogue SKU matches stay `CONFLICT`: Autopart stock is still stored, but `catalogueVariantId` is not set and Inventory is not updated.

Valid external SKUs are **not** written to `StockFeedUnmatched`. That table is no longer the home of thousands of legitimate third-party products. True parse/data conflicts remain on `StockSyncIssue`.

The next successful full 231PO3NEW import populates/refreshes the master. Catalogue SKUs already on Autopart warehouse Inventory are backfilled by migration; external SKUs wait for that import. Stock is never invented from sales.

## Intelligence surfaces

Sales Intelligence, Gap Analysis, Stock Intelligence (`/admin/products/stock` Autopart products tab), Purchasing Forecast, Purchase Planner, and Overstock all resolve by Autopart SKU (`skuMatchKey`, uppercase). Historic and ongoing `AutopartSalesLine` rows join the same key. Financial history is not rewritten.

Internal staff with stock/intelligence permission see exact Avail / Physical / Incoming. Latest Cost stays internal (`products.cost.view` / `purchasing.view`). Trade and public APIs never receive AutopartProduct rows, exact stock, or cost.

Stock freshness is the existing 36-hour / 09:15–18:15 Europe/London policy. Stale stock is labelled **Stock data delayed** / **Incoming delayed**, never shown as trustworthy live figures.

Purchasing reuses the existing forecast, trend, reorder, confidence, and verified-history rules. External SKUs use `AutopartProductPurchasingSettings` / `AutopartPurchasingPlanLine` instead of requiring `VariantPurchasingSettings`. Catalogue SKU settings are unchanged.

Super Admin / catalogue staff may **link** an external Autopart product to an existing ProductVariant. There is no “create catalogue product automatically” action in this phase.
