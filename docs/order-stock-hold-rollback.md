# Hold-until-complete — rollback / disable safety

## Export protection rule

While any order has `stockHoldState = WAITING_STOCK`, or `stockReleasePolicy = HOLD_UNTIL_COMPLETE` without a verified `READY_TO_EXPORT` release, Autopart CSV export **must** remain blocked in `assessOrder` via `blocksAutopartExportForStockHold`.

`CANCELLED_HOLD` is exportable only after the cancellation also sets `stockReleasePolicy = SHIP_AS_AVAILABLE`. Leaving the policy on `HOLD_UNTIL_COMPLETE` keeps the order blocked.

Removing that gate without clearing holds **fails open** and can export incomplete orders.

## Safe disable / rollback sequence

1. List held orders (Admin Orders filter / `listHeldOrders`).
2. Either wait until stock release, or **cancel holds** with permission + reason (sets `CANCELLED_HOLD` and `stockReleasePolicy = SHIP_AS_AVAILABLE`), **or** cancel the orders themselves if business rules require.
3. Confirm zero rows:  
   `SELECT COUNT(*) FROM "Order" WHERE "stockHoldState" = 'WAITING_STOCK';`
4. Only then remove UI / evaluator / email code. Prefer **keeping** the one-line export gate until the columns are dropped in a later migration.
5. Drop columns only after no held rows remain and a release/hotfix window is agreed.

## Emergency SQL (ops only — not for routine use)

```sql
-- Audit first. Do not use this to hold or export a live order.
SELECT id, "orderNumber", "stockHoldState", "stockReleasePolicy", "stockHeldAt"
FROM "Order"
WHERE "stockHoldState" = 'WAITING_STOCK';

-- Cancel active holds (does not delete orders).
-- SHIP_AS_AVAILABLE is required. CANCELLED_HOLD with HOLD_UNTIL_COMPLETE stays unexportable.
UPDATE "Order"
SET
  "stockHoldState" = 'CANCELLED_HOLD',
  "stockReleasePolicy" = 'SHIP_AS_AVAILABLE',
  "stockHoldCancelledAt" = NOW(),
  "stockHoldCancelReason" = 'OPS_ROLLBACK_CANCEL_HOLD'
WHERE "stockHoldState" = 'WAITING_STOCK';
```

Never force-export `WAITING_STOCK` orders as a shortcut.
