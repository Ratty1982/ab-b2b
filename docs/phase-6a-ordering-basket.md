# Phase 6A — B2B Ordering & Basket

Persistent trade baskets with server-authoritative case ordering, pricing, and
stock validation. **Checkout, Autopart order submission, and Quick Order are
out of scope.**

## Ownership

- One `Basket` with `status = OPEN` per **company**
- Scoped by authenticated trade membership (`CompanyUser`), never by a
  client-supplied `companyId` / `basketId` alone
- `BasketItem` is unique on `(basketId, variantId)` — duplicate adds merge qty

## Server authority

The browser may submit only:

- `variantId`
- requested `quantity`

The server resolves:

- company context
- product / variant orderability
- `caseQty` / MOQ
- Autopart sellable stock (exact Avail, privately)
- Phase 4 trade price (including quantity breaks / promotions / VAT)
- line and basket money totals

## caseQty

`ProductVariant.caseQty` is the customer order multiple. Missing / zero /
invalid → not orderable online. Do **not** invent `caseQty = 1`.

`orderIncrement` remains internal catalogue data and does not override case
ordering.

## MOQ

`getMinimumOrderQuantity` / `minimumCustomerOrderQuantity` returns the
smallest valid **case multiple** that satisfies `minOrderQty`.

Example: case 12 + MOQ 20 → minimum **24**.

## Stock

Uses Phase 5 `loadStockByVariantIds` / `getSellableQuantity`.

- Exact Avail never leaves the server in customer DTOs
- Public bands remain IN / LOW / OUT
- Stale positive stock follows Phase 5 policy (not orderable)
- Basket lines are **not** inventory reservations — `qtyOnHand` /
  `qtyReserved` / Autopart sync are unchanged by basket mutations

## Pricing & VAT

Reuses `resolveVariantTradePrices` / `resolveTradePriceFromFacts`.

Quantity changes re-resolve prices (quantity breaks). Money uses
`src/domain/money.ts` scaled integers (4dp internal, 2dp display).

## PDP

Trade Ordering stays under **How to use** (left column). Controls enhance
that card — they do not move to the hero and do not redesign Product Details.

## Basket UI

- Route: `/portal/basket`
- Nav: portal **Basket** + header badge with **line count**
- Empty state, quantity ± by case, remove, live totals

## Revalidation

On every basket load, lines are assessed:

| Issue | Meaning |
| --- | --- |
| `VALID` | OK |
| `QUANTITY_UNAVAILABLE` | Stock no longer covers quantity |
| `INSUFFICIENT_FULL_CASE` | Below one full case |
| `CASE_CONFIGURATION_CHANGED` | caseQty / MOQ no longer fits quantity |
| `PRODUCT_UNAVAILABLE` | Inactive / not trade-visible |
| `PRICE_UNAVAILABLE` | No resolvable trade price |

Lines are **not** silently deleted.

## Phase 6B boundary

Not in 6A:

- checkout / draft Order creation
- payment / credit hold
- Autopart order file / email / API
- inventory reservation
- Quick Order bulk add backend
