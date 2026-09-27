# Automotive Brands — Production B2B Quotes

Trade quotations for existing ACTIVE companies. Quotes snapshot commercial terms; conversion creates a normal AB Order (`SUBMITTED` / Received) with AB stock reservation. **No Autopart side effects** occur on quote create, send, accept, or convert.

## Lifecycle

| Status | Meaning |
|--------|---------|
| `DRAFT` | Staff preparing; not visible in portal; no email |
| `SENT` | Issued to customer; commercial fields locked |
| `VIEWED` | Customer opened the quote (first view only) |
| `ACCEPTED` | Transient claim during conversion |
| `DECLINED` | Customer declined (terminal for acceptance) |
| `EXPIRED` | Validity calendar day elapsed |
| `CONVERTED` | Successfully became an Order |
| `REJECTED` | Legacy synonym of declined |
| `CANCELLED` | Cancelled by staff (reserved) |

Transitions are enforced server-side. Staff cannot silently edit a sent quote — use **Duplicate**.

## Quote numbers

Format: `QT-000001` via `QuoteNumberSequence` (concurrency-safe). Immutable after creation. Never show database IDs to customers.

## Pricing

On line add/update (draft only):

1. Resolve normal trade price via Phase 4 `resolveVariantTradePrices`  
   (`CustomerPrice` → `PriceListItem` → base trade → quantity break → promotion).
2. Optionally apply quote-specific unit price override (`quotes.override_price`).
3. Snapshot commercial values on `QuoteItem` (SKU, names, qty, normal vs quoted 4dp, customer 2dp, VAT, case qty, price source).

Overrides apply **only to that quote** — never write back to `CustomerPrice` / price lists.

Authoritative money precision: **4dp** commercial, **2dp** customer display (HALF-UP).

## Case ordering & stock

- Case rules match orders (`assessBasketLineQuantity` / `resolveCustomerOrdering`).
- **Quotes do not reserve stock** and do not call Autopart.
- Acceptance **revalidates** stock and case rules. Failure aborts with no partial order.

## Delivery & VAT

Uses `calculateTradeOrderTotals`:

- Goods ex VAT &lt; £150 → £5.95 delivery ex VAT  
- Goods ex VAT ≥ £150 → FREE  

VAT respects company tax status. Totals snapshotted on the quote. Delivery override (authorised) is audited and not silently recalculated after send.

## Validity

Default **30 calendar days**. Stored as date-only (UTC noon). Display `DD/MM/YYYY`. After expiry, customers cannot accept.

## Send / email

`DRAFT` → `SENT` (or resend while `SENT`/`VIEWED`).

- Purpose: `QUOTE_SENT`
- Branded shell (Automotive Brands + Power Maxed / Steel Seal)
- Subject: `Your Automotive Brands quotation QT-######`
- CTA: portal quote URL
- Email failure does **not** delete/corrupt the quote; staff can resend
- Never includes Autopart codes, margin, cost, pricing source, or internal notes

Decline may notify the assigned sales rep via `QUOTE_DECLINED_INTERNAL`.

## Portal

`Portal → Quotes` lists issued quotes for the authenticated company only.

- First customer open: `SENT` → `VIEWED` (`firstViewedAt`)
- Admin preview does **not** mark viewed
- Accept / Decline when `SENT`/`VIEWED` and not expired

## Acceptance → Order

Uses quoted snapshots (not live prices). Creates normal Order:

- Status: `SUBMITTED` (Received — pending Autopart CSV)
- AB reservation via `reserveStockForOrder`
- `sourceQuoteId` / `sourceQuoteNumber`
- `ORDER_RECEIVED` + `ORDER_RECEIVED_INTERNAL` emails (failure non-fatal)
- Idempotent (`acceptIdempotencyKey` + atomic claim)
- Concurrent accepts cannot create two orders

Staff may **Accept on behalf** (`quotes.accept_on_behalf`) with a confirmation note — same pipeline.

## Autopart boundary

Quote convert does **not**:

- export Autopart CSV
- set `externalRef`
- call Autopart API / APC
- mark Processing / Despatched

Existing workflow remains: Received → Autopart CSV (`External Reference = AB-######`, paid delivery as `SDEL`) → Processing → 504C → Despatched.

## RBAC

| Permission | Use |
|------------|-----|
| `quotes.view` | List/detail (staff + portal) |
| `quotes.create` | New / duplicate |
| `quotes.edit` | Draft edits |
| `quotes.send` | Send / resend |
| `quotes.override_price` | Quote unit/delivery override |
| `quotes.accept` | Portal accept/decline |
| `quotes.accept_on_behalf` | Staff telephone acceptance |
| `quotes.convert` | Reserved for conversion tooling |

Sales-rep company scope enforced server-side (`getAccessibleCompanyIdsForSales`).

## Audit

Recorded: created, edited, price override, sent/resent, viewed (first), accepted, declined, duplicated, converted. Ordinary admin page views are not audited.

## Print / PDF

Printable quote views (admin + portal) with print stylesheet. No new PDF dependency in this phase.

## Admin UI

`Sales → Quotes` — list, new company picker, quote workspace (customer, products, commercial, notes, email, accept on behalf).

## Key modules

- `src/server/quotes/service.ts` — workflow
- `src/server/quotes/quote-number.ts` — `QT-` allocator
- `src/server/quotes/quote-email.ts` — transactional email
- `src/domain/quote.ts` — validation / status labels
- `docs/quotes.md` — this document
