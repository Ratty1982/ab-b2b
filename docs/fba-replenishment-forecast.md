# Amazon FBA UK replenishment forecast

Architecture audit and the first safe phase. This does not change financial invoice ownership, customer cutover, the 561L/SLRB history, or the 504/TRM21QC polling schedule.

## What the current system can already support

| Need                      | Source today                                                                          | Reliable for a shipment quantity?                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| FBA UK on-hand            | OPTIMUS branch via manual 231PO3NEW, stored on `AutopartLocationStock` location `FBA` | Yes, only while that SKU's own `sourceImportedAt` is under 14 days old. A later partial file does not refresh SKUs it omits.       |
| Studley warehouse         | `AutopartProduct.availQty` when `presentInLatestFeed`                                 | Yes, as a separate balance. It is not added to FBA.                                                                                |
| RETAILA OIN customer sales | `AutopartSalesDocument` / `AutopartSalesLine` for account RETAILA, windowed         | Visible as customer sales. Not a shipment quantity: the rows have no marketplace and no Amazon fulfilment channel.                 |
| Amazon consumer sales     | Not in this database                                                                  | No. A declared complete FBA extract is required, and marketplace must be Amazon UK. MFN/FBM and other markets are rejected. Gaps are not inferred from the first and last sale. |
| Confirmed inbound         | No carrier or Amazon inbound feed                                                     | Only a staff status of `CONFIRMED_IN_TRANSIT`. An OIN invoice is not in transit.                                                   |

`OIN02573006 Oct 26` in a day-end 504 file is document `OIN025730` plus date `06 Oct 26`. The document column is 9 characters. Matching uses that parsed document number, equal to the TRM21QC document.

## OIN documents and customer eligibility

Ongoing 504/TRM writes go through `assessOngoingSalesWrite`. A header and its lines are stored on `AutopartSalesDocument` only when the Autopart account is an Active company, the account is uniquely verified, and sales cutover is complete. Otherwise the outcome is `UNMAPPED_CUSTOMER`, `NOT_ACTIVE`, or `HISTORY_CUTOVER_INCOMPLETE`, and nothing is persisted.

An Amazon or internal account that is not an Active B2B customer therefore leaves no OIN row to reconstruct. Changing cutover or financial ownership to capture those movements is out of scope. The FBA ledger remains for older manual uploads. It does not hook the poller.

RETAILA OIN history is read from `AutopartSalesDocument` and `AutopartSalesLine`, and only for a selected document-date window. The overview reconciles the last 365 days once, then sums 7, 30, 60, 90 and 365 days inside that result. The same grouped rows record whether the SKU has a counted positive invoice in the last 30, 90 and 365 days. A credit does not erase that flag, and a credit with no invoice does not set it. The overview opens on products sold in the last 365 days. The 90-day and 30-day choices use those flags. All products shows the stock catalogue, including products with no sales. The choice is the `sold` search parameter; a URL without it means 365 days. Summary counts use the same set. Forecast Unavailable means a shipment cannot be calculated, usually because there is no covered Amazon UK FBA extract. It is not a count of bad product records. If the RETAILA read fails, a sold view says sales data is unavailable and does not present an empty table as zero sales. All products stays available, and an export of a sold view is refused until the read succeeds. OIN History can show 30, 90, 180 or 365 days and loads only when that tab is opened. The date and the RETAILA account (or a verified RETAILA company) are applied before reconciliation, so other customers' historic sales are not scanned. Both 561L and TRM21QC copies of an invoice inside that window are still reconciled, including a copy whose company link is null. A verified RETAILA company on the document is the owner for every proven copy. Two verified RETAILA owners, or a `RETAILA` code stored on a different verified customer and no RETAILA owner, are left for review and are not counted. Lines that belong to a different verified customer are not added to a RETAILA invoice. When both sources agree, the ongoing copy is kept; when they disagree, or the 504 goods value does not match, neither copy is added to the sales total. Credits use a negative quantity, including a credit whose stored units are already negative. A manual ledger document is added only when its customer account is `RETAILA` or a verified RETAILA alias, its date is inside the window, and that reference is not already a RETAILA sales document. A blank ledger account is shown for review and is not counted. Another customer's ledger row stays in the ledger for audit and is not counted as RETAILA. A line with no document date is left out of the window totals. A SKU with no counted invoice is blank, not zero. FBA and Studley balances stay current snapshots and are not limited to the invoice window.

## Demand source

An OIN invoice is a sale to the customer account on the document. It is not a replenishment shipment into Amazon and it is not confirmed inbound stock.

It is also not proven Amazon UK FBA sell-through. `AutopartSalesDocument` and `AutopartSalesLine` have no marketplace column and no Amazon fulfilment channel. `fulfilmentStatus` is Autopart order matching (`WAITING_FOR_504`, `FULFILMENT_APPLIED`, and the other document states). The account code `RETAILA` does not supply that proof.

The page exposes two explicit modes (`plan` search parameter; omitted means verified FBA):

