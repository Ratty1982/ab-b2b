# Trade backorders (Phase 6C)

Controlled B2B backorder support. Customers may order permitted SKUs when stock is insufficient or zero. Backordering is **opt-in per ProductVariant** and defaults to **DENY**.

## Policy

| Field | Location | Values | Default |
| --- | --- | --- | --- |
| `backorderPolicy` | `ProductVariant` | `DENY` \| `ALLOW` | `DENY` |

Admin control: **Product → Inventory → Backorders** checkbox  
“Allow customers to order when stock is unavailable”

Existing SKUs remain non-backorderable until staff explicitly enable them.

## Availability states

Central helper: `src/domain/availability.ts` (+ ordering via `resolveCustomerOrdering`).

| Public band | Meaning |
| --- | --- |
| `in` | Effective sellable ≥ 21 |
| `low` | Effective sellable 1–20 |
| `out` | Effective sellable 0 and policy DENY |
| `backorder` | Effective sellable 0 and policy ALLOW |
| `partial` | Basket/checkout: ordered qty exceeds current sellable under ALLOW |

Customer labels: In Stock / Low Stock / Out of Stock / Available to Backorder / Partially Available.

Never promise an ETA. Copy for backorder:

> Available to order. This item will be supplied when stock becomes available.

## Basket behaviour

- Revalidate against current effective sellable (Autopart Avail − ACTIVE AB reservations).
- ALLOW + oversell → line stays valid; show allocated vs backordered split for authenticated trade actors.
- DENY + oversell → `QUANTITY_UNAVAILABLE` (existing stock messaging).
- Case-pack and final-part-case rules still apply.

## Checkout behaviour

- Notice **BACKORDER ITEMS** when any valid line has `backorderQtyAtOrder > 0`.
- Submitting checkout with that notice is acknowledgement (no separate consent flow).
- Delivery charge remains the normal order-level calculation (no extra carriage for backorders).

## Order snapshot fields

On `OrderItem` (immutable history):

- `availableQtyAtOrder` — sellable units allocated at placement
- `backorderQtyAtOrder` — units beyond available at placement (default 0)

Do **not** recompute these from live inventory later.

## Reservations

AB reserves **only** `availableQtyAtOrder` (via `reserveStockForOrder`).

| Ordered | Sellable | Reserve | Backorder |
| ---: | ---: | ---: | ---: |
| 12 | 5 | 5 | 7 |
| 12 | 0 | 0 | 12 |

Concurrency: inventory rows are locked `FOR UPDATE`; two simultaneous orders cannot both reserve the same units.

## Case-pack & final-part-case

Backorders do not relax case multiples. With ALLOW and `sellable < caseQty`:

- Final part: order `1..sellable`
- Or full case multiples (`12`, `24`, …) with the gap backordered
- Not arbitrary quantities such as `6` when case is `12` and sellable is `5`

## Autopart CSV

CSV **Quantity** = full ordered qty (`OrderItem.qty`), never the AB allocation alone.

SDEL remains a single order-level delivery line when paid delivery applies. No duplicate SDEL for backordered quantity.

## 504C / despatch safety

504C is order-level financial evidence only. When an order has known `backorderQtyAtOrder > 0`:

- Status becomes **`PARTIALLY_DESPATCHED`**, not full `DISPATCHED`
- Full `ORDER_DESPATCHED` email is not sent for that transition
- Limitation: AB does not invent line-level fulfilment certainty from 504C

Simple (non-backorder) orders keep the previous Processing → Despatched behaviour.

## Customer status wording

| Internal | Customer label |
| --- | --- |
| SUBMITTED | Received |
| CONFIRMED / PICKING (no BO) | Processing |
| CONFIRMED / PICKING (with BO) | Part Backordered |
| PARTIALLY_DESPATCHED | Part Despatched |
| DISPATCHED | Despatched |

Fully backordered after export may show “Processing — Backordered items” until authoritative fulfilment arrives.

## New stock arrives

231PO3NEW updates do **not** change historical `backorderQtyAtOrder`.  
Stock available ≠ warehouse despatched — never auto-send despatched from stock alone.

## Admin reporting

- Orders list filter: Backorders → All / Contains / Fully backordered + badge
- Dashboard: **Backordered orders** count → filtered orders list
- Product Inventory: Autopart Avail, AB Reserved, Effective Available, Backorders Allowed
- Outstanding demand helper: `getOutstandingBackorderDemand` (no auto POs)

## Security

Customers only see their company’s orders (server-side company scope). Admin/sales follow existing RBAC.
