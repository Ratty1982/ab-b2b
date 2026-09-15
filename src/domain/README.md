# Domain layer

Pure business rules for Automotive Brands.

## Rules

- No React imports
- Prefer no direct Prisma / HTTP / filesystem imports in core rules
- Accept plain data in, return plain data out
- Never trust client-supplied prices, discounts, VAT, credit, stock, or permissions

## Intended contents (later phases)

- Pricing resolution (RRP / price list / customer override / quantity breaks)
- Credit checks
- Order / quote totals
- Trade application state transitions
- RBAC decision helpers (pure)

Phase 0 only establishes the boundary. Mock data remains in `src/lib/` until later phases migrate screens.
