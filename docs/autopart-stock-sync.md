# Autopart stock sync (Phase 5 / 5A)

Automotive Brands treats **231PO3NEW `Avail`** as the authoritative sellable quantity.

This is **not** physical stock minus LOCENQ. LOCENQ is not used. `Stk`, `Pick Qty`, and `Physical Stk` are never sellable.

**Production source is EMAIL / IMAP**, matching the current AlphaOps mailbox architecture (reimplemented independently with `imapflow` + `mailparser`). FTP/HTTP/file remain diagnostic adapters only.

AlphaOps was inspected in `Ratty1982/alphaops` (`backend/src/autopart-stock-email/`). AB does not import AlphaOps packages.

## Production source — EMAIL / IMAP

```
IMAP mailbox
→ Coolify POST /api/internal/stock-sync (every 15 minutes, UTC)
→ allowed-sender check
→ 231PO3NEW attachment filter
→ content must positively detect 231PO3NEW
→ existing Phase 5 parse / match / apply
```

**One production polling path:** Coolify HTTP cron calling the existing stock-sync endpoint, which now polls IMAP when email is configured. Do **not** also set `AUTOPART_STOCK_ENABLE_SCHEDULER=true`.

| Setting | Purpose |
| --- | --- |
| `AUTOPART_STOCK_SOURCE` | Production: `email`. Diagnostic: `ftp` / `http` / `file` |
| `AUTOPART_STOCK_IMAP_HOST` / `PORT` / `SECURE` / `USER` / `PASSWORD` / `MAILBOX` | IMAP connection (password also write-only in admin, AES-GCM with `AUTH_SECRET`; env password wins) |
| `AUTOPART_STOCK_IMAP_ALLOWED_SENDERS` | Optional allowed From addresses |
| `AUTOPART_STOCK_IMAP_FILENAME_PATTERN` | Default `231PO3NEW*.txt` |
| `AUTOPART_STOCK_CRON_SECRET` | Protects `POST /api/internal/stock-sync` |
| `AUTOPART_STOCK_STALE_HOURS` | Default `36` (last **live Inventory** success, not last IMAP poll) |
| `AUTOPART_STOCK_SCHEDULE_MINUTES` | Default `15` |
| `AUTOPART_STOCK_ENABLE_SCHEDULER` | Leave `false` when Coolify cron is used |

Admin → Autopart Stock: configure IMAP, **Test connection**, **Poll now (dry run)** then **Poll now (live)**. Password is never returned in DTOs.

Dedupe: `Message-ID|UID` (UID required). Message-ID alone is not unique. Dry-run does **not** consume the message. Live success marks the receipt consumed. Default: leave mail in INBOX (no delete). Archive-after-success is optional and off by default.

## 231PO3NEW format

Printed Autopart report (fixed-width), not a simple CSV. Positive detection requires title `(231PO3NEW)` or a header with **Part Number + Stk + Avail + Pick Qty**. Filename is not enough.

Native parser reads **Avail** only. Manual CSV/TSV upload still uses the Phase 5 delimited parser.

## Avail rule

`Inventory.qtyOnHand` on warehouse `AUTOPART` = integer Avail, except negatives which store sellable `0` and keep the raw value in `sourceAvailRaw`.

Case quantity does **not** round Avail. Avail 11 with caseQty 2 stores 11.

## SKU matching

Match key = `trim(SKU)` compared to `ProductVariant.sku` case-insensitively.

- No fuzzy matching, titles, or auto-create
- Unknown SKU → `UNMATCHED`
- Ambiguous catalogue SKUs → `CONFLICT` (no update)
- Whitespace around SKU is trimmed; the identifier is not rewritten

`ProductVariant.externalRef` is not the 231PO3NEW match key.

## Duplicate SKU policy

Duplicate SKUs in one feed are **conflicts**. Every instance is skipped (not last-wins). Other SKUs still apply.

**Difference from current AlphaOps:** AlphaOps keeps the highest Avail when the same SKU appears twice. AB does **not** adopt that in this phase. Revisit if live 231PO3NEW files contain duplicates.

## Missing SKU / feed-row policy

Completeness of 231PO3NEW could not be proven without AlphaOps source. **Absence from the current file does not zero stock.** Previous quantity is retained.

## Invalid Avail

Blank or non-numeric Avail → row `INVALID`. Previous quantity for that SKU is retained. Customers do not receive IN STOCK from malformed data.

## Negative Avail

Stored diagnostically; sellable quantity is `0`; public status is OUT OF STOCK. Orderable quantity never goes negative (`getSellableQuantity`).

