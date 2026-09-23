# Admin Trade Test Level

Internal staff can browse the public catalogue and exercise Phase 6A ordering
against a **selected PriceList**, without customer impersonation.

## What it is

| Concept | Meaning |
| --- | --- |
| Trade Test Level | `User.tradeTestPriceListId` → an existing `PriceList` |
| Who | `INTERNAL` users with admin/pricing access |
| Where | Admin → **Settings** → Trade testing |
| Not | Customer impersonation, acting-as-company, or a fake CompanyUser |

## How it differs from customer pricing

| | Trade customer | Admin Trade Test Level |
| --- | --- | --- |
| Company | Real `CompanyUser` membership | **None** |
| Price list | `Company.priceListId` | Selected `tradeTestPriceListId` |
| CustomerPrice | Yes (company-scoped) | **Never loaded** |
| VAT | Company `taxStatus` + product `vatCode` | **STANDARD** company tax treatment + product `vatCode` |
| Basket | Company-owned OPEN basket | User-owned OPEN basket with `companyId = null` |

## Pricing resolver

`loadPricingActor` for INTERNAL returns:

- `companyId: null`
- `adminTestPriceListId: user.tradeTestPriceListId`

`resolveVariantTradePrices({ companyId: null, priceListId })` loads
`PriceListItem` for that list, then quantity breaks and generic promotions.
It does **not** query `CustomerPrice`.

## VAT treatment

With no real company, the resolver uses a synthetic STANDARD tax status
(`companyTaxStatus` defaults to STANDARD when absent). Product
`vatCode = ZERO_RATED` (etc.) still zeroes VAT. Real customer exemptions are
never inherited.

## Basket isolation

Admin test baskets:

- `Basket.companyId = null`
- `Basket.userId = admin user id`
- Looked up by `{ userId, companyId: null, status: OPEN }`

Company trade baskets remain `{ companyId, status: OPEN }`. Customers cannot
see admin test baskets; admins cannot open a customer basket through this path.

## Stock & case rules

Unchanged Phase 5 / 6A behaviour: Autopart Avail, availability badges,
full-case validation, MOQ. Exact stock is not shown on the public PDP.

## Security

- `priceListId` is **never** accepted on Add to Basket / price APIs from the
  browser. The server loads `User.tradeTestPriceListId`.
- TRADE users cannot call `setMyTradeTestLevel`.
- Changing the level writes audit action
  `user.trade_test_price_list.updated` (old/new list ids and names only).

## Checkout / Autopart

Admin test baskets **do not** create Orders, reserve stock, or submit to
Autopart. Phase 6B will decide checkout rules separately.

## Future

A later “Order as Customer” flow can use ActingContext. Trade Test Level stays
the lightweight way to verify PriceLists and quantity breaks without touching
real customer accounts.
