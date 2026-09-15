# Automotive Brands

Independent B2B trade platform for **Automotive Brands** (automotivebrands.co.uk): public brand site, multi-brand catalogue, trade portal, sales CRM, and internal admin.

This repository started as a Lovable UX prototype and is being converted into a production Node application. **It is completely separate from AlphaOps.**

## Current status (Phase 1)

| Layer | Status |
| --- | --- |
| Approved UI / routes | Preserved prototype (mock catalogue/CRM data) |
| TanStack Start + Vite | Production-oriented, Lovable-decoupled |
| PostgreSQL + Prisma | Phase 0 + Phase 1 migrations |
| Auth / sessions / RBAC / audit | Better Auth + relational RBAC |
| Autopart / Stripe / email provider | Not started (email adapter interface only) |

Prototype screens still read catalogue/CRM mocks from `src/lib/data.ts` and `src/lib/crm-data.ts`. Do not treat mock figures as live business data.

## Stack

- **Framework:** TanStack Start (React, TanStack Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 + Automotive Brands design tokens (`src/styles.css`)
- **Runtime:** Node.js (Docker / Coolify) — not Cloudflare Workers
- **Package manager:** Bun (`bun.lock` is authoritative)
- **Database:** PostgreSQL + Prisma
- **Auth:** Better Auth (HttpOnly cookies, server sessions, MFA-ready schema)

## Architecture

```
src/
  routes/          # File-based UI routes (presentation)
  components/ab/   # Approved Automotive Brands UI
  components/ui/   # shadcn primitives (mostly unused by live screens)
  domain/          # Pure business rules (permissions, role maps)
  server/          # Server functions, env, auth/RBAC boundaries
  infra/           # Prisma, Better Auth, email adapters
  lib/             # Prototype helpers + temporary mock data
```

See [docs/architecture.md](docs/architecture.md) and [docs/authentication-rbac.md](docs/authentication-rbac.md).

Original Lovable product brief: [docs/lovable-brief.md](docs/lovable-brief.md).

## Local setup

### Prerequisites

- Bun 1.2+
- Docker (for PostgreSQL) or another Postgres 16 instance
- Node 22+ (for production start of the Nitro output)

### Install

```bash
bun install
```

### Environment

```bash
cp .env.example .env
```

Required variables:

- `DATABASE_URL`
- `AUTH_SECRET` (≥ 32 chars; must not stay as the dev default in production)
- `APP_URL`

Optional for local seeding: `DEV_SEED_PASSWORD`.

Never put secrets in `VITE_*` variables.

### Database

```bash
docker compose up -d
bun run db:generate
bun run db:migrate
bun run db:seed   # development users @example.invalid — refused in production
```

### Development server

```bash
bun run dev
```

App defaults to [http://localhost:43127](http://localhost:43127).

### Production build

```bash
bun run build
bun run start
# starts: node .output/server/index.mjs
```

### Useful scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Vite / TanStack Start dev server |
| `bun run build` | Production build |
| `bun run start` | Run Nitro Node server output |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Vitest (unit + RBAC integration) |
| `bun run lint` | ESLint |
| `bun run db:generate` | Prisma client generate |
| `bun run db:migrate` | Create/apply migrations (dev) |
| `bun run db:migrate:deploy` | Apply migrations (prod) |
| `bun run db:studio` | Prisma Studio |
| `bun run db:seed` | Dev roles/users/company seed (not production) |

## Docker / Coolify

- `docker-compose.yml` — local Postgres 16
- `Dockerfile` — multi-stage Bun install/build + Node runner for Coolify

Set `DATABASE_URL`, `AUTH_SECRET`, and `APP_URL` in the Coolify environment. Run `prisma migrate deploy` as a release step before or on deploy. Do **not** run `db:seed` in production.

## Public catalogue policy

Anonymous visitors may see **RRP** and general availability (e.g. In Stock).  
They must **not** see trade/customer prices or **exact** stock quantities.

## Implementation phases

0. Architecture & foundations  
1. Auth, sessions, RBAC, MFA readiness ← current  
2. Companies, contacts, trade applications  
3. Products, catalogue, pricing  
4. Trade portal  
5. Basket / orders / checkout  
6. CRM  
7. Quotes  
8. Admin / CMS  
9. Integrations (Autopart, email, storage)  
10. Reporting / automation  

## Security notes

- CSRF middleware is enabled for server functions (`src/start.ts`)
- Baseline security headers are applied
- Client-supplied prices, discounts, VAT, credit, stock, and permissions must never be trusted — see `src/server/validation/trust.ts`
- Company IDs from the client must be re-verified server-side (`requireCompanyAccess`)

## License / ownership

Private Automotive Brands application code.
