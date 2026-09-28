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

## Order item fulfilment fields

| Field | Meaning |
| --- | --- |
| `availableQtyAtOrder` | Historical sellable allocation at placement |
| `backorderQtyAtOrder` | Historical backorder at placement (immutable) |
| `despatchedQty` | Cumulative units with **authoritative line-level** despatch evidence only |

Never invent `despatchedQty` from Autopart Avail, CSV export, or 504C order totals alone.

## Fulfilment timeline

`OrderFulfilmentEvent` records customer-safe history only when backed by real evidence:

| Kind | Source |
| --- | --- |
| `ORDER_RECEIVED` | Order placement |
| `EXPORTED_FOR_PROCESSING` | Successful Autopart CSV export (Processing) |
| `INVOICE_LINKED` | 504C invoice linked |
| `PART_DESPATCHED` | Partial fulfilment evidence |
| `DESPATCHED` | Full fulfilment evidence |

Never manufacture timeline events. Export ≠ Picked. Stock feed ≠ Despatched.

## 504C capability matrix

| Capability | Supported by 504C today? |
| --- | --- |
| Full-order despatch (no backorder / financially complete) | Yes — order-level invoice totals |
| Partial-order despatch (known backorder) | Conservatively — mark `PARTIALLY_DESPATCHED` |
| Line-level despatched quantities | **No** — 504C has no SKU lines |
| Exact remaining backorder quantity after partial invoice | **No** — cannot invent from totals |

### Future Autopart integration requirement

AB needs an additional Autopart report/feed that provides **line-level** fulfilment quantities (SKU + qty despatched per AB order / invoice) before customer portal can show exact Despatched / Outstanding splits after a partial 504C invoice.

Until then:

- Placement snapshots (`availableQtyAtOrder` / `backorderQtyAtOrder`) remain accurate
- Partial 504C → `PARTIALLY_DESPATCHED` + `ORDER_PART_DESPATCHED` (no invented SKU qty)
- Cumulative invoices that financially complete the AB order → full `DISPATCHED` + `ORDER_DESPATCHED`
- Multiple Autopart invoices may link to one AB order (`externalRef` / document number remains unique)

## Customer portal

- Dashboard **Backorders** summary only when outstanding backorders exist
- Order history filters: All / Open / Backorders
- Order detail: Ordered / Allocated / Despatched / Backordered + fulfilment timeline
- Labels: Received, Processing, Backordered, Part Backordered, Part Despatched, Despatched
- No PICKED without warehouse-picked signal (not currently available)

## Transactional emails

| Purpose | When |
| --- | --- |
| `ORDER_RECEIVED` | Placement — includes backorder quantities + “do not reorder” copy |
| `ORDER_PART_DESPATCHED` | Authoritative partial despatch (idempotent per invoice) |
| `ORDER_DESPATCHED` | Full / remaining despatch (idempotent per order) |

All fulfilment emails are post-commit, idempotent, recorded, and retryable. Email failure never rolls back order/fulfilment/invoice state.

## Customer status wording

| Internal | Customer label |
| --- | --- |
| SUBMITTED | Received |
| CONFIRMED / PICKING (no BO) | Processing |
| CONFIRMED / PICKING (fully BO) | Backordered |
| CONFIRMED / PICKING (part BO) | Part Backordered |
| PARTIALLY_DESPATCHED | Part Despatched |
| DISPATCHED | Despatched |

## New stock arrives

231PO3NEW updates do **not** change historical `backorderQtyAtOrder`.  
Stock available ≠ warehouse despatched — never auto-send despatched from stock alone.  
Internal admin may show **Stock now available** against outstanding demand; customers still see Processing / Backordered until fulfilment evidence.

## Admin reporting

- Dashboard **Backorders**: orders, units, SKUs affected, stock-now-available SKUs
- Orders list filter: Backorders → Contains / Fully + line-level ops table
- Product Inventory: Autopart Avail, AB Reserved, Effective Available, Backorders Allowed
- Outstanding demand helper: `getOutstandingBackorderDemand` (no auto POs)

## Security

Customers only see their company’s orders (server-side company scope). Admin/sales follow existing RBAC.
