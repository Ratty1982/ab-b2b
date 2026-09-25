# Autopart 504C invoice / despatch feed

Framework for reconciling Autopart report **504C — Listing of Invoices and Credits by Customer** with Automotive Brands B2B orders.

## CRITICAL — automatic import DISABLED by default

Autopart has **not** yet configured the scheduled 504C report emails.

| Setting | Default |
| --- | --- |
| Status | NOT CONFIGURED / DISABLED |
| Automatic polling | **OFF** |
| `Autopart504cFeedSettings.enabled` | `false` |
| Schedule capability | 13:00 · 16:00 Europe/London (working days) |

Do **not** enable during migration, deployment, or bootstrap. Enable only in a later task after Autopart confirms the report email.

Admin → Settings → **Autopart invoice / despatch feed** shows this clearly. **Poll mailbox now** is blocked while disabled. Use **Upload 504C test file** (dry-run) for safe parser testing.

## Full lifecycle

```text
AB order placed → RECEIVED
→ staff Export Autopart CSV → PROCESSING (+ export metadata)
→ manual MAM Autopart import
→ warehouse pick / invoice in Autopart
→ Autopart emails 504C (future)
→ AB imports 504C
→ Customer Order Number = AB-###### exact match
→ Autopart invoice linked to AB order
→ PROCESSING → DESPATCHED
→ ORDER_DESPATCHED customer email
```

There is **no APC integration** in this workflow.

## Reconciliation key

CSV `External Reference` is always the AB order number (`AB-000002`).

504C returns that value as **Customer Order Number**.

Matching rules:

- Exact AB order-number pattern `AB-######` (6+ digits)
- Exact order lookup by `orderNumber`
- **No** fuzzy matching by customer name, invoice value, email, postcode, or approximate date

## Company-wide report — ignore non-AB rows

504C includes trade, eBay, Amazon, web, and other accounts.

Rows whose Customer Order Number does **not** match `AB-######` are classified **NON_AB**.

They are **not errors**. Do not flood diagnostics with thousands of warnings for legitimate non-AB invoices.

Non-AB rows alone never mark an import run `PARTIAL`.

## Parser

Native fixed-width / space-aligned text parser (`src/domain/autopart-504c.ts`).

Fixture: `src/domain/autopart-504c-fixture.ts` (representative header + AB invoices, AB credit, Amazon/eBay/web/PO rows).

Fields extracted:

- Autopart document number  
- Document date / time  
- Account code  
- Customer name  
- Goods / VAT / Value  
- Initials  
- Customer Order Number  

Credits are classified separately (`AB_CREDIT`). Subtotals, footers, and malformed rows are ignored or counted without driving despatch.

## Invoice persistence

Uses the existing `Invoice` model with Autopart fields:

- `externalRef` = Autopart document number (unique — primary dedupe key)
- `autopartDocumentKind` = INVOICE | CREDIT | UNKNOWN
- account, customer order number, document datetime, initials, import run link

## Despatch transition

Valid Autopart **INVOICE** for an AB order in Processing (`CONFIRMED` / `PICKING`):

- Persist invoice  
- `PROCESSING` → `DESPATCHED` (`DISPATCHED`)  
- Enqueue `ORDER_DESPATCHED` once (idempotent key `ORDER_DESPATCHED:{orderId}`)  

Safeguards:

- RECEIVED (`SUBMITTED`) without Processing → do **not** despatch from 504C alone  
- Credits → store/classify only; **never** despatch or email  
- Duplicate document numbers → ignore (harmless)  
- Repeated 13:00 / 16:00 overlapping files are expected and must be idempotent  
- Email failure does **not** roll back invoice or status  

## Stock reservations

Export does **not** consume/release AB reservations.

On 504C despatch:

- Mark active `OrderStockReservation` rows `CONSUMED`
- Decrement `Inventory.qtyReserved` for the hold
- **Do not** decrement `qtyOnHand`

**Decision:** Autopart Avail (231PO3NEW) remains the authoritative physical stock source. Effective AB sellable = trusted Autopart Avail − active AB reservations. Consuming the reservation after warehouse invoice avoids a second physical stock deduction when Avail already reflects the pick. If a future 231PO3NEW already dropped Avail, releasing the AB hold corrects sellable without double-decrementing on-hand.

## Schedule

Intended production windows:

- 13:00 Europe/London  
- 16:00 Europe/London  
- Working days only  

In-app scheduler (`src/server/orders/autopart-504c-scheduler.ts`) ticks every minute but **no-ops** while `enabled=false`. No Coolify cron required.

## Dry-run / testing

Admin upload:

- Parses file  
- Shows AB matches, unmatched AB refs, duplicates, invoices, credits, non-AB counts  
- Records a `DRY_RUN` import history row  
- **Does not** mutate order status or send email  

## Import run history

Statuses: `SUCCESS` | `PARTIAL` | `FAILED` | `DRY_RUN`

Diagnostics include rows read, AB references, matched, new invoices, duplicates, credits, unmatched AB refs, invalid rows, despatched count, email queue counts.

## Credits (deferred)

Parser recognises credits. Future credit handling (returns, financial adjustments) is **not** automatic despatch. Documented for a later phase.

## Customer portal

Customers see Received / Processing / Despatched only.

Never expose: CSV, MAM, Autopart, 504C, import runs, batch IDs, or internal invoice reconciliation details.
