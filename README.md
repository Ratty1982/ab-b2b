# Automotive Brands

Independent B2B trade platform for **Automotive Brands** (automotivebrands.co.uk): public brand site, multi-brand catalogue, trade portal, sales CRM, and internal admin.

This repository started as a Lovable UX prototype and is being converted into a production Node application. **It is completely separate from AlphaOps.**

## Current status (Phase 2)

| Layer | Status |
| --- | --- |
| Auth / RBAC / audit | Phase 1 live in production |
| Customers / companies | Production CRUD + workspace (contacts, users, addresses, commercial) |
| Trade applications | Public submit + admin approve/reject (idempotent) |
| CMS homepage | Draft/publish page builder + published homepage rendering |
| Autopart / orders / pricing engine / email send | Deferred |

Prototype catalogue screens may still use mock product data. Customer/application/CMS paths use Postgres.


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

Coolify production deploy (migrate + RBAC bootstrap + optional first admin):
[docs/deployment-coolify.md](docs/deployment-coolify.md).

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
# Local prod-like start (migrate + bootstrap + server):
bun run start:production
# Or server only (after migrate/bootstrap already done):
bun run start
```

### Useful scripts

| Script | Purpose |
| --- | --- |
| `bun run dev` | Vite / TanStack Start dev server |
| `bun run build` | Production build |
| `bun run start` | Run Nitro Node server output only |
| `bun run start:production` | Entrypoint: migrate → bootstrap → server |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Vitest (unit + RBAC integration) |
| `bun run lint` | ESLint |
| `bun run db:generate` | Prisma client generate |
| `bun run db:migrate` | Create/apply migrations (dev) |
| `bun run db:migrate:deploy` | Apply migrations (prod-safe) |
| `bun run db:bootstrap:production` | Upsert system RBAC (+ optional initial admin) |
| `bun run db:studio` | Prisma Studio |
| `bun run db:seed` | Dev-only sample users (not for Coolify) |

## Docker / Coolify

- `docker-compose.yml` — local Postgres 16
- `Dockerfile` — multi-stage Bun install/build + Node runner; **entrypoint** runs `prisma migrate deploy`, production RBAC bootstrap, then Nitro

Set at least `DATABASE_URL`, `AUTH_SECRET`, and `APP_URL` in Coolify.

Optional one-time first admin: `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` — remove the password after first successful login.

Do **not** run `db:seed` or set `ALLOW_PRODUCTION_SEED` in Coolify.

Full Coolify checklist: [docs/deployment-coolify.md](docs/deployment-coolify.md).

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
