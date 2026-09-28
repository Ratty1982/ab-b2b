# Automotive Brands — Production B2B Quotes

Trade quotations for existing ACTIVE companies. Quotes snapshot commercial terms; conversion creates a normal AB Order (`SUBMITTED` / Received) with AB stock reservation and the standard order email workflow. **No Autopart side effects** occur on quote create, send, accept, or convert.

## Lifecycle

| Status | Meaning |
|--------|---------|
| `DRAFT` | Staff preparing; not visible in portal; no email |
| `SENT` | Issued to customer; commercial fields locked |
| `VIEWED` | Customer opened the quote (first view only) |
| `ACCEPTED` | Transient claim during conversion |
| `DECLINED` | Customer declined (terminal for acceptance) |
| `EXPIRED` | Validity calendar day elapsed |
| `CONVERTED` | Successfully became an Order (terminal) |
| `REJECTED` | Legacy synonym of declined |
| `CANCELLED` | Cancelled by staff (reserved) |

Expected flow:

`DRAFT` → `SENT` → `VIEWED` → `ACCEPTED` → `CONVERTED`

Also: `SENT`/`VIEWED` → `DECLINED` or `EXPIRED`.

Transitions are enforced server-side. Converted quotes cannot be accepted again, declined, or commercially edited. Staff cannot silently edit a sent quote — use **Duplicate**.

## Quote ↔ Order relationship

Authoritative fields (never parse notes/audit):

| Side | Fields |
|------|--------|
| Quote | `convertedOrderId`, `convertedAt`, acceptance actors/note |
| Order | `sourceQuoteId`, `sourceQuoteNumber` |

Admin and portal UIs show two-way links (quote → order number, order → quotation number).

## Quote numbers

Format: `QT-000001` via `QuoteNumberSequence` (concurrency-safe). Immutable after creation. Never show database IDs to customers.

## Pricing & commercial snapshots

On line add/update (draft only):

1. Resolve normal trade price via Phase 4 `resolveVariantTradePrices`  
   (`CustomerPrice` → `PriceListItem` → base trade → quantity break → promotion).
2. Optionally apply quote-specific unit price override (`quotes.override_price`).
3. Snapshot commercial values on `QuoteItem` (SKU, names, qty, normal vs quoted 4dp, customer 2dp, VAT, case qty, price source).

Overrides apply **only to that quote** — never write back to `CustomerPrice` / price lists.

Authoritative money precision: **4dp** commercial, **2dp** customer display (HALF-UP).

Once `SENT` / `VIEWED` / `ACCEPTED` / `DECLINED` / `EXPIRED` / `CONVERTED`, historical commercial values must not silently change because catalogue price, CustomerPrice, PriceList, promotion, VAT, delivery rule, case quantity, product name/SKU, payment terms, or address changed. Conversion uses the quote snapshot for all commercials.

## Case quantity at conversion

Quotes are created with valid trade quantities. If catalogue `caseQty` changes after send, conversion **does not rewrite** the quoted quantity. The agreed quoted quantity is used; validation uses the snapshotted case qty where applicable.

## Stock & backorders at conversion

- Quotes **do not reserve stock** when created, sent, or viewed.
- At conversion, run **current** stock/backorder allocation (`allocateOrderLineQuantities` + effective backorder policy).
- Quoted unit prices and quote totals remain the agreed commercial snapshot.
- Reservation reserves only available allocation — never backordered units.
- Partial / full backorder orders are normal AB orders (same fulfilment path as checkout).

## Delivery & VAT

Uses `calculateTradeOrderTotals` when drafting:

- Goods ex VAT &lt; £100 → £5.95 delivery ex VAT  
- Goods ex VAT ≥ £100 → FREE  

VAT respects company tax status. Totals are snapshotted on the quote. After send, quoted delivery and VAT are part of the immutable commercial snapshot and are copied onto the order at conversion (not recalculated).

## Validity / expiry

Default **30 calendar days**. Stored as date-only (UTC noon). Display `DD/MM/YYYY`. After expiry, customers cannot accept. Portal shows an expired state; staff may Duplicate to prepare a replacement. No automatic new quote.

## Empty / £0 quotes

Empty drafts are allowed while being prepared. **Send is blocked** when there are no lines or goods/grand total is £0, with:

> Add at least one valid product before sending this quotation.

## Send / resend / email

`DRAFT` → `SENT`. Resend allowed for `SENT` and `VIEWED` (does not reset Viewed → Sent, does not extend validity, does not alter commercials).

