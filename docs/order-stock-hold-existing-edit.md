# Hold until complete on an existing order

## What went wrong

New orders saved `stockReleasePolicy = HOLD_UNTIL_COMPLETE` and `stockHoldState = WAITING_STOCK` inside `commitSubmittedOrder`.

Editing an existing order used `amendSubmittedSalesOrder`. That path updated lines, prices, and reservations, and it accepted the hold checkbox, but it never wrote the hold columns. The order stayed `SHIP_AS_AVAILABLE` / `NONE` and remained on the Autopart READY list.

Customer backorder acknowledgement is a separate field and was already saved.

## Export rule

An order with `stockReleasePolicy = HOLD_UNTIL_COMPLETE` can be exported only when `stockHoldState = READY_TO_EXPORT` and the release was written by the trusted stock check (`stockReleasedAt` plus `STOCK_SYNC_FULL_COVERAGE`, `MANUAL_RETRY_FULL_STOCK`, or `PLACED_WITH_FULL_STOCK`).

`WAITING_STOCK`, `NONE`, `CANCELLED_HOLD`, and `READY_TO_EXPORT` without that evidence stay blocked while the policy is still `HOLD_UNTIL_COMPLETE`.

Cancelling a hold sets `stockReleasePolicy = SHIP_AS_AVAILABLE` and `stockHoldState = CANCELLED_HOLD`, with a reason and an audit row. Unchecking the box on a later edit does not clear an active hold.

The CSV export locks the order row and reads it again inside the same transaction before writing a batch.

## Read-only diagnostic

`diagnoseStockHoldExport` does not update rows. Pass an order id, an AB order number, or a customer PO. PO values are not unique: every match is returned.

It reports persisted policy, persisted hold state, order status, export status, export batch rows, current export eligibility, and whether a backordered order is still exportable because no hold is stored.

## Remediation after this fix is deployed

Do not run SQL to force the hold, and do not export the order.

1. Deploy this change. Do not merge or deploy from the agent that opened the pull request.
2. Diagnose the order by id (preferred) or PO. If the PO matches more than one order, use the order id from the report.
3. If policy is already `HOLD_UNTIL_COMPLETE` and state is `WAITING_STOCK`, no data fix is required. Confirm it is absent from Admin Orders READY and that export is refused.
4. If the hold was not stored, the order is still submitted, and it has not been exported, invoiced, or despatched:
   - Sales order edit: open the order, tick **HOLD ORDER UNTIL ALL STOCK IS AVAILABLE**, confirm the customer backorder acknowledgement, and save. The order number, customer, and prices stay. Reservations are reconciled to the available quantity only.
   - Or, on the order page, use **Hold until all stock is available** and enter a reason. That action does not reprice the lines and does not change reservations.
5. Confirm the order shows **HELD — AWAITING STOCK**, is excluded from READY, and a direct or bulk export is refused.
6. Leave release to the trusted stock sync or **Retry stock check**. Do not mark the order ready because the screen shows available stock.

An exported, dispatched, or invoiced order cannot be held after the fact. If an export file already exists, deal with that file in Autopart. Do not put a retrospective hold on it.