1. **Verified FBA forecast** — the latest Amazon sales extract, only when it declares marketplace `AMAZON_UK`, fulfilment `FBA`, and complete coverage for the last 30 days. A SKU missing from that complete extract is zero for the covered window. Without that extract, no shipment is suggested. Verified RETAILA quantities stay visible, with weekly sales `net 30 / 30 × 7`. Dividing FBA stock by that weekly rate is an unverified illustrative comparison. It is not Amazon FBA cover and it is not used for a shipment.
2. **RETAILA sales-based planning** — an explicitly labelled planning proxy. A Super Admin must record a business justification in Settings before recommendations unlock. Approval is **global for all eligible RETAILA SKUs** (`ALL_ELIGIBLE_RETAILA_SKUS`); free text does not restrict products. Approve/disable and the audit row commit in one Prisma transaction via `recordAuditEventInTransaction`. Outputs are planning estimates, never claimed as verified Amazon UK FBA sell-through. Until approved, sales and illustrative cover stay visible and actionable shipment recommendations stay locked (`PLANNING_NOT_APPROVED`).

Planning also requires verified Autopart **504 + TRM21QC** import coverage for Autopart working days in the last 30 days (excluding today). Invoice document dates alone do not prove feed completeness. Incomplete or stale reporting blocks recommendations with `RETAILA_REPORTING_INCOMPLETE` while historical sales stay visible. When coverage is verified, a SKU with no RETAILA invoices is treated as zero planning demand.

Unavailable forecasts use actionable blockers such as `DEMAND_SOURCE_UNVERIFIED`, `PLANNING_NOT_APPROVED`, `RETAILA_REPORTING_INCOMPLETE`, `RETAILA_SALES_UNKNOWN`, `MISSING_FBA_STOCK`, `STALE_FBA_STOCK`, and `SETTINGS_INCOMPLETE`. Products with RETAILA sales are not classified as missing sales when the blocker is a missing Amazon extract.

### Diagnosis of “Forecast Unavailable” with RETAILA sales present

When staff see a large Unavailable count (for example ~39 SKUs with RETAILA history and no covered Amazon UK extract), the dominant blocker is almost always **demand source not verified**, not missing customer sales. Separate counts are returned in `summary.blockers`. Stale or missing OPTIMUS FBA snapshots, incomplete RETAILA coverage for a SKU, and unapproved RETAILA planning are counted separately. Do not treat the Unavailable total as a sales-data failure.

RETAILA units are never added to Amazon units, and the page never combines the two sources for overlapping days. `RETAILA_OIN_PROVEN_AS_FBA_UK` stays false until a stored marketplace and fulfilment channel exist.

Migration `20261028220000_fba_retaila_planning_approval` stores the Super Admin approval fields on `FbaForecastSettings`.

The RETAILA read runs in its own transaction with `statement_timeout` of 8 seconds, set locally so the pooled connection is not left restricted. If that read fails or times out, the forecast still returns FBA and Studley stock. The page shows the error and a Retry button instead of waiting forever. OIN History and a product's invoices load only when that tab or product is opened.

Migration `20261028013000_fba_retaila_oin_window_indexes` adds partial indexes for those windowed reads. It is not applied to production by this change.

