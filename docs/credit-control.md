# Trade credit control & order approval

Automotive Brands B2B is **not** the accounting system. Autopart/MAM remains authoritative for ledger exposure via **407P100**.

AB uses imported credit snapshots plus **pending AB orders** so checkout never loses a customer order for credit reasons.

## Authority

| Source | Role |
|--------|------|
| `AutopartCreditPosition` (407P100) | Authoritative imported credit limit / total exposure / available raw |
| `Company.creditLimit` | Legacy/admin field — **not** used for automatic approval when a 407P100 snapshot exists |
| 561L / SLRB history | **Never** used in credit decisions |

AB **never** mutates `AutopartCreditPosition` when an order is placed.

## Order credit requirement

**`orderCreditRequirement` = Order `grandTotal` (goods + delivery + VAT).**

Autopart trade-account exposure is a gross charge to the customer account. Comparing available credit to an ex-VAT amount would understate credit use.

## Credit applicability

`isCreditControlApplicable(...)`:

- **Not applicable** when payment terms clearly indicate prepaid/cash/card/COD/proforma.
- **Applicable** when the company has a verified Autopart account, an imported credit position, or free-text terms that look like credit days (`30 Days`, `30 Days EOM`, `Net 30`, etc.).

Result status `NOT_REQUIRED` skips hold/review and does not block Autopart export for credit.

## Decision service

Central: `evaluateOrderCredit` in `src/server/orders/credit-control.ts`.

Used by:

- basket `placeOrder`
- quote → order `convertQuoteToOrder`

Returns structured `OrderCreditDecision` (status, reason, snapshots, over-by).

## Effective available credit

```
Imported Available Credit   = AutopartCreditPosition.availableCreditRaw
                            = creditLimit − totalExposure (from 407P100)

Pending AB Exposure         = Σ grandTotal of APPROVED credit orders
                              for the company with placedAt > sourceImportedAt
                              and status ≠ CANCELLED

Effective Available Credit  = Imported Available − Pending AB Exposure
```

**HOLD / REVIEW_REQUIRED orders do not consume pending approved exposure** until staff release them to `APPROVED`.

## Snapshot on the order

Persisted at create (audit trail):

- `creditStatus`, `creditDecisionReason`
- limit / Autopart exposure / imported available / pending / effective
- `orderCreditRequirement`, `creditOverBy`
- `creditCheckedAt`, `creditSourceImportedAt`

## Automatic outcomes

| Situation | `creditStatus` | Reason |
|-----------|----------------|--------|
| Within / exact effective available | `APPROVED` | `WITHIN_AVAILABLE_CREDIT` |
| Exceeds effective available | `HOLD` | `EXCEEDS_AVAILABLE_CREDIT` |
| Account already over limit (raw &lt; 0) | `HOLD` | `ACCOUNT_ALREADY_OVER_CREDIT_LIMIT` |
| No 407P100 | `REVIEW_REQUIRED` | `CREDIT_INFORMATION_NOT_AVAILABLE` |
| Stale 407P100 (&gt;7 days) | `REVIEW_REQUIRED` | `CREDIT_INFORMATION_STALE` |
| Prepaid / N/A | `NOT_REQUIRED` | `CREDIT_CONTROL_NOT_APPLICABLE` |

**Order is always created** when normal validation succeeds. Customer receives `ORDER_RECEIVED`.

## Manual release

Permission: `orders.credit.approve` (Super Admin, Management, Accounts, Sales Manager).

Staff confirm with a required note → `APPROVED`, store actor/time/note, audit `order.credit_released`.

Does **not** recreate the order, reprice, re-reserve, or resend `ORDER_RECEIVED`.

## Autopart export

`HOLD` and `REVIEW_REQUIRED` → block reason `CREDIT_APPROVAL_REQUIRED` (server-side).

Bulk export: eligible orders export; credit-held orders are **skipped with an explicit report** (never silent).

## New 407P100 reconciliation

407P100 is **aggregate** and does not identify individual AB orders.

Rule used:

> APPROVED AB orders with `placedAt` **after** `AutopartCreditPosition.sourceImportedAt` count as pending exposure.  
> When a **newer** 407P100 is imported, that timestamp advances and older AB orders drop out of pending (Autopart’s new total is authoritative).

**Limitation:** `sourceImportedAt` is the AB import time of the report, not necessarily Autopart’s internal report generation time. Documented as conservative for this manual-import phase.

### Bulk manual import interaction

Central bulk import (Settings → Autopart → Customer credit) upserts `AutopartCreditPosition` via the same authority model. `evaluateOrderCredit` immediately uses the new snapshot — no duplicate credit math in the importer.

Pending AB exposure continues to use the rule above (imported available minus qualifying pending APPROVED exposure). Imported 407P100 values are never adjusted for AB orders.

### Held / review orders after import

After a successful bulk (or per-customer) 407P100 import, existing `HOLD` / `REVIEW_REQUIRED` orders are **not** auto-released and **not** auto-exported.

Admin derives a live indicator via `evaluateHeldOrderCreditNow`:

- If the order would now `APPROVE` under current credit → show **Credit now available — review and release** (or for previous missing data: **Credit information now available — review and release**)
- Stored `creditStatus` remains `HOLD` / `REVIEW_REQUIRED` until staff with `orders.credit.approve` releases it

Dashboard Credit Hold / Credit Review attention lists surface the same positive indicator where useful.

## Concurrency

Credit evaluation + order create run inside an interactive transaction after `SELECT … FOR UPDATE` on the company row, so two concurrent checkouts cannot both auto-approve against the same available capacity.

## Reservations & backorders

Credit hold is independent of fulfilment:

- Stock reservations remain (order was accepted).
- Backorder splits remain.
- Credit does not cancel or timeout held orders in this phase.

## Quotes

Quote commercial snapshots stay authoritative. Credit is evaluated **at conversion** with current 407P100 + pending exposure. Over-limit acceptance still creates the AB order on `HOLD`.

## Freshness

Same as Autopart history phase: `CURRENT` | `STALE` (&gt;7 days) | `NOT_AVAILABLE`.  
Scheduled 407P100 ingestion is **out of scope** here — future automation must call the bulk import service in `src/server/companies/autopart-credit-bulk.ts`.

## Key modules

- `src/domain/order-credit.ts`
- `src/server/orders/credit-control.ts`
- `src/server/companies/autopart-credit-bulk.ts`
- `docs/credit-control.md`
- Related: `docs/autopart-customer-history.md`
