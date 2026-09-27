# Autopart order CSV export

Manual Automotive Brands → Autopart order handoff via CSV download.

**This is CSV export only.**

There is:

- NO Autopart sales-order API  
- NO APC Overnight / carrier booking / labels / consignments / tracking  
- NO EDI / desktop automation / automatic Autopart submission  

Staff download the CSV and import it into Autopart manually.

## Lifecycle

```text
Customer places B2B order
→ AB status RECEIVED (SUBMITTED)
→ customer receives ORDER_RECEIVED email
→ AB stock reservation exists

Staff exports Autopart CSV (this document)
→ CSV downloads successfully
→ AB customer-facing status becomes PROCESSING (CONFIRMED)
→ AB records Autopart export metadata

Staff manually imports CSV into MAM Autopart
→ warehouse picks / invoices in Autopart
→ future 504C reconciliation → DESPATCHED
```

See also: `docs/autopart-504c-invoice-feed.md`.

## AlphaOps contract reference

Studied independently from AlphaOps default branch (`Ratty1982/alphaops`):

- `backend/src/orders/order-export-csv.util.ts`
- `backend/src/orders/orders.service.ts` (`exportCsv`, `buildOrderLineApportionment`, `resolveLineFinancials`)

AB does **not** import AlphaOps packages at runtime and has no dependency on that repository.

Confirmed Autopart-compatible headers (unchanged vs AlphaOps):

```text
External Reference, Order Date, Shipping Name, Shipping Address 1,
Shipping Address 2, Shipping City, Shipping County, Shipping Postcode,
Shipping Country, Email, Phone, Supplier SKU, Quantity, Sub Total,
Shipping, VAT, Total, Price, Source, Payment Amount 1, MAM Account
```

## External Reference — AB order number only

`External Reference` is **always** the Automotive Brands order number (e.g. `AB-000002`).

This is deliberate: Autopart 504C returns the value as **Customer Order Number**, which is the AB reconciliation key.

| Concept | Value |
| --- | --- |
| AB Order Number | `AB-000002` |
| External Reference (CSV) | `AB-000002` |
| Autopart Customer Order Number (504C) | `AB-000002` |

Customer PO / reference (e.g. `PO696969`) is preserved separately on the order (`poNumber`) and shown in admin, portal, and emails. It must **never** replace External Reference.

The proven Autopart import contract has no dedicated Customer PO column in this CSV set — do not invent one.

## Field mapping (order snapshots only)

| CSV column | AB source |
| --- | --- |
| External Reference | `Order.orderNumber` |
| Order Date | `placedAt` (else `createdAt`) as `YYYY-MM-DD` Europe/London |
| Shipping Name | delivery `contactName` → contact name → company name |
| Shipping Address 1–Country | `Order.deliveryAddress` snapshot |
| Email / Phone | `Order.contactSnapshot` (phone Excel-safe) |
| Supplier SKU | `OrderItem.sku` snapshot, or `SDEL` for paid delivery |
| Quantity | `OrderItem.qty`, or `1` for SDEL |
| Sub Total | Goods line net, or delivery net for SDEL |
| Shipping | Always `0.00` (see Delivery / SDEL below) |
| VAT / Total / Payment Amount 1 | Order-level snapshots apportioned by qty across product + SDEL lines (largest remainder) |
| Price | `OrderItem.customerUnitPrice`, or delivery net for SDEL |
| Source | `Automotive Brands B2B` |
| MAM Account | `Order.autopartCustomerCodeSnapshot` only |

Never resolve live Company Autopart code, claimed TradeApplication values, or recalculate today's prices / delivery threshold.

## Delivery / SDEL (MAM carriage)

**Autopart/MAM Incoming Purchase Orders does not consume AB’s order-level CSV `Shipping` column as carriage.**

Real MAM import testing (e.g. AB-000003) showed goods imported correctly while a `Shipping = 5.95` field was ignored, so VAT/gross under-stated delivery.

Paid delivery is therefore represented as an **additional order line**:

| Field | Value |
| --- | --- |
| Supplier SKU | `SDEL` |
| Quantity | `1` |
| Price / Sub Total | snapshotted `Order.deliveryTotal` (net) |

Rules:

- `deliveryTotal` snapshot **> 0** → emit one `SDEL` row  
- `deliveryTotal` snapshot **= 0.00** (free delivery) → **no** `SDEL` row  
- Do **not** re-run the £150 free-delivery rule at export time — use the historical snapshot only  
- The CSV `Shipping` column is always `0.00` so carriage is **not** double-counted as SDEL + Shipping  

Example (AB-000003):

```text
PMAPC500 × 6 @ £1.76  → net £10.56
SDEL     × 1 @ £5.95  → net £5.95
Net £16.51 + VAT £3.30 = Gross £19.81
```

## MAM Account

Uses the **verified Autopart customer code snapshotted on the Order**.

Missing snapshot → **BLOCK EXPORT**. Never substitute company name, email, customer claim, or current unverified Company value.

## One row per line

Multi-line orders produce one CSV row per `OrderItem`, plus one `SDEL` row when delivery snapshot is paid. All rows share order header fields and MAM Account.

## Financial apportionment

Order-level `vatTotal` and `grandTotal` are split across **product + SDEL** lines by quantity weights using largest-remainder penny allocation so:

- `sum(Sub Total) = goods net + delivery net` (SDEL carries delivery)
- `sum(Shipping) = 0.00` (carriage is SDEL, not Shipping)
- `sum(VAT) = order VAT` (authoritative snapshot — not recalculated at 20%)
- `sum(Total) = order gross`
- `sum(Payment Amount 1) = order gross`

Zero/exempt VAT orders still export `SDEL` when delivery snapshot is paid; VAT columns remain `0.00` from the snapshot.

## Eligibility

Blocked when:

- cancelled / draft  
- no items  
- missing verified Autopart code snapshot  
- missing SKU  
- missing delivery / contact email snapshot  
- invalid financial snapshots  

Batch export refuses partial success: Selected / Ready / Blocked must be resolved first.

## Successful export → Processing

Agreed business rule:

- `SUBMITTED` (Received) → `CONFIRMED` (Processing) on **successful committed CSV export only**
- Preview / modal / validation / failed / blocked export does **not** change status
- Re-export of an already Processing order leaves it Processing
- **No** additional customer email on export (next automatic email is DESPATCH via 504C)
- **No** APC side effects
- `OrderStockReservation` is **unchanged** by export

## Export metadata

- Status: `NOT_EXPORTED` → `EXPORTED`  
- Metadata: `autopartExportedAt`, `autopartExportedByUserId`, `autopartExportBatchId`, `autopartExportCount`  
- Batch record: `AutopartOrderExportBatch` (`APX-000001`…) — metadata only, no CSV body stored  
- Re-export allowed with explicit confirmation + audit  

Admin order detail shows an AUTOPART section (account, export status, exported at/by, batch, Customer Order No = AB order number).

## Audit

- `order.autopart_export`  
- `order.autopart_reexport`  
- `order.autopart_batch_export`  

Metadata includes `apcInvoked: false`, `reservationUnchanged: true`, `customerEmailOnExport: false`.

## Customer portal

Customer-safe labels: Received → Processing → Despatched.

Autopart account codes, export batches, CSV, MAM, and internal export state are **not** exposed to customers.