If the report has to be stopped without reverting the portal, set `FBA_FORECAST_DISABLED=1` (also `true`, `yes`, or `on`) and restart the app. Overview, OIN History, product invoices, and the CSV export then return before any forecast or RETAILA sales query. `/admin` and the other routes stay up. Unset the variable and restart to turn reporting back on. Do not roll the application back to `5c784da` (PR #62): that is the unbounded query. GitHub has no deployment record for this app. On 28 October 2026 (Europe/London) `https://b2b.automotivebrands.co.uk/api/build` reported `5c784da2eae0151b814cffa49e11144276ba767b`. The first parent of that merge is `ade3a97721cf35d0fe9b694daa012227ae27760f` (PR #61), and that SHA was not confirmed here as a successful Coolify deployment, so it is not a rollback target. Leave the database and any valid indexes in place.

Historical 561L/SLRB lines stay customer sales history. They are not retargeted as Amazon sell-through. If an OIN reference is already on `AutopartSalesDocument`, the workspace counts that overlap and leaves the financial row in place.

## Purchasing demand

`src/server/purchasing/demand.ts` and the purchasing sales-trend queries sum `AutopartSalesLine` where `source = ONGOING_TRM21QC`. If the Amazon account is later mapped and cut over, those OIN lines would enter that table and inflate B2B demand. Both query sets now exclude `UPPER(documentReference) LIKE 'OIN%'`. Existing sales rows are not deleted or rewritten. Sales Intelligence is unchanged.

## AlphaOps

This repository does not integrate with AlphaOps, and this phase does not add a connection, shared database, or copy of Amazon credentials. There is no Amazon order, return, or marketplace feed here. The 231PO3NEW usage columns are not interpreted as sell-through.

The alternative is a manual Amazon UK CSV. The first rows declare `coverage_from`, `coverage_to`, `extracted_on` and `fulfilment_scope` of FBA or AFN, plus optional `complete`, `zeros_omitted` and `marketplace_scope`. SKU rows then need `sku`, `date`, `units_sold` and `fulfilment_channel` of AFN or FBA. `units_credited` is optional. Coverage is the declared range, not the earliest and latest sale date.

UK scope is explicit. Every row must say `AMAZON_UK` (or `Amazon.co.uk`), or the metadata must say `marketplace_scope` of `AMAZON_UK`. A file with no marketplace column and no UK scope is rejected. A blank cell is not filled in as UK. `AMAZON_DE` and any other market reject the file, so those units are not stored. A normalized extract that declares `marketplace_scope=AMAZON_UK` but has no marketplace column is stored only when the operator attests that every row is Amazon UK.

An MFN, FBM or blank channel rejects the whole file, so those units are not stored. A file with no channel column is a normalized FBA-only extract and is stored only when the operator attests that every row is Amazon FBA. That attestation is not an Amazon API check.

A checkbox does not make an extract complete. Completeness requires the file to say `complete=yes`, the operator to attest both FBA-only scope and completeness, and either a row on every declared day or `zeros_omitted=yes`. A sparse file whose only sales are the range endpoints stays incomplete, and the forecast stays Insufficient Data. The latest import is the current extract. Imports are not summed. A SKU absent from a complete extract counts as zero for a covered window.

## Forecast

Demand is the 30-day net from the active mode’s selected source (sold minus credited), and only when that source covers the window. Weekly rate = `max(0, net 30) × 7/30`. Returns above sales become zero demand, not a negative shipment. In verified FBA mode, RETAILA customer sales use the same weekly display for context and do not feed the rate. In approved RETAILA planning mode, that weekly rate is the planning proxy and every suggested quantity is labelled a planning estimate.

Projected required stock = demand during lead time + target weeks of cover after arrival + safety stock.

Suggested send = `max(0, required − FBA available − confirmed inbound)`, rounded up to the case multiple.

Studley shortfall = `max(0, suggested − Studley)`, the units still to buy. Dispatchable is the minimum of suggested and Studley, then rounded down to a complete case. Studley of 7 against a case of 12 dispatches 0, and the 7 stay as loose stock that is not a shipment. Studley of 7 against a case of 4 dispatches 4, leaves 3 loose, and the buy shortfall is still the 5 units needed to reach the suggested quantity. Unknown Studley (not on the current warehouse feed) leaves dispatchable blank. The shortfall is a purchasing requirement, not a suggested dispatch of stock that is not there.

Recommendations: Send Now, Send Soon, Healthy, Overstocked, Insufficient Data. Missing sales, missing FBA stock, or a stale OPTIMUS snapshot is Insufficient Data and the suggested quantity is blank. Confidence is Medium when 30-day sales and fresh FBA stock both exist, otherwise None. The 7-, 90- and 365-day figures are comparisons only.

Nothing on this page creates an order, deducts stock, or publishes a shipment.

## Data & Imports workspace

Amazon FBA → **Data & Imports** is the central place to upload OPTIMUS / 231PO3NEW FBA UK stock (`FbaStockImportPanel` via `previewFbaStockImportFn` / `importFbaStockFn` / `listFbaStockImportsFn`), import the Amazon UK sales CSV, record confirmed inbound, and review source freshness. Stock Forecast keeps a read-only FBA/Studley view and links here for uploads. A successful FBA stock import refreshes the Overview and freshness figures. Autopart 231PO3NEW calculations and Studley processing are unchanged.

## Ledger and safety

Tables: `FbaReplenishmentImport`, `FbaReplenishmentDocument`, `FbaReplenishmentLine`, `FbaAmazonSalesImport`, `FbaAmazonSalesLine`, `FbaInboundShipment`, `FbaForecastSettings`, `FbaSkuForecastOverride`.

The same 504+TRM byte pair hashes once and is rejected as a duplicate. Documents upsert on `(documentReference, documentType)`. The line key is the TRM fingerprint, which changes when quantity or price changes. A revised file supersedes the previous active line for that SKU and keeps the old row with `supersededAt` for audit. Cadence sums only active lines. A SKU that is not in the revised file is left as it was. Two different fingerprints for the same SKU in one file are ambiguous: that SKU is not changed. The replacement runs in one serializable transaction.

Exceptions kept with the import: duplicate OIN header, orphan TRM line, header with no product lines, credit correction, TRM net versus 504 goods beyond £0.01, and a duplicate line fingerprint.

Permissions `purchasing.fba_forecast.view` and `purchasing.fba_forecast.manage` are implied by the purchasing and stock-forecast permissions. Imports and setting changes are audited. File hashes are not written into audit metadata.

Migrations `20261027190000_fba_replenishment_forecast`, `20261027223000_fba_forecast_provenance` and `20261027235000_fba_marketplace_scope` are in the repository. They are not applied to production by this change.

## Later, not in this phase

- A side capture during the existing 504/TRM import that writes OIN rows to this ledger without changing eligibility, financial writes, or the 13:15 / 18:15 Europe/London schedule.
- A read-only Amazon or AlphaOps sell-through API, only if a sanctioned credential path exists. Manual CSV remains the fallback.
- Confidence High once a supported 90-day window is an explicit input to the recommendation.
