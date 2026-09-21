# Phase 5 — Autopart stock implementation note

Audit of the Automotive Brands repository on `production/phase-1-auth-rbac`
(`7f772608731a0ed55c4ac45a3f4ca84de06d6912`) before stock sync work.

## Current AB inventory architecture

- `Warehouse` + `Inventory` exist from Phase 0 (`qtyOnHand`, `qtyReserved`, `status`, `externalSyncedAt`). Unique `(variantId, warehouseId)`.
- `ProductVariant.sku` is unique. `externalRef` is a free-text Autopart/external field on **Product** workspace (and product CSV), not used as a stock match key.
- Public catalogue/PDP already map summed `qtyOnHand` through `publicAvailabilityFromQty` (`>=21` in, `1–20` low, `<=0` out) and never put the count in public labels. There is **no** inventory row until something writes one — availability is then `null` (no badge).
- Admin product list shows `stockQty` / `stockLabel` (exact count or “Autopart”). Product → Inventory is a local snapshot table with a note that Autopart is the authority; **no sync exists**.
- Catalogue CSV import (`ProductImportJob`) is **product master** only. It must not be reused as the stock feed model (different columns, mapping UI, product create).
- **No scheduler / job runner** is in the app. Coolify/Docker starts Nitro after `prisma migrate deploy`. Redis is unused.
- Permissions: `inventory.view` (see stock). No `inventory.edit`. Catalogue ops use `products.import` / `products.edit`.
- Phase 4 pricing is a separate domain (`src/server/pricing`). Stock must not join that service.

## Current AlphaOps Autopart implementation

**Not inspectable from this environment.**

Connected remotes are Automotive Brands only (`Ratty1982/ab-b2b`). Public GitHub for `Ratty1982` lists `ab-b2b` and `planet`. `github.com/Ratty1982/alphaops` returns 404. There is no AlphaOps clone, package, or credential in this workspace.

Therefore this phase does **not** copy AlphaOps code, APIs, Redis, or LOCENQ.

Reusable architecture (from AB itself + this brief, not from AlphaOps source):

1. Treat `231PO3NEW` as an untrusted delimited file.
2. Authoritative sellable quantity = **`Avail` column**, matched on **SKU**.
3. Stage → validate → apply; never zero the catalogue first.
4. PostgreSQL advisory lock instead of Redis.
5. Coolify-compatible HTTP cron + optional in-process interval.

## Schema gaps

Existing `Inventory` can store quantity and a sync stamp. Missing:

- Sync **run history** (status, counts, errors) — `ProductImportJob` is the wrong shape.
- Persistent **unmatched SKU** workspace.
- Diagnostic **raw Avail** when negative/invalid (without damaging sellable qty).
- Identifiable Autopart warehouse row (none is bootstrapped today).

Additive models: `StockSyncRun`, `StockSyncIssue`, `StockFeedUnmatched`; `Inventory.sourceAvailRaw`. Warehouse `AUTOPART` created idempotently (not a destructive seed).

## Proposed integration

```
configured source (FTP / HTTP / file) or staff upload
  → parse 231PO3NEW (quoted CSV/TSV)
  → require SKU + Avail headers
  → stage rows (trim SKU, parse Avail)
  → match ProductVariant.sku (trim, case-insensitive map; no fuzzy, no create)
  → dry-run or apply Inventory on warehouse AUTOPART
  → public availability from getVariantAvailability()
```

## Scheduling

No in-app cron framework. Automatic sync:

- `POST /api/internal/stock-sync` with `AUTOPART_STOCK_CRON_SECRET` (Coolify scheduled HTTP, **UTC**).
- Optional `AUTOPART_STOCK_ENABLE_SCHEDULER=true` in-process interval (`AUTOPART_STOCK_SCHEDULE_MINUTES`, default 15).

Default cadence: every **15 minutes, UTC**. Not UK local time.

## Error / recovery

- Overlapping runs: `pg_try_advisory_lock`; second caller is rejected.
- Bad/empty/missing-Avail file: `FAILED`, previous `qtyOnHand` retained.
- Per-row invalid/unmatched/duplicate: reported; other SKUs still apply (`PARTIAL` if any row failed).
- Manual **Sync Autopart stock** and **Dry run** in admin; upload file without FTP.
- Stale: last successful run older than `AUTOPART_STOCK_STALE_HOURS` (default 36). Internal: stale banner + exact qty. Customers: do not show IN/LOW STOCK for stale positive quantities (availability omitted). Zero/negative still OUT OF STOCK.

## Implemented design (after build)

- Warehouse code `AUTOPART`. Quantity on `Inventory.qtyOnHand`. Raw Avail on `sourceAvailRaw`.
- History: `StockSyncRun`, `StockSyncIssue`, `StockFeedUnmatched`. Mutex: `StockSyncMutex`.
- Duplicate SKUs: all instances skipped. Missing-from-feed: retain previous qty (completeness not proven).
- Public catalogue/PDP/related products use `customerAvailabilityForStock` once per request (`stockFreshness`).
- Phase 6 contract: `getVariantStock` / `getSellableQuantity` — no basket.
- First activation: deploy ≠ sync. Dry run → live sync → then enable Coolify `POST /api/internal/stock-sync` every 15 minutes UTC.
