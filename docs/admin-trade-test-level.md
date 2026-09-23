# Admin Trade Test Level

Internal staff can browse the public catalogue and exercise Phase 6A ordering
against either the **Default Trade Price** (`ProductVariant.tradePrice`) or a
**named PriceList**, without customer impersonation.

## What it is

| Concept | Meaning |
| --- | --- |
| Mode | `User.tradeTestPricingMode`: `NONE` · `BASE_TRADE` · `PRICE_LIST` |
| Price list | `User.tradeTestPriceListId` — only when mode is `PRICE_LIST` |
| Who | `INTERNAL` users with admin/pricing access |
| Where | Admin → **Settings** → Trade testing |
| Not | Customer impersonation, acting-as-company, or a fake CompanyUser |

**Not** the same as “Default price group for new accounts” (that assigns a
PriceList to **new trade customers**).

## Modes

| Mode | Ordering | Pricing |
| --- | --- | --- |
| `NONE` | Disabled | N/A |
| `BASE_TRADE` | Enabled | Phase 4 uses `ProductVariant.tradePrice` (catalogue import `trade` column) |
| `PRICE_LIST` | Enabled | Selected `PriceList` / `PriceListItem`, then base fallback |

`NONE` is the safe schema default. Selecting **Default Trade Price** in Admin
sets `BASE_TRADE` explicitly — null is not overloaded.

## How it differs from customer pricing

| | Trade customer | Admin Trade Test |
| --- | --- | --- |
| Company | Real `CompanyUser` membership | **None** |
| Price source | Company PriceList + CustomerPrice | `BASE_TRADE` or selected PriceList |
| CustomerPrice | Yes (company-scoped) | **Never loaded** |
| VAT | Company `taxStatus` + product `vatCode` | Synthetic **STANDARD** + product `vatCode` |
| Basket | Company-owned OPEN basket | User-owned OPEN basket with `companyId = null` |

## Pricing resolver

`loadPricingActor` for INTERNAL returns:

- `companyId: null`
- `adminTestPricingMode` from `User.tradeTestPricingMode`
- `adminTestPriceListId` only when mode is `PRICE_LIST`

`resolveVariantTradePrices` with `adminTestActive: true` and no company:

- `BASE_TRADE` → no PriceListItem → source `BASE` from `tradePrice`
- `PRICE_LIST` → PriceListItem for the selected list, then base fallback
- Quantity breaks and generic (non-company) promotions still apply
- CustomerPrice is never queried

## VAT treatment

Synthetic STANDARD tax status for admin test contexts. Product
`vatCode = ZERO_RATED` (etc.) still zeroes VAT. Real customer exemptions are
never inherited.

## Basket isolation

Admin test baskets:

- `Basket.companyId = null`
- `Basket.userId = admin user id`
- Looked up by `{ userId, companyId: null, status: OPEN }`
- Re-priced on load when the admin changes mode/list (no frozen line prices)

## Stock & case rules

Unchanged Phase 5 / 6A behaviour: Autopart Avail, availability badges,
full-case validation, MOQ.

## Security

- Mode / list id are **never** accepted on Add to Basket / price APIs from the
  browser. The server loads the authenticated user’s persisted setting.
- TRADE users cannot call `setMyTradeTestLevel`.
- Changing the level writes audit action
  `user.trade_test_pricing_mode.updated` (old/new mode, list ids/names only).

## Checkout / Autopart

Admin test baskets **do not** create Orders, reserve stock, or submit to
Autopart. Phase 6B will decide checkout rules separately.

## Future

A later “Order as Customer” flow can use ActingContext. Trade Test Level stays
the lightweight way to verify base trade prices, PriceLists, and quantity
breaks without touching real customer accounts.
