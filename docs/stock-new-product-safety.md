# New product stock safety — investigation & fix

**Repo:** Ratty1982/ab-b2b  
**Base:** `production/phase-1-auth-rbac`  
**Date:** 2026-11-06 (Europe/London)

## Production database access

This Cloud Agent environment has **no production database credentials**.  
`DATABASE_URL` points at the local MFA test database, which does **not** contain PMEBIKK / PMECARK / PMECAVK.

Run the read-only diagnostic against production (or a production replica) as an authorised operator:

```bash
DATABASE_URL="$PRODUCTION_READONLY_URL" bun run scripts/diagnose-sku-stock.ts PMEBIKK PMECARK PMECAVK
```

Never invent live quantities in this document.

## Root-cause findings (from code)

### A. Why one new kit can have stock while siblings do not

`createProduct` previously:

1. Created `Product` + `ProductVariant` only.
2. Did **not** create an `Inventory` row.
3. Did **not** link or read `AutopartProduct`.
4. Left `backorderPolicy` at schema default `INHERIT`.

`applyStockFeed` only upserts `Inventory` for catalogue SKUs that **already exist** when the feed runs. SKUs that appear later as catalogue products stay **unmatched / external** on the Autopart master until another live apply matches them.

So the observed pattern is expected:

| SKU | Likely code-level explanation |
|-----|-------------------------------|
| PMECARK | Variant existed before a successful matched apply → Inventory created (e.g. Avail 20). |
| PMEBIKK / PMECAVK | Variants created after the matching observation path, or never matched into Inventory yet → “Not synced” / no Inventory. |

Autopart master rows for those part numbers can still exist with `catalogueVariantId = null` from earlier unmatched imports.

### B–D. Autopart master, reconciliation gap, need for another feed

- Master: `AutopartProduct` upserted for every valid 231PO3NEW row.
- Linking: set during matched apply, or via admin link helper — **not** on product create (before this PR).
- Therefore creating a variant after an import historically required another feed (or manual link + sync) to establish Inventory.

### E–F. Backorder INHERIT + unknown stock was orderable

- Global trade ordering default is **ALLOW**.
- Variant default was **INHERIT** → effective ALLOW.
- Basket / quote / staff order paths treated **missing stock** as:

  `orderable = isEffectiveBackorderAllowed(policy)` → **true**.

That matches PMEBIKK: no Inventory, INHERIT→ALLOW, purchasing shows uncovered backorder demand after a customer order was accepted.

### G. Manual upload failures vs successful IMAP

Manual UI used `file.text()` (always UTF-8) and called `runManualStockSync` live immediately.

Native parser fails closed with:

> “231PO3NEW was detected, but the Avail column could not be parsed reliably”

when title/kind detection succeeds but header/numeric layout sampling fails. Common causes:

1. **Encoding** — browser UTF-8 decode of a Windows-1252 / UTF-16 Autopart export shifts fixed-width columns.
2. Truncated / re-saved file.
3. Header present enough for kind detection but Avail cluster detection fails.

IMAP applies the attachment bytes through the server path (successful 09:15 run). Manual uploads at 09:32/09:33 never reached row apply.

## Fixes in this PR

1. **Confirmed-stock contract** — missing Inventory = unconfirmed; never orderable (customer or staff), even if backorders ALLOW.
2. **New variants default `backorderPolicy = DENY`** (schema default + explicit create). Existing rows unchanged.
3. **Reconcile on create / SKU change** — trusted `AutopartProduct` initialises Inventory (including Avail 0) without inventing qty; never overwrites existing Inventory/manual overrides.
4. **Manual override** — audited quantity including 0; Autopart Avail still updates; override not cleared by polls.
5. **Sync counters** — `newlyConfirmed` distinct from unchanged 0→0.
6. **Manual upload** — decode-aware preview → confirm with file hash; same apply pipeline + lock.
7. **Inventory UI** — stock source, override, backorder clarity, unconfirmed warning.
8. **Diagnostic script** — read-only per-SKU report for production operators.

## Explicitly not done / operator actions

- No automatic backfill of live product stock.
- No changes to existing orders, reservations, invoices, or PMEBIKK’s customer backorder.
- No disable of automatic 231PO3NEW polling.
- No merge / deploy from this agent.

### Recommended production rollout

1. Deploy migration `20261106120000_stock_confirmation_safety`.
2. Run `diagnose-sku-stock.ts` for the three kits; attach output to the change ticket.
3. For PMEBIKK / PMECAVK only if diagnosis shows a trusted master and missing Inventory: either wait for next successful poll **or** use product create reconcile by a no-op SKU save after deploy (idempotent) — confirm proposed Avail with the operator before relying on it for sellable stock.
4. Leave PMECARK Inventory untouched.
5. Do not bulk-mutate existing `INHERIT` policies.

## Behaviour before / after

| Scenario | Before | After |
|----------|--------|-------|
| New product, no Inventory, INHERIT/ALLOW | Orderable as backorder | Blocked (“Stock not confirmed”) |
| New product default policy | INHERIT | DENY |
| New product with trusted master Avail 20 | Wait for next feed | Inventory initialised at create |
| New product with trusted master Avail 0 | Wait for next feed; 0→0 counted unchanged | Inventory confirmed zero; `newlyConfirmed` |
| Manual 231PO3NEW upload | Immediate apply via `file.text()` | Preview + hash confirm; encoding-aware decode |
| Manual override during poll | N/A | Autopart Avail updates; override persists |
