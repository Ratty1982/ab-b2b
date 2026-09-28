# Trade backorders (Phase 6C)

Controlled B2B backorder support. Customers may order permitted SKUs when stock is insufficient or zero.

Automotive Brands **allows backorders by default**. Individual SKUs may override.

## Policy model

| Field | Location | Values | Default |
| --- | --- | --- | --- |
| `defaultBackorderPolicy` | `TradeOrderingSettings` (singleton) | `ALLOW` \| `DENY` | **`ALLOW`** |
| `backorderPolicy` | `ProductVariant` | `INHERIT` \| `ALLOW` \| `DENY` | **`INHERIT`** |

### Resolution

Single authoritative helper: `resolveBackorderPolicy({ globalPolicy, variantPolicy })` in `src/domain/backorder.ts`.

| Variant | Global | Effective |
| --- | --- | --- |
| `ALLOW` | any | **ALLOW** |
| `DENY` | any | **DENY** |
| `INHERIT` | `ALLOW` | **ALLOW** |
| `INHERIT` | `DENY` | **DENY** |

All ordering surfaces (PDP, catalogue cards, basket, checkout, add-to-basket, order creation) must use the resolved **effective** policy. Do not re-derive permission in the UI.

### Admin controls

- **System → Settings → Ordering**: “Allow backorders by default” (ON for production).
  - Help: *When enabled, products can be ordered when stock is unavailable unless backorders are disabled for the individual SKU.*
- **Product → Inventory → Backorders**: `Use global setting` / `Allow` / `Do not allow`, with **Effective policy** shown underneath.
- **Products list bulk action**: select SKUs → choose policy → confirm affected SKU count before apply.

The global setting affects **orderability only**. It does **not** change Autopart Avail, create stock/reservations, alter historical orders/snapshots, send emails, or create orders.

### Migration

Prior Phase 6C migration defaulted every variant to `DENY`. Those values were not distinguishable from explicit admin disables.

Split across two migrations (PostgreSQL requires a commit before a newly added enum value can be used):

1. `20260928170000_backorder_inherit_global`
   - Adds `INHERIT` to `BackorderPolicy`
   - Creates `EffectiveBackorderPolicy` (`ALLOW` \| `DENY`)
   - Creates `TradeOrderingSettings` singleton with `defaultBackorderPolicy = ALLOW`
2. `20260928171000_backorder_inherit_apply`
   - Sets variant column default to `INHERIT`
   - Updates existing `DENY` → `INHERIT` (catalogue inherits global ALLOW)
   - Preserves any explicit `ALLOW` overrides

Staff may then explicitly `DENY` individual SKUs.

## Availability states

Central helper: `src/domain/availability.ts` (+ ordering via `resolveCustomerOrdering` with **effective** policy).

| Public band | Meaning |
| --- | --- |
| `in` | Effective sellable ≥ 21 |
| `low` | Effective sellable 1–20 |
| `out` | Effective sellable 0 and effective policy DENY |
| `backorder` | Effective sellable 0 and effective policy ALLOW |
| `partial` | Basket/checkout: ordered qty exceeds current sellable under ALLOW |

Customer labels: In Stock / Low Stock / Out of Stock / **Available to Backorder** / Partially Available.

Never promise an ETA. Copy:

> This item is currently awaiting stock but can still be ordered. It will be supplied when stock becomes available.

Catalogue cards stay concise (“Available to Backorder”).

## Zero stock + ALLOW

Example: `PMSCWASH`, `caseQty = 4`, Avail 0, global ALLOW, variant INHERIT.

- Availability: **AVAILABLE TO BACKORDER**
- Orderable: yes
- Valid qty: 4, 8, 12, 16…
- Default Add to Basket qty: **4**
- Do **not** show “Insufficient stock for a full case”

## Partial stock + ALLOW

Example: `caseQty = 4`, Avail 2, order 4 → reserved 2, backordered 2.

Final-part-case rules remain: `1..sellable` OR full case multiples. Insufficient-full-case must not block a valid backorder case multiple.

## Stale stock

Stale positive Autopart stock is **not** trusted as available allocation:

- Trusted sellable for ordering/bands → **0**
- If effective policy is ALLOW → customer may still place a **full backorder**
- Never advertise stale positive qty as In/Low Stock

## Basket behaviour

- Revalidate against trusted effective sellable (Autopart Avail − ACTIVE AB reservations; stale → 0).
- ALLOW + oversell → line stays valid; show allocated vs backordered split for authenticated trade actors.
- Zero stock ALLOW: **Available to Backorder** + “N will be placed on backorder” — no invalid-stock warning.
- DENY + oversell → `QUANTITY_UNAVAILABLE`.
- Case-pack and final-part-case rules still apply.
- Server `addToBasket` is authoritative — UI alone must not enable ordering.

## Checkout behaviour

- Notice **BACKORDER ITEMS** when any valid line has `backorderQtyAtOrder > 0`.
- Submitting checkout with that notice is acknowledgement (no separate consent flow).
- Delivery charge remains the normal order-level calculation (no extra carriage for backorders).
- Zero-stock ALLOW lines remain valid through checkout and order creation.

## Order snapshot fields

On `OrderItem` (immutable history):

- `availableQtyAtOrder` — sellable units allocated at placement
- `backorderQtyAtOrder` — units beyond available at placement (default 0)

Do **not** recompute these from live inventory later.

Example (Avail 0, order 4): `orderedQty=4`, `availableQtyAtOrder=0`, `backorderQtyAtOrder=4`, reservation=0.

## Reservations

AB reserves **only** `availableQtyAtOrder` (via `reserveStockForOrder`).

| Ordered | Sellable | Reserve | Backorder |
| ---: | ---: | ---: | ---: |
| 12 | 5 | 5 | 7 |
| 12 | 0 | 0 | 12 |
| 4 | 2 | 2 | 2 |

Concurrency: inventory rows are locked `FOR UPDATE`; two simultaneous orders cannot both reserve the same units.

## Case-pack & final-part-case

Backorders do not relax case multiples. With ALLOW and `sellable < caseQty`:

- Final part: order `1..sellable`
- Or full case multiples (`4`, `8`, `12`, …) with the gap backordered
- Not arbitrary quantities such as `1` when case is `4` and sellable is `0`

## Autopart CSV

CSV **Quantity** = full ordered qty (`OrderItem.qty`), never the AB allocation alone.

Do not block export because AB stock was zero. SDEL remains a single order-level delivery line when paid delivery applies.

## Product status vs stock status

Do not confuse:

- product `ACTIVE` / trade visibility
- stock availability
- backorder permission

An ACTIVE, trade-visible product with zero stock and effective ALLOW is **orderable via backorder**.

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

Preserved from commit `0315019`:

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

- Dashboard **Backorders**: orders, units, SKUs affected, stock-now-available SKUs — based on **actual outstanding order lines** only. Changing the global default does **not** create backorder metrics.
- Orders list filter: Backorders → Contains / Fully + line-level ops table
- Product Inventory: Autopart Avail, AB Reserved, Effective Available, effective Backorders Allowed
- Outstanding demand helper: `getOutstandingBackorderDemand` (no auto POs)

## Security

Customers only see their company’s orders (server-side company scope). Admin/sales follow existing RBAC.
