# Automotive Brands — Architecture

## Purpose

Convert the approved Lovable UX prototype into an independent production B2B platform for Automotive Brands, without AlphaOps, WordPress, WooCommerce, Shopify, or unapproved Supabase coupling.

## High-level diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                     Browser (approved UI)                   │
│   Public site │ Trade portal │ Sales/CRM │ Admin            │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼─────────────────────────────────────────────┐
│                 TanStack Start (Node / Coolify)             │
│  routes/ (presentation)                                     │
│  server/ (auth, RBAC, server functions, validation, CSRF) │
│  domain/ (pure pricing / credit / policy rules)             │
│  infra/  (Prisma, storage, email, Autopart adapters)        │
└───────┬───────────────────┬───────────────────┬─────────────┘
        │                   │                   │
   PostgreSQL            Object storage      Autopart/ERP
   (system of record     (documents/SDS)     (later SoT for
    for app domain)                           stock/invoices)
```

## Directory responsibilities

| Path | Responsibility |
| --- | --- |
| `src/routes` | URL map and presentation. Thin over time. |
| `src/components/ab` | Approved Automotive Brands visual system — preserve. |
| `src/components/ui` | shadcn primitives; do not restyle live screens onto these by default. |
| `src/domain` | Pure business rules. No React. Prefer no Prisma. |
| `src/server` | Trust boundary: env, sessions (Phase 1), RBAC, server functions, Zod. |
| `src/infra` | Prisma client, repositories, email, storage, integrations. |
| `src/lib` | Temporary prototype utilities + mock data until migrated. |
| `prisma` | Schema + migrations. |

## Trust boundary

Server code must **recompute** commercial values. Never accept as authoritative from the client:

- prices / discounts / VAT
- credit limits / available credit
- stock quantities
- roles / permissions
- company identity beyond “which of *my* authorised companies”

See `src/server/validation/trust.ts`.

## Authenticated navigation (stable contract)

**Authenticated navigation is a stable product contract. Do not reorganise, rename, remove or relocate existing navigation items as part of unrelated feature work.**

The only source of truth is `src/lib/app-nav.ts` (`BACK_OFFICE_NAV` / `TRADE_PORTAL_NAV`). See [navigation.md](./navigation.md).

## Public catalogue policy

- Anonymous: RRP allowed; trade price hidden; availability label allowed; **exact qty hidden**
- Authenticated trade: company pricing + detailed availability (Phases 1/3)
- Trade read-only: may view company pricing; must not place orders / mutate commercial data

## Auth / MFA readiness

Phase 1 wires **Better Auth** with HttpOnly cookies, RBAC, audit events, and acting context.  
See [authentication-rbac.md](./authentication-rbac.md). MFA schema is ready; enforcement for privileged roles is planned.

## Company model

- `User` = person  
- `Company` = B2B account  
- `CompanyUser` = many-to-many membership + company role  
- Internal staff do **not** need a fake company row  

## Orders / quotes

Line items store historical commercial snapshots (`sku`, `name`, `unitPrice`, `vatRate`, `lineTotal`) so changing live catalogue prices does not rewrite history.

## Autopart

Designed as a future adapter under `src/infra/integrations`. `externalRef` fields exist on company, variant, order, and invoice. No integration in Phase 0.

## Deployment

- Dev: `bun run dev` + `docker compose` Postgres  
- Prod: Docker multi-stage → Node running Nitro `node-server` output on Coolify  

## Phase map

0 Foundations  
1 Auth / RBAC ←  
2 Companies / applications  
3 Catalogue / pricing  
4 Trade portal  
5 Basket / orders  
6 CRM  
7 Quotes  
8 Admin / CMS  
9 Integrations  
10 Reporting  
