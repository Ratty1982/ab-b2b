# Trade price resolution

Commercial contract for Automotive Brands. All customer-facing trade prices
must flow through this engine. UI never computes discounts, list prices, or VAT.

## Resolver

```ts
resolveTradePrice({ variantId, companyId?, quantity?, at? })
```

`companyId` is derived from the authenticated session (trade membership or
authorised acting-as / price-as-customer). The browser cannot assert another
company’s price.

Catalogue grids use the **batch** loader (`loadTradePriceFacts` + domain
`resolveTradePriceFromFacts`) — not one query set per card.

## Sources

| Source | Meaning |
| --- | --- |
| `BASE` | `ProductVariant.tradePrice` |
| `PRICE_LIST` | `PriceListItem.unitPrice` on the company’s **assigned** list |
| `CUSTOMER` | In-window `CustomerPrice.unitPrice` for that company + variant |
| `QUANTITY_BREAK` | Volume **fixed unit price** (`QuantityBreak.unitPrice`) |
| `PROMOTION` | One eligible promotion applied to the commercial/volume price |
| `NONE` | No trade price available |

RRP is not a trade source. It remains public catalogue information.

## Precedence (deterministic)

**Commercial unit price** (highest wins, ignore row order):

1. **Customer-specific price** for `(companyId, variantId)` when `startsAt`/`endsAt` include `at` (open-ended if null).
2. Else **assigned price-list item** for that variant (`Company.priceListId`). Unassigned companies do **not** inherit `PriceList.isDefault`.
3. Else **base trade price**.

Then **quantity breaks** (not competing base prices):

- `QuantityBreak.unitPrice` is a **fixed unit price**, not a percent or amount-off.
- `minQty = 1` rows are the catalogue **base-price mirror** and are **not** volume breaks.
- Volume breaks: `minQty > 1` and `minQty <= requestedQuantity`.
- If several match, take the **highest** `minQty`, then lowest `id` on a tie.
- Apply the break **only if** its unit price is **strictly lower** than the commercial price (volume cannot worsen a negotiated price).
- Requested quantity is used as given. Phase 6 enforces full-case multiples; Phase 4 does not rewrite `minQty`.

Then **at most one promotion** (non-stacking):

- `isActive === true`
- `startsAt`/`endsAt` include `at` (null = unbounded)
- `QUANTITY_DEAL` is **not applied** in Phase 4A (needs order mechanics)
- `PERCENT`: `unit * (1 - value/100)` (`value` 10 = 10% off)
- `FIXED`: `unit - value` per unit (floor at 0)
- Scope: `metadata.variantIds` and/or `metadata.skus`. If both omitted, the promotion is **catalogue-wide**
- Among eligible promotions that **reduce** the unit price, pick the **lowest resulting unit price**, then earliest `startsAt` (null last), then `code` A–Z, then `id`
- Never stack percentages or combine with a second promotion

Expired, future, and inactive promotions never apply.

## VAT

- Product `vatCode`: `STANDARD` → 20%, `ZERO_RATED` → 0%.
- Company `taxStatus` `ZERO_RATED` | `EXEMPT` | `OUTSIDE_SCOPE` → 0% regardless of product code.
- Primary B2B display is **ex VAT**. Inc-VAT is calculated centrally for Phase 6 totals.

Do not assume 20% when `vatCode` or tax status says otherwise.

## Money and rounding

- Authoritative unit prices: **4 decimal places** (schema `Decimal(12,4)`). Example stored `8.6967`.
- Display GBP: **2 decimal places, half-up**. Example `£8.70`.
- Inc-VAT: `round_half_up(unitExVat * (1 + vatRate), 2)`.
- Do **not** overwrite stored 4dp values with display pennies.
- Domain math uses scaled integers (not IEEE `number`) for resolution.

One policy for product page, basket, checkout, invoice. The server is authoritative; UI formatting is presentation.

## Anonymous visitors

- Never receive customer, list, or promotional **trade** prices.
- Never inherit a price list.
- RRP remains visible. Trade is `null` / `source: hidden`.

## Authenticated trade customer

Resolve using **their** company (default membership). They see the resolved unit price, not the source breakdown, not another company’s `CustomerPrice`.

## Internal / acting-as / price-as-customer

- Staff browsing the public catalogue **without** acting context see **base** trade (if `pricing.view`), not a default customer list.
- Active acting context (`impersonation.order_for_customer`) resolves as that company.
- **Price as customer** (Product → Commercial) is a **read-only** diagnostic: `pricing.view` plus company access (`pricing.edit`, sales access, or admin). Ordinary trade users cannot preview another company. Preview does not mutate prices.

Internal explanation (admin only):

```
Base Trade Price
Price List
Customer Override
Quantity Break
Promotion
RESOLVED PRICE
```

## Trust boundary

The client must not supply: resolved unit price, discount, promotion amount, list price, customer price, VAT total. The server resolves. Phase 6 must snapshot the resolved values onto `OrderItem`.

## Case ordering

Phase 4 answers: **unit price for this customer and quantity**.  
Phase 6 answers: **is this quantity a full case?** (`qty % caseQty === 0`).  
Headline catalogue/PDP price remains the **unit** price; `caseQty` does not multiply it.

## Public API mapping

Customer-facing `DisplayPrice.source`:

| Internal | Public DTO |
| --- | --- |
| `NONE` / no permission | `hidden` |
| `BASE` | `base_catalogue` |
| `PRICE_LIST` | `price_list` |
| `CUSTOMER` | `customer` |
| `QUANTITY_BREAK` | `quantity_break` |
| `PROMOTION` | `promotion` |

`sourceLabel` / explanation stay off the public catalogue payload.
