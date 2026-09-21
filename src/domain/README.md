# Domain layer

Pure business rules for Automotive Brands.

## Rules

- No React imports
- Prefer no direct Prisma / HTTP / filesystem imports in core rules
- Accept plain data in, return plain data out
- Never trust client-supplied prices, discounts, VAT, credit, stock, or permissions

## Full-case ordering (Phase 6)

Trade customers order **full cases only**. `ProductVariant.caseQty` is the
customer order multiple when populated. `packQty` is the sale-unit contents
and is not interchangeable with case quantity. Stored `orderIncrement` is
internal and must not be used as the public increment when `caseQty` exists.

When basket/checkout is implemented:

- initial quantity and +/− steps = `caseQty`
- `requestedQuantity % caseQty === 0`
- server, basket, checkout, and API must all enforce the same rule

See `src/domain/case-ordering.ts`. Do not implement basket controls yet.


## Intended contents (later phases)

- Pricing resolution (RRP / price list / customer override / quantity breaks)
- Credit checks
- Order / quote totals
- Trade application state transitions
- RBAC decision helpers (pure)

Phase 0 only establishes the boundary. Mock data remains in `src/lib/` until later phases migrate screens.
