# Sales history cutover for new customers (SENCO incident)

**Repo:** Ratty1982/ab-b2b  
**Date:** 2026-11-06 (Europe/London)  
**Incident:** SENCO / AB-000014 / SS307451 → `HISTORY_CUTOVER_INCOMPLETE`

## Root cause

Becoming **ACTIVE** and verifying an Autopart code does **not** create or complete `CustomerSalesCutover`.

Ongoing 504/TRM21QC writes require all of:

1. Company `ACTIVE`
2. Uniquely verified Autopart account
3. `CustomerSalesCutover.historyStatus === COMPLETE`

SENCO was Active, verified, and ordered successfully. Cutover was still missing / incomplete. The daily import therefore recorded `HISTORY_CUTOVER_INCOMPLETE` diagnostics and **did not store** `AutopartSalesDocument` / `AutopartSalesLine` rows for SS307451. Without persisted 504+TRM evidence, fulfilment never marked AB-000014 dispatched and Sales Enquiry stayed empty.

Ineligible diagnostics deliberately **redact** SKU, quantity, and sales net. Recovery cannot invent those values from diagnostics alone.

## Product rule

| Inventory of history | Staff action | Cutover evidence |
|----------------------|--------------|------------------|
| Brand-new Autopart customer, no historical sales | Explicit confirmation + typed verified account + reason | `NO_HISTORICAL_SALES` |
| Existing Autopart customer with history | 561L/SLRB import (unchanged) | `561L_SLRB` / review ack |

Do **not** silently mark every new company as zero-history.

## Wizard change

The customer setup wizard Sales history step is now a **baseline** step:

- Option A — brand-new / no historical sales (existing `completeCustomerSalesCutoverWithoutHistory`)
- Option B — historical import (existing workflow)

When the account is Active and Autopart-verified, **Continue is blocked** until cutover is `COMPLETE`.

## Read-only diagnostic

```bash
bun run scripts/diagnose-sales-cutover.ts \
  --company cmw3dyor8000xnx014idu4rys \
  --order AB-000014 \
  --document SS307451
```

Also available to staff via `diagnoseSalesCutoverIncidentFn`.

## Safe SENCO recovery (production operator)

Do not run recovery against production from development agents without operator confirmation.

1. Run the diagnostic against production (readonly). Confirm verified Autopart code, cutover state, skipped diagnostics, order status, and dispatch-email history.
2. If cutover is incomplete and there is **no** imported sales evidence, complete zero-history baseline for SENCO (`NO_HISTORICAL_SALES`) with operator reason and typed Autopart account.
3. Obtain the original 504 and TRM21QC source files that contain **SS307451** (mailbox / archive). Diagnostics are not a substitute.
4. Call **preview** skipped-invoice recovery with **required** `documentReference=SS307451` (and `orderNumber=AB-000014` when using TRM-only evidence). Preview lists out-of-scope invoices that will be skipped at persistence, and marks fulfilment as `PENDING_AFTER_IMPORT` until evidence is stored.
5. Confirm recovery with `suppressDispatchEmail=true` (default). Import + fulfilment share one exclusive lock so a concurrent scheduled run cannot queue dispatch email mid-recovery. Only SS307451 is persisted; fulfilment runs only for verified company-owned AB orders.
6. Verify Sales Enquiry for SENCO and order status. Do not manually fabricate invoice or despatch rows. Do not resend dispatch email.

### Recovery safety invariants

- Never omit `orderIds` — empty match fails closed (no unfiltered fulfilment).
- `documentReferences` is enforced in the ongoing importer persistence path (`DOCUMENT_OUT_OF_SCOPE`).
- Concurrent fulfilment callers wait their turn; recovery never joins an unrelated in-flight promise or loses email suppression.
- Preview does not claim a dispatch transition before matching stored evidence exists.

## Explicit non-goals

- No automatic zero-history for all new companies
- No changes to existing customers’ completed cutovers
- No invention of sales or despatch data
- No automatic resend of dispatch email for already-delivered orders
- No merge / deploy from this agent
