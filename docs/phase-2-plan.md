# Phase 2 — Implementation Plan

Customer/company operations + CMS foundation on `production/phase-1-auth-rbac`.

## Current state (reuse)

- **Schema already has**: Company, Contact, Address, CompanyUser, SalesRep, CompanyAssignment, TradeApplication, PriceList, Activity, AuditEvent, Document.
- **RBAC**: relational permissions + Coolify entrypoint bootstrap (do not regress).
- **UI**: Lovable shells work; customers/applications/CMS are still mock-driven.
- **Known nav issues**: duplicated route strings per layout; admin “Companies” → `/sales/customers`; several CRM items point at `/crm` stub; CMS permissions exist as `cms.view|edit|publish`.

## Scope map

| Slice | Deliverable |
| --- | --- |
| **2A** | Single `app-nav` config; fix dead/duplicate links; AppShell active/mobile; permission-aware menus; admin customers routes |
| **2B–E** | Company domain services + admin Customers workspace (list/detail tabs); contacts; addresses with default constraints; commercial fields; salesperson assignment scoping |
| **2C** | Contact flags/notes; company users; invitation state (no email send) |
| **2F** | Public trade register → DB; admin review/approve/reject; transactional idempotent approval |
| **2G** | Sales customer list scoped by assignment; server authz unchanged |
| **2H** | Activity timeline from Activity + AuditEvent (scrubbed) |
| **2I–J** | CMS models, section library, draft/publish, homepage editor + idempotent homepage seed; public `/` reads published only |

## Schema deltas (one Phase 2 migration)

- Company: `phone`, `primaryEmail`, `taxStatus`; status add `SUSPENDED` (keep `PENDING_APPROVAL` as product “Pending”).
- Contact: `isPurchasing`, `isAccounts`, `notes`.
- Address: `isDefaultBilling`, `isDefaultDelivery`, optional `contactName`/`contactPhone` (retain `isDefault` for compat).
- `UserInvitation` for portal invite foundation (hashed token, status, expiry).
- CMS: `CmsPage`, `CmsPageVersion`, `CmsSection`, `CmsMedia`, `CmsPublishEvent`.
- Permissions: granular `cms.page.*` / `cms.media.*` (bootstrap maps roles; keep aliases where needed for guards).

## Architecture

- Domain validation (Zod) in `src/domain/*`.
- Server services in `src/server/companies`, `applications`, `cms`, `invitations`.
- Mutations via `createServerFn` + `require*` guards + `recordAuditEvent`.
- One nav source: `src/lib/app-nav.ts`.
- CMS sections = first-party React components + Zod config schemas (no raw HTML/JS).

## Explicitly deferred

Autopart, orders/quotes/invoices logic, pricing engine, email delivery, full Elementor parity, Phase 3.

## Deploy

Existing Coolify entrypoint only: migrate deploy → RBAC bootstrap → Nitro. No manual SQL.
