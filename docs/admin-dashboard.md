# Admin Dashboard

## Purpose

**Admin → Dashboard** (`/admin`) is an operational overview:

- What needs attention?
- What has happened?
- What is the current system state?

It is **not** a vanity analytics surface. Fabricated prototype metrics (Sales YTD, fake charts, demo people, invented conversion rates) have been removed.

**Policy:** real data, or a genuine empty / not-configured state. Never invent business figures. Hide unfinished metrics instead of showing placeholders.

## Authoritative source

`getAdminDashboard(actorUserId)` in `src/server/admin/dashboard.ts`, exposed as `getAdminDashboardFn`.

All values are aggregated from production Prisma models (Order, Company, TradeApplication, Quote, Task, AuditEvent, StockSyncRun, EmailSettings, Autopart504cFeedSettings).

## Summary cards

| Card | Definition |
| --- | --- |
| **Orders today** | Count of orders with `placedAt` in the current **Europe/London** calendar day, excluding `DRAFT` and `CANCELLED`. **Order value** = sum of `grandTotal` (inc VAT) for those same rows — snapshot totals only. |
| **Open orders** | Count where status ∈ `SUBMITTED`, `CONFIRMED`, `PICKING`, `DISPATCHED`, `ON_HOLD`. |
| **Active trade customers** | Count of `Company` with status `ACTIVE` (scoped for sales users). |
| **Trade applications** | Count in `SUBMITTED` + `UNDER_REVIEW` + `MORE_INFO_REQUIRED`. |
| **Open quotes** | Count in `DRAFT` + `SENT` + `VIEWED` when the actor has `quotes.view`. Hidden if the actor cannot see quotes. |

These are **order / operational counts**, not invoiced sales.

## Orders requiring attention

Uses the same Autopart export eligibility shape as Orders admin:

| Bucket | Rule |
| --- | --- |
| Ready for export | `NOT_EXPORTED`, not draft/cancelled, linked Autopart snapshot, has line items |
| Processing / awaiting invoice | `EXPORTED` and status ∈ `CONFIRMED`, `PICKING` |
| Export blocked | `NOT_EXPORTED`, not draft/cancelled, and missing Autopart link/code or items |

Links open `/admin/orders?autopartExport=…`.

## Trade applications

Counts by status plus a short attention list (open statuses only). APPROVED/REJECTED are excluded from attention.

**Newly approved (7 days)** uses `TradeApplication.status = APPROVED` with `decidedAt` in the last 7 days (shown as a hint under Active trade customers).

## Quotes

Draft / sent·viewed / expiring-soon (SENT|VIEWED with `expiresAt` within 7 days). No fake conversion %.

## Autopart stock

Latest **live** `StockSyncRun` with status SUCCESS or PARTIAL:

- Matched / updated / not in AB catalogue (`unmatched`)
- Ignored rows (`invalid` + `duplicates`) — INVALID/DUPLICATE severity `IGNORED` (informational)
- Actionable issues — only `ACTION_REQUIRED` / `FATAL` / `WARNING`
- Unmatched catalogue SKUs are **not** treated as errors
- Status: Healthy / Attention required / No sync yet  
  Ignored INVALID/DUPLICATE diagnostics alone keep Status **Healthy**

## 504C invoice / despatch

Read-only settings from `getAutopart504cFeedSettings()`:

- Expected production state while waiting on Autopart: **Not configured**, automatic polling **OFF**
- Schedule label: 13:00 · 16:00 Europe/London (working days)
- Listed under Needs attention as **informational**, not a critical error

Dry-run import records must never be presented as live imports on this dashboard.

## Recent orders / activity

- Recent orders: latest non-draft orders (scoped), UK `DD/MM/YYYY`, `grandTotal` inc VAT, Autopart export label
- Recent activity: curated `AuditEvent` actions only (orders, applications, quotes, callbacks, assignments, stock). No secrets in payloads.

## Callbacks

Open `Task` rows with title `Call customer` and status `OPEN` when the actor has `tasks.view`.

## Email health

When `settings.view` is available: SMTP+sender configured flag, delivery enabled, FAILED transactional emails in the last 7 days. Never exposes passwords or tokens.

## Needs attention

Built only from genuine conditions (applications, export ready/blocked, callbacks, email failures, **actionable** stock-sync issues). Ignored INVALID/DUPLICATE Autopart row diagnostics do **not** create Needs Attention. 504C not-configured is severity `info`.

## RBAC / sales scope

- Internal actors only
- Requires at least one of `orders.view`, `companies.view`, `applications.view`, or `admin.access`
- Company/order/quote/task/audit lists use `getAccessibleCompanyIdsForSales` — scoped sales users do not see all-company commercial data
- Optional sections (stock, email, quotes, callbacks) appear only when the actor has the relevant permission

## Performance

One dashboard request runs parallel aggregates/counts and small limited lists (no full catalogue loads).

## Real-data-only regression

`PROTOTYPE_ADMIN_DASHBOARD_STRINGS` + source/integration tests ensure the dashboard route and payload never contain the old prototype demo entities or vanity metrics.
