# Phase 6B — B2B Checkout & Authoritative Order Creation

Creates the Automotive Brands order from the trade basket.

**PHASE 6B DOES NOT SUBMIT ORDERS TO AUTOPART.**

There is:

- NO Autopart sales-order API  
- NO APC Overnight / carrier booking  
- NO EDI / desktop automation  

Staff may later download an Autopart-compatible **CSV export** for manual
import (see `docs/autopart-order-export.md`). That export is a separate
operational handoff and does not change customer fulfilment status or
release AB stock reservations.

---

## Journey

```text
Basket → Checkout → Delivery / Contact / Reference
→ Order review → Final server validation → Place order
→ Order SUBMITTED → Confirmation → Portal history → Admin workspace
```

## Company scoping

Checkout company is resolved from authenticated `CompanyUser` membership
(via pricing actor / basket context). The browser never supplies a trusted
`companyId`.

Only **ACTIVE** trade companies with `orders.create` may place orders.
Admin trade-test baskets cannot place real company orders.

## Delivery & contact

- Select a company delivery `Address` owned by that company, **or**
- Enter a one-off delivery address (does **not** auto-write the master address book)
- Order stores a **delivery address snapshot** (JSON) — historical truth
- Contact name / email / phone snapshotted at place time

## Customer reference & instructions

- `poNumber` = YOUR REFERENCE (optional, max 80)
- `deliveryInstructions` = plain text (optional, max 500; HTML stripped)

## Payment terms

Snapshotted from `Company.paymentTerms` when set.  
**Never invents “30 days”.**

Delivery method label is restrained (e.g. Standard Trade Delivery) — **no shipping charge engine / APC**.

## Pricing revalidation

Every place-order:

1. Re-resolves Phase 4 trade prices  
2. Establishes **customer sell unit** via HALF-UP 2dp (`toCustomerSellUnitPrice`)  
3. Line net = sell unit × qty  
4. If `expectedLinePrices` differ → `REVIEW_REQUIRED` / `PRICE_UPDATED` — no silent submit  

## Case ordering & FINAL_PART_CASE

Reuses `src/domain/ordering.ts`:

- Normal: case multiples of `caseQty` (MOQ-aware)  
- Final part-case: when `0 < trusted sellable < caseQty`, qty `1..sellable`  
- Exact remaining stock only for authenticated order-eligible trade users in final-part-case  
- Anonymous never receives exact stock  

## Stock

Uses Phase 5 Autopart Avail (`qtyOnHand`) plus Automotive Brands reservations:

```text
effective sellable = max(0, qtyOnHand − qtyReserved)
```

- `qtyOnHand` = latest Autopart 231PO3NEW Avail (sync updates this only)  
- `qtyReserved` = sum of **ACTIVE** `OrderStockReservation` quantities  
- **Sync must never reset `qtyReserved`**  
- Basket / checkout preview does **not** reserve — only `placeOrder` does, under `SELECT … FOR UPDATE` inside the order transaction  
- Autopart `qtyOnHand` is never decremented by 6B; there is no Autopart ERP reservation  

### Reservation lifecycle

| Status | Meaning |
| --- | --- |
| ACTIVE | Hold after successful place |
| RELEASED | Hold freed (cancel / expiry — Phase 6C) |
| CONSUMED | Applied when Autopart handoff completes (Phase 6C) |

Concurrent placeOrders racing the last units: exactly one succeeds; the other fails with `INSUFFICIENT_STOCK`.

## Order number

Race-safe `OrderNumberSequence` → `AB-000001` style.

## Idempotency

`idempotencyKey` unique on Order. Retries / double-clicks return the same order.

## Snapshots on Order / OrderItem

| Field | Purpose |
| --- | --- |
| deliveryAddress / billingAddress / contactSnapshot | Historical parties |
| paymentTermsSnapshot | Terms at place |
| autopartCustomerCodeSnapshot | **Verified** code only |
| salesRep*Snapshot | Primary assignment at place |
| OrderItem unitPrice (4dp) + customerUnitPrice (2dp) | Commercial + sell |
| caseQty / orderingMode / priceSource | Ordering audit |
| lineTotal / lineVat / lineGross | Immutable money |

## Basket conversion

Successful place marks the OPEN basket `CONVERTED`.  
A new OPEN basket is created lazily on next shop.

## Status

Placed orders use `SUBMITTED` (= received / pending Autopart).  
Do not claim despatched / paid / Autopart-sent.

## Email

After commit, `sendOrderEmailsAfterCommit`:

1. Creates durable `TransactionalEmail` rows (`ORDER_RECEIVED`, optional `ORDER_RECEIVED_INTERNAL`) with idempotency key `purpose:orderId`  
2. Attempts send via the email adapter  
3. Updates `SENT` / `FAILED` — **never rolls back the order**  

Bodies use **order snapshot** prices and line items (not live catalogue).  
Customer copy must not claim Autopart reservation or despatch.  
Internal notify uses `TRADE_ORDER_NOTIFICATION_EMAIL` when set.  
Admin order detail shows status and can **Retry** (rebuilds from snapshot).

## Portal routes

| Path | Role |
| --- | --- |
| `/portal/checkout` | Place order |
| `/portal/orders` | History |
| `/portal/orders/$orderId` | Detail (company IDOR-safe) |
| `/portal/orders/$orderId/confirmation` | Confirmation |

## Admin

`/admin/orders` + `/admin/orders/$orderId` — real Order rows, sales-scoped where applicable.  
Product inventory panel shows Autopart Avail, AB Reserved, Effective Sellable.

## Remaining mock surfaces

- `/portal` dashboard “recent orders” may still use prototype fixtures until updated separately  
- `/portal/quick-order` remains mock backend (6A out of scope)  
- `/sales/order/$id` sales mock route remains until replaced  

## Phase 6C requirements

- Autopart sales-order submission using **order** Autopart code snapshot  
- Reconciliation of `OrderStockReservation` (RELEASED / CONSUMED) against Autopart acknowledgement  
- Shipping charge engine / APC services  
- Richer status machine for ERP acknowledgement  
- Customer cancellation / amendment workflows (release reservations)  
