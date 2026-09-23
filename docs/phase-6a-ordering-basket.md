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

## Public session consistency (Phase 6A fix)

One Better Auth session drives **pricing, public header, Trade Ordering, basket,
and portal**. The root route `beforeLoad` calls `getClientSession()` and sets
`Cache-Control: private, no-store` so authenticated chrome is never reused from
an anonymous cache.

- Anonymous: Trade Login + Open a Trade Account; no Basket; no Add to Basket;
  no YOUR PRICE.
- Authenticated trade: My Account + Basket (+ badge) + Log out; YOUR PRICE from
  Phase 4; ordering controls when the product is orderable.
- Authenticated but product not orderable: header stays logged-in; PDP shows the
  product-level reason (e.g. insufficient full case) — not anonymous CTAs.

### Manual production check (Wayne)

1. Log out.
2. Open PMML500SC40 (or another case-ordered SKU).
3. Confirm anonymous header (Trade Login / Open a Trade Account).
4. Confirm no Add to Basket.
5. Log in with a valid trade customer.
6. Return to the same PDP.
7. Confirm Trade Login / Open Account are gone.
8. Confirm Basket appears.
9. Confirm My Account appears.
10. Confirm YOUR PRICE.
11. Confirm case quantity controls (when stock allows a full case).
12. Confirm Add to Basket.
13. Add one case.
14. Confirm basket badge changes.
15. Open Basket (`/portal/basket`).
16. Refresh Basket.
17. Confirm line persists.
18. Return to public catalogue — still authenticated.
19. Logout.
20. Confirm anonymous header returns.

## Phase 6B boundary

Not in 6A:

- checkout / draft Order creation
- payment / credit hold
- Autopart order file / email / API
- inventory reservation
- Quick Order bulk add backend
