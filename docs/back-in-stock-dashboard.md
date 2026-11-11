# Back in Stock dashboard

Admin dashboard section for products that **genuinely returned** from confirmed zero Autopart Avail to positive available stock.

## Architecture

| Concern | Choice |
| --- | --- |
| Source | 231PO3NEW **Avail** via `applyStockFeed` → `Inventory.qtyOnHand` |
| History | Durable `StockBackInStockEvent` (not ad-hoc `StockSyncChange` queries) |
| Idempotency | `@@unique([runId, variantId])` + `createMany({ skipDuplicates: true })` |
| Detection | Prior Inventory confirmed `qtyOnHand === 0` → new Avail `> 0` |
| Display qty | `getEffectiveSellableQuantity` (manual override − reserved) |
| Gate | `canSeeStock` (`inventory.view` / `products.view` / `admin.access`) |

**Never confuse Physical Stock with Avail.** Transition detection ignores Physical Stk, Stk, Pick Qty, and manual overrides. Overrides only change the **shown** current sellable quantity.

## Ops diagnostics

- Event missing after a live sync: confirm prior Inventory existed at 0 (first confirmation is not BIS), product is ACTIVE + trade-visible, SKU uniquely matched, run was live (not dry-run).
- Duplicate worry: unique constraint on `(runId, variantId)` prevents duplicates within a run; unchanged Avail does not write a second event.
- Dashboard empty while events exist: current Avail may be 0 again, stock may be stale, or product no longer trade-visible.

## Rollback

1. Hide UI by reverting dashboard panel / route (events remain harmless).
2. Or drop `StockBackInStockEvent` via a reverse migration after UI removal.
3. Recording is additive and does not alter Inventory quantities.
