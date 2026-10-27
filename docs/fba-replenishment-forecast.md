# Amazon FBA UK replenishment forecast

Architecture audit and the first safe phase. This does not change financial invoice ownership, customer cutover, the 561L/SLRB history, or the 504/TRM21QC polling schedule.

## What the current system can already support

| Need                      | Source today                                                                          | Reliable for a shipment quantity?                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| FBA UK on-hand            | OPTIMUS branch via manual 231PO3NEW, stored on `AutopartLocationStock` location `FBA` | Yes, only while that SKU's own `sourceImportedAt` is under 14 days old. A later partial file does not refresh SKUs it omits.       |
| Studley warehouse         | `AutopartProduct.availQty` when `presentInLatestFeed`                                 | Yes, as a separate balance. It is not added to FBA.                                                                                |
| OIN replenishment history | 504 headers joined to TRM21QC lines on the parsed document number                     | Only after a paired upload into the FBA ledger. The mailbox poller does not copy them.                                             |
| Amazon consumer sales     | Not in this database                                                                  | No. A declared complete FBA UK extract is required. MFN/FBM rows are rejected. Gaps are not inferred from the first and last sale. |
| Confirmed inbound         | No carrier or Amazon inbound feed                                                     | Only a staff status of `CONFIRMED_IN_TRANSIT`. An OIN invoice is not in transit.                                                   |

`OIN02573006 Oct 26` in a day-end 504 file is document `OIN025730` plus date `06 Oct 26`. The document column is 9 characters. Matching uses that parsed document number, equal to the TRM21QC document.

## OIN documents and customer eligibility

Ongoing 504/TRM writes go through `assessOngoingSalesWrite`. A header and its lines are stored on `AutopartSalesDocument` only when the Autopart account is an Active company, the account is uniquely verified, and sales cutover is complete. Otherwise the outcome is `UNMAPPED_CUSTOMER`, `NOT_ACTIVE`, or `HISTORY_CUTOVER_INCOMPLETE`, and nothing is persisted.

An Amazon or internal account that is not an Active B2B customer therefore leaves no OIN row to reconstruct. Changing cutover or financial ownership to capture those movements is out of scope. The FBA ledger is a separate, idempotent store filled by a manual upload of the same 504 and TRM21QC pair. It does not hook the poller.

Historical 561L/SLRB lines stay customer sales history. They are not retargeted as Amazon sell-through. If an OIN reference is already on `AutopartSalesDocument`, the workspace counts that overlap and leaves the financial row in place.

## Purchasing demand

`src/server/purchasing/demand.ts` and the purchasing sales-trend queries sum `AutopartSalesLine` where `source = ONGOING_TRM21QC`. If the Amazon account is later mapped and cut over, those OIN lines would enter that table and inflate B2B demand. Both query sets now exclude `UPPER(documentReference) LIKE 'OIN%'`. Existing sales rows are not deleted or rewritten. Sales Intelligence is unchanged.

## AlphaOps

This repository does not integrate with AlphaOps, and this phase does not add a connection, shared database, or copy of Amazon credentials. There is no Amazon order, return, or marketplace feed here. The 231PO3NEW usage columns are not interpreted as sell-through.

The alternative is a manual Amazon UK CSV. The first rows declare `coverage_from`, `coverage_to`, `extracted_on` and `fulfilment_scope` of FBA or AFN, plus optional `complete` and `zeros_omitted`. SKU rows then need `sku`, `date`, `units_sold` and `fulfilment_channel` of AFN or FBA. Optional columns are `units_credited` and `marketplace`. Coverage is the declared range, not the earliest and latest sale date.

An MFN, FBM or blank channel rejects the whole file, so those units are not stored. A file with no channel column is a normalized FBA-only extract and is stored only when the operator attests that every row is Amazon FBA. That attestation is not an Amazon API check.

A checkbox does not make an extract complete. Completeness requires the file to say `complete=yes`, the operator to attest both FBA-only scope and completeness, and either a row on every declared day or `zeros_omitted=yes`. A sparse file whose only sales are the range endpoints stays incomplete, and the forecast stays Insufficient Data. The latest import is the current extract. Imports are not summed. A SKU absent from a complete extract counts as zero for a covered window.

## Forecast

Demand is the 30-day Amazon net (sold minus credited), and only when that window is supported. Weekly rate = `max(0, net 30) × 7/30`. Returns above sales become zero demand, not a negative shipment.

Projected required stock = demand during lead time + target weeks of cover after arrival + safety stock.

Suggested send = `max(0, required − FBA available − confirmed inbound)`, rounded up to the case multiple.

Studley shortfall = `max(0, suggested − Studley)`. Dispatchable is the minimum of suggested and Studley. Unknown Studley (not on the current warehouse feed) leaves dispatchable blank. The shortfall is a purchasing requirement, not a suggested dispatch of stock that is not there.

Recommendations: Send Now, Send Soon, Healthy, Overstocked, Insufficient Data. Missing sales, missing FBA stock, or a stale OPTIMUS snapshot is Insufficient Data and the suggested quantity is blank. Confidence is Medium when 30-day sales and fresh FBA stock both exist, otherwise None. The 7-, 90- and 365-day figures are comparisons only.

Nothing on this page creates an order, deducts stock, or publishes a shipment.

## Ledger and safety

Tables: `FbaReplenishmentImport`, `FbaReplenishmentDocument`, `FbaReplenishmentLine`, `FbaAmazonSalesImport`, `FbaAmazonSalesLine`, `FbaInboundShipment`, `FbaForecastSettings`, `FbaSkuForecastOverride`.

The same 504+TRM byte pair hashes once and is rejected as a duplicate. Documents upsert on `(documentReference, documentType)`. The line key is the TRM fingerprint, which changes when quantity or price changes. A revised file supersedes the previous active line for that SKU and keeps the old row with `supersededAt` for audit. Cadence sums only active lines. A SKU that is not in the revised file is left as it was. Two different fingerprints for the same SKU in one file are ambiguous: that SKU is not changed. The replacement runs in one serializable transaction.

Exceptions kept with the import: duplicate OIN header, orphan TRM line, header with no product lines, credit correction, TRM net versus 504 goods beyond £0.01, and a duplicate line fingerprint.

Permissions `purchasing.fba_forecast.view` and `purchasing.fba_forecast.manage` are implied by the purchasing and stock-forecast permissions. Imports and setting changes are audited. File hashes are not written into audit metadata.

Migration `20261027190000_fba_replenishment_forecast` is in the repository and is not applied by this change.

## Later, not in this phase

- A side capture during the existing 504/TRM import that writes OIN rows to this ledger without changing eligibility, financial writes, or the 13:15 / 18:15 Europe/London schedule.
- A read-only Amazon or AlphaOps sell-through API, only if a sanctioned credential path exists. Manual CSV remains the fallback.
- Confidence High once a supported 90-day window is an explicit input to the recommendation.
