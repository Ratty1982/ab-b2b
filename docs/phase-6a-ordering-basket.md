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
and portal**.

### Root cause of the production regression after 6d37871

- Product pricing called `optionalUserId()` / `getRequestHeaders()` inside the
  product loader `createServerFn` — cookies worked → YOUR PRICE.
- Public chrome read root router context from `beforeLoad` → `getClientSession`,
  but failures were swallowed to guest, and catalogue pages did not pass the
  loader-resolved session into the shell. UI unit tests only mocked
  `useSession`, so they could not fail for the real split.
- Header also treated “not TRADE” the same as anonymous for login CTAs.

### Fix

- Shared `resolveRequestClientSession` / `resolveOptionalRequestUserId`
  (same request headers as pricing).
- PDP/catalogue loaders call `getClientSession()` **alongside** product data and
  wrap the public shell in `RequestSessionProvider`.
- Header: any `signedIn` user sees account chrome (not Trade Login). Basket
  chrome requires TRADE + company (server still enforces `orders.view` /
  `orders.create` on basket APIs).
- `/api/build` returns deploy SHA (`SOURCE_COMMIT` / `GIT_SHA`) for Coolify checks.
- `Cache-Control: private, no-store` on root + catalogue/PDP routes.
- Trade Ordering purchasing controls live in the **product hero** beneath the
  short description (not under How to use).

### Manual production check (Wayne)

0. Hit `/api/build` and confirm `sha` matches the GitHub commit you deployed.
1. Log out.
2. Open PMML500SC40 (or another case-ordered SKU).
3. Confirm anonymous header (Trade Login / Open a Trade Account).
4. Confirm no Add to Basket / RRP path.
5. Log in with a valid trade customer.
6. Return to the same PDP (hard refresh once).
7. Confirm Trade Login / Open Account are gone.
8. Confirm Basket appears in the header (desktop and mobile nav).
9. Confirm My Account / Account appears.
10. Confirm YOUR PRICE.
11. Confirm Trade Ordering in the hero under the short description (case qty,
    quantity stepper, order total) when stock allows a full case.
12. Confirm Add to Basket.
13. Add one case.
14. Confirm basket badge changes without a full page refresh.
15. Open Basket via the header link (`/portal/basket`).
16. Refresh Basket.
17. Confirm line persists.
18. Return to public catalogue — still authenticated.
19. Logout.
20. Confirm anonymous header returns (no Basket).

## Phase 6B boundary

Not in 6A:

- checkout / draft Order creation
- payment / credit hold
- Autopart order file / email / API
- inventory reservation
- Quick Order bulk add backend

### Customer sell-price snapshot (required for 6B)

Commercial resolution may remain at 4 decimal places internally.

The B2B customer sell unit price is established by half-up rounding that
commercial amount to **2 decimal places** (`toCustomerSellUnitPrice`)
**before** multiplying by quantity. Line net = sell unit × quantity.

When Phase 6B creates an Order it must snapshot, at minimum:

- the resolved commercial unit facts needed for audit (source, 4dp value), and
- the **actual customer sell unit price (2dp)** used for the order line,

so the invoiced line reconciles: `unit sell price × quantity = line net`
(subject to any later explicit line/order discounts).
