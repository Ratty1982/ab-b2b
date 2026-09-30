# Autopart ongoing sales data architecture

## Sources

| Source | Role |
| --- | --- |
| **231PO3NEW** | Current stock Avail + Latest Cost (Cost Intelligence) |
| **561L + SLRB** | Historical customer/product sales baseline |
| **AB Orders** | Operational AB-originated orders (SKU/qty/price) — not SI realised-sales rows |
| **504** | Ongoing Autopart invoice/credit **documents** (Goods net, VAT, Value, Customer Order Number) |
| **TRM21QC** | Ongoing Autopart **product lines** (signed Qty + NET Sales EX VAT) |
| **504C** | Legacy/fallback order-despatch feed — **kept** until 504 is proven in production |

Do **not** use 504UF.

## Join

```text
504.Document  =  TRM21QC.Document   (exact)
```

Reconciliation:

```text
SUM(TRM21QC.Sales)  ≈  504.Goods     (NET to NET, ±1p)
```

Do not compare TRM21QC Sales to 504 gross Value.

## Credits

Credit notes are first-class:

- negative 504 Goods/VAT/Value
- negative TRM21QC Qty/Sales
- reduce Net Sales / units in Sales Intelligence
- never create purchase presence
- never create despatch / stock movements / credit-control

## AB order match

```text
504.Customer Order Number  =  Order.orderNumber   (exact AB-######)
```

No fuzzy matching. Non-AB references are ignored for despatch. Credits may link to an AB order but never despatch.

## Deduplication / no double counting

- Historic document uniqueness remains company-scoped: `(companyId, documentType, documentReference)`
- Ongoing documents also use a partial unique index on `(documentType, documentReference)` where `has504` or `hasTrm21qc`
- Imports find existing rows by Autopart document number first — never create a second financial sale for the same document
- Line natural key: `(companyId, documentType, documentReference, lineNumber)` with stable TRM21QC fingerprints (supports repeated SKUs)
- Overlapping 13:00 / 18:00 / manual / email imports are idempotent
- Sales Intelligence reads `AutopartSalesLine` only (historic + ongoing) — **not** AB `OrderItem` rows, so realised Autopart invoice lines are not double-counted with order placement

## Schedule

Autopart is asked to email **both** 504 and TRM21QC at:

- 13:00 Europe/London Mon–Fri (interim)
- 18:00 Europe/London Mon–Fri (final expected daily feed)

In-app scheduler follows the 504C pattern (minute tick, window keys, no Coolify cron). Defaults **OFF**.

Polling must tolerate late arrival. Missing companion report mid-day → `AWAITING_504` / `AWAITING_LINES` (not fatal). After the final expected 18:00 window, unresolved companion gaps are more visible in diagnostics. No Saturday/Sunday missing-feed warnings.

## Freshness

Sales Intelligence shows latest successful 504 / TRM21QC import times. If feeds diverge materially, the UI notes that they are not fully aligned.

## Admin

Settings → **Autopart ongoing sales feeds**:

- Manual upload + preview + confirm for 504 and TRM21QC
- Poll Now (requires configured + enabled)
- Import history

Legacy **Autopart invoice / despatch feed (504C)** panel remains above.

## Automatic import

Defaults **OFF**. Enable only after Autopart configures the scheduled emails. Reuses stock IMAP credentials; attachment pattern broadened to `*.csv` for this poll; content detection distinguishes 504 vs 504C vs TRM21QC.
