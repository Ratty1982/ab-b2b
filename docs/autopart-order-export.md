# Autopart order CSV export

Manual Automotive Brands → Autopart order handoff via CSV download.

**This is CSV export only.**

There is:

- NO Autopart sales-order API  
- NO APC Overnight / carrier booking / labels / consignments / tracking  
- NO EDI / desktop automation / automatic Autopart submission  

Staff download the CSV and import it into Autopart manually.

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

## Field mapping (order snapshots only)

| CSV column | AB source |
| --- | --- |
| External Reference | `Order.orderNumber` |
| Order Date | `placedAt` (else `createdAt`) as `YYYY-MM-DD` Europe/London |
| Shipping Name | delivery `contactName` → contact name → company name |
| Shipping Address 1–Country | `Order.deliveryAddress` snapshot |
| Email / Phone | `Order.contactSnapshot` (phone Excel-safe) |
| Supplier SKU | `OrderItem.sku` snapshot (no fuzzy match) |
| Quantity | `OrderItem.qty` |
| Sub Total | `OrderItem.lineTotal` (goods net) |
| Shipping / VAT / Total / Payment Amount 1 | Order-level snapshots apportioned by qty (largest remainder) |
| Price | `OrderItem.customerUnitPrice` (AB mapping; not AlphaOps total÷qty) |
| Source | `Automotive Brands B2B` |
| MAM Account | `Order.autopartCustomerCodeSnapshot` only |

Never resolve live Company Autopart code, claimed TradeApplication values, or recalculate today's prices / delivery threshold.

## One row per line

Multi-line orders produce one CSV row per `OrderItem`, sharing order header fields and MAM Account.

## Financial apportionment

Order-level `deliveryTotal`, `vatTotal`, and `grandTotal` are split across lines by quantity weights using largest-remainder penny allocation so:

- `sum(Sub Total) = goods net`
- `sum(Shipping) = delivery net`
- `sum(VAT) = order VAT`
- `sum(Total) = order gross`
- `sum(Payment Amount 1) = order gross`

## Eligibility

Blocked when:

- cancelled / draft  
- no items  
- missing verified Autopart code snapshot  
- missing SKU  
- missing delivery / contact email snapshot  
- invalid financial snapshots  

Batch export refuses partial success: Selected / Ready / Blocked must be resolved first.

## Export lifecycle

- Status: `NOT_EXPORTED` → `EXPORTED`  
- Metadata: `autopartExportedAt`, `autopartExportedByUserId`, `autopartExportBatchId`, `autopartExportCount`  
- Batch record: `AutopartOrderExportBatch` (`APX-000001`…) — metadata only, no CSV body stored  
- Re-export allowed with explicit confirmation + audit  
- Customer fulfilment status is **not** changed to Despatched  
- `OrderStockReservation` is **unchanged** by export  

## Audit

- `order.autopart_export`  
- `order.autopart_reexport`  
- `order.autopart_batch_export`  

## Customer portal

Autopart account codes, export batches, and internal export state are **not** exposed to customers.
