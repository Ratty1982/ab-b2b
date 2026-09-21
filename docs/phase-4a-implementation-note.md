# Phase 4A — Implementation note (audit)

Authoritative source: current Prisma schema and server code on
`production/phase-1-auth-rbac`. This is not the original Phase 0 sketch.

## What exists today

### Stored commercial data

| Entity | Role |
| --- | --- |
| `ProductVariant.tradePrice` `Decimal(12,4)` | Base trade price (also called baseTradePrice in import JSON). |
| `ProductVariant.rrp` `Decimal(12,2)` | Public RRP. |
| `ProductVariant.vatCode` | `STANDARD` (20%) or `ZERO_RATED` (0%). |
| `Company.priceListId` | Assigned reusable price list. |
| `Company.taxStatus` | `STANDARD` / `ZERO_RATED` / `EXEMPT` / `OUTSIDE_SCOPE`. |
| `Company.currency` | Default `GBP`. |
| `PriceList` + `PriceListItem.unitPrice` | List of variant unit prices. Unique `(priceListId, variantId)`. No `isActive`. |
| `CustomerPrice.unitPrice` + `startsAt`/`endsAt` | Negotiated company+variant price. Unique `(companyId, variantId)`. |
| `QuantityBreak.minQty` + `unitPrice` | **Fixed unit price** at a quantity threshold, unique `(variantId, minQty)`. No `isActive`, no percent type. Catalogue save/import **mirrors base trade as `minQty = 1`**. |
| `Promotion` | `type` = `PERCENT` \| `FIXED` \| `QUANTITY_DEAL`, `value`, `startsAt`, `endsAt`, `isActive`, `metadata` JSON. **No product FK** — scope lives in metadata if present. |

`Order` / `OrderItem` already snapshot `unitPrice`, `vatRate`, `lineTotal`. Historical orders must not re-resolve live prices (Phase 6).

### Current runtime pricing

`src/server/pricing/trade-price.ts` `resolveDisplayPrice()`:

- Anonymous / no `pricing.view|products.view|admin.access` → `trade: null`, `source: "hidden"`. RRP still public.
- Signed-in with permission → **base `ProductVariant.tradePrice` only**.
- Does **not** read PriceList, CustomerPrice, QuantityBreak, or Promotion.

Public catalogue cards and product detail both go through `toPublicCard` → `resolveDisplayPrice`.

### Admin / RBAC / audit

- Product → Commercial already edits base trade, RRP, VAT, pack/case, unit, dimensions. **Keep it.**
- `/admin/pricing` is still **mock data** (`src/lib/data`, `priceGroups`).
- Company Commercial already assigns `priceListId` (server-guarded by `pricing.edit`).
- Permissions: `pricing.view`, `pricing.edit`. Trade buyers can view their price; they cannot edit lists.
- Acting context (`impersonation.order_for_customer`) exists for sales; pricing does not yet use it.
- Audit helper `recordAuditEvent` exists; pricing CRUD is not audited yet.

## Schema decision

**No Prisma migration in Phase 4A.** Existing models already express:

- base / list / customer / quantity-break / promotion
- company ↔ price list
- customer-price validity windows
- promotion validity + active flag
- VAT codes and company tax status

Missing `PriceList.isActive` and `QuantityBreak.isActive` are documented limitations, not blockers. Unassigned companies use base trade (we do **not** auto-apply `PriceList.isDefault`).

## What Phase 4A changes

1. Pure domain resolver with deterministic precedence (Decimal-scale money, not IEEE floats).
2. Server batch loader so catalogue grids do not N+1 commercial lookups.
3. Wire catalogue + product detail through that resolver (no UX redesign).
4. Real price-list / list-item / customer-price / promotion / quantity-break services + audit.
5. Price-as-customer diagnostic on Product → Commercial (preview only).
6. Replace mock `/admin/pricing` with live CRUD (same route, no new nav).

Out of scope: basket, checkout, Autopart, catalogue redesign, case-qty validation (Phase 6).
