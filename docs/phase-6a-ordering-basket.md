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

Never trust client quantity, client stock, client mode, or client price.

## NORMAL CASE ORDERING

`ProductVariant.caseQty` is the customer order multiple. Missing / zero /
invalid → not orderable online. Do **not** invent `caseQty = 1`.

`orderIncrement` remains internal catalogue data and does not override case
ordering.

When sellable stock is **at least one complete case** (`sellable ≥ caseQty`):

| caseQty | sellable | Valid quantities |
| --- | --- | --- |
| 12 | 37 | 12, 24, 36 |
| 12 | 17 | **12 only** (not 13–17) |
| 12 | 12 | 12 |

Part-case quantities are **not** allowed while a full case remains.

## FINAL PART-CASE STOCK EXCEPTION

When:

```text
0 < current sellable stock < caseQty
```

and Phase 5 stock policy considers the stock safe to order (not stale-hidden),
the customer may order the **remaining units as a final part case**:

| caseQty | sellable | Valid quantities |
| --- | --- | --- |
| 12 | 11 | 1–11 |
| 12 | 7 | 1–7 |
| 12 | 1 | 1 |
| 12 | 0 | not orderable |

- Step = **1** (individual units). Do **not** use `orderIncrement`.
- Default quantity = **all remaining stock**.
- Domain mode: `FINAL_PART_CASE` via `resolveCustomerOrdering` in
  `src/domain/ordering.ts` (shared by PDP, catalogue list, basket, admin trade
  test).

### MOQ override

Final-part-case **overrides MOQ** where necessary. Example: caseQty 12,
minOrderQty 24, sellable 7 → allow 1–7. Otherwise MOQ would make the exception
useless. Normal case/MOQ rules apply again once sellable ≥ caseQty.

### Stock privacy

Exact Avail must not normally leave the server.

Exception: authenticated, order-eligible trade (or admin trade-test) actors
may receive `remainingQty` **only** in `FINAL_PART_CASE` mode.

Anonymous users continue to see only In / Low / Out bands and must **never**
receive exact remaining quantity in HTML/JSON/API responses.

### Stale stock

If positive stock is stale and Phase 5 policy withholds it, final-part-case
is **not** enabled.

## MOQ (normal case mode)

`getMinimumOrderQuantity` / `minimumCustomerOrderQuantity` returns the
smallest valid **case multiple** that satisfies `minOrderQty`.

Example: case 12 + MOQ 20 → minimum **24**.

## Stock

Uses Phase 5 `loadStockByVariantIds` / `getSellableQuantity`.

- Exact Avail never leaves the server in customer DTOs except final-part-case
  `remainingQty` for eligible actors
- Public bands remain IN / LOW / OUT
- Stale positive stock follows Phase 5 policy (not orderable)
- Basket lines are **not** inventory reservations — `qtyOnHand` /
  `qtyReserved` / Autopart sync are unchanged by basket mutations

## Pricing & VAT

Reuses `resolveVariantTradePrices` / `resolveTradePriceFromFacts`.

Quantity changes re-resolve prices (quantity breaks) at the **actual**
requested quantity — a final stock order of 7 does **not** receive a 12-unit
break simply because caseQty is 12.

Customer sell unit price: commercial resolution → 2dp sell unit
(`toCustomerSellUnitPrice`) → × quantity. Money uses `src/domain/money.ts`.

## PDP / catalogue

Trade Ordering (PDP) and catalogue list quick order share the same panel
engine (`getProductOrderingPanel` / `getCatalogueOrderingPanels`).

**Normal mode:** case stepper, default = minimum case quantity.

**Final stock mode:** amber FINAL STOCK callout with exact remaining,
unit stepper 1…N, default = N.

## Basket UI

- Route: `/portal/basket`
- Nav: portal **Basket** + header badge with **line count**
- Empty state, quantity ± by `quantityStep` (case or 1), remove, live totals

## Revalidation

On every basket load, lines are assessed:

| Issue | Meaning |
| --- | --- |
| `VALID` | OK |
| `QUANTITY_UNAVAILABLE` | Stock no longer covers quantity (e.g. final 7 → stock 5) |
| `INSUFFICIENT_FULL_CASE` | No orderable quantity under current rules |
| `CASE_CONFIGURATION_CHANGED` | caseQty / MOQ no longer fits quantity (e.g. part-case line after stock replenishes into normal case mode) |
| `PRODUCT_UNAVAILABLE` | Inactive / not trade-visible |
| `PRICE_UNAVAILABLE` | No resolvable trade price |

Lines are **not** silently deleted or quantity-mutated.

Duplicate add merges qty then re-validates against sellable (5 + 2 = 7 OK;
5 + 3 = 8 rejected when sellable is 7).

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
21. With sellable below one case: confirm FINAL STOCK controls and remaining qty
    for signed-in trade; anonymous still sees only stock bands.

## Phase 6B boundary

Not in 6A:

- checkout / draft Order creation
- payment / credit hold
- Autopart order file / email / API
- inventory reservation
- Quick Order bulk add backend

Phase 6B checkout **must** honour the same `resolveCustomerOrdering` /
`validateOrderQuantity` rules (including FINAL PART-CASE STOCK EXCEPTION).

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