## Manual sync and dry run

Admin → Catalogue → **Autopart Stock**:

- Dry run (configured source, no Inventory writes)
- Sync Autopart stock (live)
- Upload 231PO3NEW (CSV/text)

Requires `products.import`, `products.edit`, or `admin.access`. Trade actors are refused.

Dry run still records a `StockSyncRun` with `mode=dry-run` and issues. It does not upsert `Inventory` or unmatched SKUs.

## Automatic schedule and timezone

- Preferred: Coolify scheduled **POST** to `/api/internal/stock-sync` with header `x-autopart-cron-secret` or `Authorization: Bearer …` every **15 minutes, UTC**.
- Optional in-process interval when `AUTOPART_STOCK_ENABLE_SCHEDULER=true` (UTC, not UK local time).
- `GET /api/internal/stock-sync` returns configuration status without secrets and without running a sync.

## Locking

PostgreSQL row `StockSyncMutex` id `autopart-231po3new`. Overlapping live/dry/cron/manual runs are rejected (`409`). A holder older than 45 minutes is treated as crashed.

## Atomicity

The importer never zeros the catalogue first. A missing header, empty file, or oversized file marks the run **FAILED** and leaves previous `qtyOnHand` intact. Per-row problems produce **PARTIAL** when any valid row applied (or would apply on dry-run).

## Sync history

`StockSyncRun`: source, status (`RUNNING` / `SUCCESS` / `PARTIAL` / `FAILED`), timestamps, rows read, matched, updated, unchanged, unmatched, invalid, duplicates, error summary.

`StockSyncIssue` caps at 400 diagnostic rows per run.

## Unmatched SKUs

`StockFeedUnmatched` (live syncs only). Admin table: Autopart SKU, description, Avail, reason, last seen, occurrence count.

## Public availability

Central policy `publicAvailabilityFromStock` / `customerAvailabilityForStock`:

| Avail | Public |
| --- | --- |
| ≥ 21 | IN STOCK |
| 1–20 | LOW STOCK |
| ≤ 0 | OUT OF STOCK |

Public/customer DTOs expose `availability` only. Exact quantity is never sent to hide with CSS.

Out-of-stock products stay visible if catalogue publication rules allow them.

## Stale stock

If the last **successful live** sync is older than `AUTOPART_STOCK_STALE_HOURS` (and a success exists):

- Internal: exact qty + stale marker
- Customers: positive stock is **not** shown as IN/LOW STOCK (availability omitted). Zero remains OUT OF STOCK.

If there has never been a successful sync, inventory rows (if any) are not treated as stale-from-timeout.

## RBAC

| Actor | Exact qty | Manual sync | Unmatched / errors |
| --- | --- | --- | --- |
| Public / trade customer | No | No | No |
| Internal with `inventory.view` | Yes | No unless import/edit/admin | View |
| `products.import` / `products.edit` / `admin.access` | Yes if also inventory/admin | Yes | Yes |

Trade `actorType` cannot administer stock even if a trade role lists `inventory.view`.

## Audit / logs

Audit: manual live sync, sync failed. Not one event per SKU.

Logs: `[ab:stock-sync]` with run id, source, duration, counts. No credentials.

## Phase 6 stock contract

Server-side only:

```ts
getVariantStock(variantId)       // sellableQty, availability, stale, source
getSellableQuantity(stock)       // exact Avail, never negative, not case-rounded
getVariantAvailability(variantId)
```

Phase 6 must check `requestedQty <= getSellableQuantity(stock)` **and** full-case multiples. That validation is **not** implemented here.

## First production activation

1. Deploy this email-acquisition correction (does **not** import stock).
2. Configure IMAP in Autopart Stock and/or Coolify env. Prefer env for the password.
3. **Test connection**.
4. **Poll now (dry run)** — inspect attachment name, 231PO3NEW detection, Avail, match/unmatched counts. Message is not consumed.
5. Compare sample SKUs with Autopart.
6. **Poll now (live)** once — first authorised Inventory write.
7. Verify catalogue/PDP/internal Inventory.
8. Enable Coolify `POST /api/internal/stock-sync` every 15 minutes UTC.

Do **not** run the first live production sync from this agent session.

## Operational recovery

- Re-run dry run or live sync from admin.
- Upload a file if IMAP is unavailable.
- Failed/stale banners are on the Autopart Stock screen.
- If a feed is bad, do not zero SKUs manually unless operations intend that.

See also `docs/phase-5-autopart-stock-implementation-note.md`.
