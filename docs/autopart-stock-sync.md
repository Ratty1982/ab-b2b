# Autopart stock sync (Phase 5)

Automotive Brands treats **231PO3NEW `Avail`** as the authoritative sellable quantity.

This is **not** physical stock minus LOCENQ. LOCENQ is not used.

AlphaOps was not inspectable from this environment (no AlphaOps repository on the connected GitHub account). Acquisition is therefore configured independently: FTP, HTTP, local file, or staff upload.

## Source

| Setting | Purpose |
| --- | --- |
| `AUTOPART_STOCK_SOURCE` | `ftp`, `http`, `file`, or `none` |
| `AUTOPART_STOCK_FTP_*` | Host, port, user, password, remote path (default `231PO3NEW`) |
| `AUTOPART_STOCK_HTTP_URL` / `AUTOPART_STOCK_HTTP_TOKEN` | HTTPS download + optional Bearer token |
| `AUTOPART_STOCK_FILE_PATH` | Server-side file for staging |
| `AUTOPART_STOCK_CRON_SECRET` | Protects `POST /api/internal/stock-sync` |
| `AUTOPART_STOCK_STALE_HOURS` | Default `36` |
| `AUTOPART_STOCK_SCHEDULE_MINUTES` | Default `15` |
| `AUTOPART_STOCK_ENABLE_SCHEDULER` | `true` starts an in-process UTC interval (optional; Coolify HTTP cron is preferred) |
| `AUTOPART_STOCK_MAX_BYTES` | Default 15 MB |

Secrets stay in server env. Never `VITE_*`. The admin status screen shows **Configured / Not configured** and source **type** only.

Required columns: an identifiable SKU/code header and **Avail**. If Avail is missing or renamed, the feed is **FAILED** and previous stock is kept.

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

1. Deploy code (migrate adds history tables; **does not** overwrite stock).
2. Set source env vars. Confirm admin status = Configured.
3. Dry run. Review matched / unmatched / invalid.
4. Authorised **Sync Autopart stock**.
5. Spot-check product Inventory tabs and public PDP badges.
6. Enable Coolify POST cron (or in-process scheduler).

## Operational recovery

- Re-run dry run or live sync from admin.
- Upload a file if FTP is down.
- Failed/stale banners are on the Autopart Stock screen.
- If a feed is bad, do not zero SKUs manually unless operations intend that.

See also `docs/phase-5-autopart-stock-implementation-note.md`.
