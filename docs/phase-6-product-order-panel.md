# Phase 6 — Product ordering UI

Phase **6A** implements persistent baskets and Add to Basket. The interactive
**Trade Ordering** controls live in the product hero (right column), directly
beneath the short description. There is a single primary purchasing interface —
do not duplicate it lower on the page.

See [phase-6a-ordering-basket.md](./phase-6a-ordering-basket.md).

## Business rule

### NORMAL CASE ORDERING

Customers order **full cases** when sellable stock is at least one complete
case. `ProductVariant.caseQty` is the customer quantity increment.

| caseQty | Valid quantities |
| --- | --- |
| 2 | 2, 4, 6, 8, … |
| 6 | 6, 12, 18, 24, … |
| 1 | 1, 2, 3, 4, … |
| 12 | 12, 24, 36, … |

Example with sellable 17 and caseQty 12: only **12** is valid — not 13–17.

The UI stepper and any manual input must step by `caseQty`. The **server**
must re-validate independently:

```text
requestedQuantity % caseQty === 0
requestedQuantity >= minimum case-multiple (MOQ aware)
requestedQuantity <= max full-case quantity from sellable Autopart Avail
```

### FINAL PART-CASE STOCK EXCEPTION

When `0 < sellable < caseQty` (trusted/current stock only):

```text
valid quantity = integer between 1 and sellable
step = 1
default quantity = sellable
MOQ overridden
```

Do not use `orderIncrement`. Exact remaining may be shown only to
authenticated order-eligible trade customers in this mode.

Clients cannot be trusted to enforce this.

`packQty` is sale-unit contents, not the customer order step.
`orderIncrement` remains internal Commercial data.

## Unit price vs order total

The catalogue / hero price is always the **unit** trade price. Never multiply
the hero figure by `caseQty`.

Example when unit trade = £8.70 and `caseQty` = 2:

| Surface | Copy |
| --- | --- |
| Hero | £8.70 · YOUR PRICE · EACH · EX VAT · RRP £17.99 |
| Trade Ordering | 1 case · 2 units · £17.40 ex VAT |

## Target UI (Phase 6A)

### Normal case mode

```text
TRADE ORDERING

CASE OF 2
Sold in multiples of 2

£8.70 each ex VAT

Quantity
[ − ]     2     [ + ]

1 case · 2 units

£17.40 ex VAT

[ ADD TO BASKET ]
```

Initial quantity = minimum valid case multiple. Plus/minus changes quantity by
`caseQty`. Exact stock is not shown when sellable ≥ caseQty.

### Final part-case mode

```text
TRADE ORDERING

CASE OF 12
Normally sold in multiples of 12

FINAL STOCK
Only 7 remaining
Final stock can be ordered as individual units.

Quantity
[ − ]     7     [ + ]

7 units

TOTAL £xx.xx ex VAT

[ ADD TO BASKET ]
```

Helpers: `src/domain/case-ordering.ts`, `src/domain/ordering.ts`
(`resolveCustomerOrdering`), `src/server/basket/service.ts`.