- Purpose: `QUOTE_SENT`
- Shared branded shell (`renderTransactionalEmailShell`) — same as ORDER_RECEIVED / password reset / trade application
- Subject: `Your Automotive Brands quotation QT-######`
- CTA: portal quote URL
- Prepared-by details frozen in `preparedBySnapshot` at first send
- Email failure does **not** delete/corrupt the quote; staff can resend
- Never includes Autopart codes, margin, cost, pricing source, or internal notes

Decline may notify the assigned sales rep via `QUOTE_DECLINED_INTERNAL`.

## Prepared by / sales rep snapshot

Historical quote output (email/print) prefers `preparedBySnapshot` (name, title, email, phone, mobile). Live Account Manager panel may still show current sales-rep details.

## Portal

`Portal → Quotes` lists issued quotes for the authenticated company only.

Customer-friendly statuses: Awaiting response, Viewed, Accepted, Declined, Expired, Converted / Ordered.

- First customer open: `SENT` → `VIEWED` (`firstViewedAt`); noisy refreshes do not re-audit
- Admin preview does **not** mark viewed
- Accept / Decline when `SENT`/`VIEWED` and not expired
- Converted state: no Accept button; shows order number + View order
- Dashboard shows **Quotes requiring action** only when open SENT/VIEWED quotes exist

## Acceptance → Order

Uses quoted commercial snapshots (not live prices). Creates normal Order:

- Status: `SUBMITTED` (Received — pending Autopart CSV)
- Current stock allocation / backorder split
- AB reservation via `reserveStockForOrder` (available qty only)
- `sourceQuoteId` / `sourceQuoteNumber` + `Quote.convertedOrderId` / `convertedAt`
- Fulfilment event `ORDER_RECEIVED` (source `QUOTE_CONVERT`)
- After commit: standard `ORDER_RECEIVED` + `ORDER_RECEIVED_INTERNAL` via `sendOrderEmailsAfterCommit`
- Idempotent (`acceptIdempotencyKey` + atomic claim) — double-click / refresh never creates two orders or duplicate automatic emails
- Email failure does not roll back conversion; attempt is recorded and retryable from Admin → Order → Transactional Email

Staff may **Accept on behalf** (`quotes.accept_on_behalf`) with a confirmation note — same conversion + email pipeline (`acceptanceChannel = STAFF_ON_BEHALF`).

### Missing confirmation on historical orders

Existing converted orders (e.g. AB-000005) are **not** emailed retrospectively by deploy/migration. Admin can manually retry/send `ORDER_RECEIVED` from the order transactional email UI when authorised.

## Notes privacy

| Notes | Portal | Email | Print | Admin |
|-------|--------|-------|-------|-------|
| Customer notes | Yes | No (keep email concise) | Yes | Yes |
| Internal notes | **Never** | **Never** | **Never** | Yes |

## Duplicate

Creates a new `QT-######` in `DRAFT` with new validity. May copy customer, contact, address, lines (re-resolved prices), PO, notes. Does **not** copy SENT/VIEWED/ACCEPTED/DECLINED/CONVERTED state, email history, convertedOrderId, acceptance metadata, or audit history.

## Autopart boundary

Quote convert does **not**:

- export Autopart CSV
- set `externalRef`
- call Autopart API / APC
- mark Processing / Despatched

Existing workflow remains: Received → Autopart CSV (`External Reference = AB-######`, paid delivery as `SDEL`) → Processing → 504C → Despatched.

MAM Account comes from the resulting Order’s verified `autopartCustomerCodeSnapshot`. Customer PO remains separate.

## RBAC / security

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

Sales-rep company scope enforced server-side. Customers only access their company. Never trust client-supplied companyId, price, VAT, delivery, convertedOrderId, or status.

## Audit

Recorded: created, edited, price override, sent/resent, viewed (first), accepted, accepted_on_behalf, declined, duplicated, converted, order.created, order.email_failed. Ordinary admin page views are not audited.

## Print

Printable quote views (admin + portal) with print stylesheet. Includes branding, quote number, customer, delivery/contact, prepared by, dates, PO, lines, totals, customer notes/terms. Excludes internal notes, internal IDs, audit, Autopart internals. No separate PDF dependency in this phase.

## Admin UI

`Sales → Quotes` — list filters (All/Draft/Sent/Viewed/Accepted/Declined/Expired/Converted), search (quote number, company, PO), new company picker, quote workspace with converted banner (order link, converted at, accepted by, channel).

## Key modules

- `src/server/quotes/service.ts` — workflow + conversion
- `src/server/quotes/quote-number.ts` — `QT-` allocator
- `src/server/quotes/quote-email.ts` — QUOTE_SENT / decline internal
- `src/server/email/transactional.ts` — `sendOrderEmailsAfterCommit`
- `src/server/email/shell.ts` — shared branded email shell
- `src/domain/quote.ts` — validation / status labels
- `docs/quotes.md` — this document
