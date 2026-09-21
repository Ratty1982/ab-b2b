# Phase 6 — ProductOrderPanel (plan only)

This document is the intended future ordering UI. **Do not implement the
controls in the current phase.** The product hero is already structured so
this panel can mount under the short description without a redesign.

## Where it mounts

`ProductDetailHero` summary column, after:

1. brand  
2. H1 product name  
3. SKU  
4. availability  
5. **unit** trade price (`YOUR PRICE · EACH · EX VAT`)  
6. RRP  
7. short description  

Then: **ProductOrderPanel**.

Do not render an empty bordered placeholder in the meantime.

## Business rule

Customers order **full cases only**. `ProductVariant.caseQty` is the customer
quantity increment.

| caseQty | Valid quantities |
| --- | --- |
| 2 | 2, 4, 6, 8, … |
| 6 | 6, 12, 18, 24, … |
| 1 | 1, 2, 3, 4, … |

The UI stepper and any manual input must step by `caseQty`. The **server**
must re-validate independently:

```text
requestedQuantity % caseQty === 0
requestedQuantity >= caseQty
```

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
| Panel | 1 case · 2 units · £17.40 ex VAT · £20.88 inc VAT (20%) |

## Target UI (not built)

```text
TRADE ORDERING

CASE OF 2
Sold in full cases

Quantity
[ − ]     2     [ + ]

1 case · 2 units

£17.40 ex VAT
£20.88 inc VAT

[ ADD TO BASKET ]
```

Initial quantity = `caseQty`. Plus/minus changes quantity by `caseQty`.

The lower-page Trade Ordering summary (`CASE OF 2` / `Sold in multiples of 2`)
can stay until Phase 6 decides whether the panel makes it redundant.

See `src/domain/case-ordering.ts` (`PRODUCT_ORDER_PANEL_PLAN`,
`isValidCustomerOrderQuantity`).
