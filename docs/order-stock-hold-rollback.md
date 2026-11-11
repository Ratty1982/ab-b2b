# Hold-until-complete — rollback / disable safety

## Export protection rule

While any order has `stockHoldState = WAITING_STOCK` (or `stockReleasePolicy = HOLD_UNTIL_COMPLETE` without `READY_TO_EXPORT` / `CANCELLED_HOLD`), Autopart CSV export **must** remain blocked in `assessOrder` via `blocksAutopartExportForStockHold`.

Removing that gate without clearing holds **fails open** and can export incomplete orders.

## Safe disable / rollback sequence

1. List held orders (Admin Orders filter / `listHeldOrders`).
2. Either wait until stock release, or **cancel holds** with permission + reason (sets `CANCELLED_HOLD` — intentionally exportable again only if staff accept that policy), **or** cancel the orders themselves if business rules require.
3. Confirm zero rows:  
   `SELECT COUNT(*) FROM "Order" WHERE "stockHoldState" = 'WAITING_STOCK';`
4. Only then remove UI / evaluator / email code. Prefer **keeping** the one-line export gate until the columns are dropped in a later migration.
5. Drop columns only after no held rows remain and a release/hotfix window is agreed.

## Emergency SQL (ops only — not for routine use)

```sql
-- Audit first
SELECT id, "orderNumber", "stockHoldState", "stockReleasePolicy", "stockHeldAt"
FROM "Order"
WHERE "stockHoldState" = 'WAITING_STOCK';

-- Cancel active holds (does not delete orders; export may become allowed)
UPDATE "Order"
SET
  "stockHoldState" = 'CANCELLED_HOLD',
  "stockHoldReleasedAt" = NOW(),
  "stockHoldReleaseReason" = 'OPS_ROLLBACK_CANCEL_HOLD'
WHERE "stockHoldState" = 'WAITING_STOCK';
```

Never force-export `WAITING_STOCK` orders as a shortcut.
