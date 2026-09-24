# Domain layer

Pure business rules for Automotive Brands.

## Rules

- No React imports
- Prefer no direct Prisma / HTTP / filesystem imports in core rules
- Accept plain data in, return plain data out
- Never trust client-supplied prices, discounts, VAT, credit, stock, or permissions

## Case ordering (Phase 6A)

Trade customers normally order **full cases**. `ProductVariant.caseQty` is the
customer order multiple when populated. `packQty` is the sale-unit contents
and is not interchangeable with case quantity. Stored `orderIncrement` is
internal and must not be used as the public increment when `caseQty` exists.

Normal mode (`sellable ≥ caseQty`):

- initial quantity and +/− steps = `caseQty`
- `requestedQuantity % caseQty === 0`
- server, basket, checkout, and API must all enforce the same rule

**FINAL PART-CASE STOCK EXCEPTION** (`0 < sellable < caseQty`): allow 1…sellable
in steps of 1 (MOQ overridden). See `resolveCustomerOrdering` in
`src/domain/ordering.ts` and `docs/phase-6a-ordering-basket.md`.

See `docs/trade-price-resolution.md` for the Phase 4A commercial price engine.
See `src/domain/case-ordering.ts` and `docs/phase-6-product-order-panel.md` for
quantity rules. The product hero shows the **unit** trade price.


## Intended contents (later phases)

- Pricing resolution (RRP / price list / customer override / quantity breaks)
- Credit checks
- Order / quote totals
- Trade application state transitions
- RBAC decision helpers (pure)

Phase 0 only establishes the boundary. Mock data remains in `src/lib/` until later phases migrate screens.
