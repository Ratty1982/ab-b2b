# Production deployment (Coolify / Docker)

## Startup sequence

The container `ENTRYPOINT` (`scripts/docker-entrypoint.sh`) runs **before** the
Nitro server accepts traffic:

1. Wait for Postgres connectivity (`scripts/wait-for-db.mjs`) — retries **only** transient connection errors
2. `node node_modules/prisma/build/index.js migrate deploy` (fail-fast; no retry on CLI/schema errors)
3. Production system bootstrap (`.output/bootstrap/run-production.mjs`)
   - Upsert permissions / system roles / role-permission maps
   - Optional initial SUPER_ADMIN from env
   - Idempotent CMS homepage seed (published draft) if missing
4. `node .output/server/index.mjs`

Prisma is invoked via its **package entrypoint** (`node_modules/prisma/build/index.js`),
not a copied `.bin` shim, so WASM/engine assets resolve correctly.

No Coolify Pre/Post Deployment Command is required for migrations or RBAC —
the image entrypoint handles it. If you already have a Pre-Deploy command that
runs migrate, remove it to avoid double-running (harmless but redundant).

## Required Coolify environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Coolify Postgres connection string |
| `AUTH_SECRET` | Yes | ≥ 32 chars; not the repo default |
| `APP_URL` | Yes | `https://b2b.automotivebrands.co.uk` |
| `NODE_ENV` | Yes | `production` |

## Optional one-time initial administrator

| Variable | Required together | Notes |
| --- | --- | --- |
| `INITIAL_ADMIN_EMAIL` | With password | Real work email |
| `INITIAL_ADMIN_PASSWORD` | With email | ≥ 10 characters |
| `INITIAL_ADMIN_NAME` | No | Defaults from email local-part |

Behaviour:

- **All absent** → bootstrap skips admin creation (safe for later deploys)
- **Partial** → bootstrap fails and the container does not start (misconfiguration)
- **First run** → creates Better Auth credential user + `SUPER_ADMIN`
- **Later runs** → ensures `SUPER_ADMIN` role; **never resets password**

### After first successful login

1. Confirm you can sign in at `/login`
2. **Remove `INITIAL_ADMIN_PASSWORD` from Coolify** (and ideally the email/name vars too)
3. Redeploy is fine without those vars — admin already exists

Do **not** set `ALLOW_PRODUCTION_SEED=true` in Coolify. That flag only unlocks the
development sample seed (`db:seed`), which creates `@example.invalid` users.

## Commands (local / ops)

```bash
bun run db:migrate:deploy          # apply migrations only
bun run db:bootstrap:production    # RBAC + optional initial admin
bun run db:seed                    # DEV ONLY — sample users/companies
```

## Log verification in Coolify

Look for:

```text
[ab:entrypoint] Waiting for database connectivity…
[ab:wait-for-db] Database ready (attempt 1)
[ab:entrypoint] Applying migrations (prisma migrate deploy)…
[ab:entrypoint] Migrations applied.
[ab:bootstrap] RBAC complete { permissions: …, roles: …, … }
[ab:bootstrap] Initial SUPER_ADMIN administrator created (you@…)
  — or — Administrator already exists …
  — or — … skipping initial admin creation
[ab:entrypoint] Starting Nitro server…
➜ Listening on: …
```

If migrate or bootstrap fails, the process exits non-zero immediately (no 30×
“Database not ready” loop for Prisma CLI/install errors) and Coolify should
mark the deploy unhealthy.

## Verify admin + RBAC

1. Open `https://b2b.automotivebrands.co.uk/login`
2. Sign in with `INITIAL_ADMIN_EMAIL` / password
3. Expect redirect to `/admin` (SUPER_ADMIN landing)
4. Unauthenticated `/portal` → redirect to `/login?returnTo=…`
5. Trade-only URLs remain forbidden for the admin class as designed by route guards

## Phase 2 deploy notes

- Migration `20260916210000_phase2_customer_cms` extends companies/contacts/addresses, adds invitations + CMS tables, and `SUSPENDED` company status.
- RBAC bootstrap now upserts ~55 permissions (adds `cms.page.*` / `cms.media.*`) and refreshes system role maps.
- Bootstrap also ensures a published CMS `home` page exists (idempotent). Public `/` reads **published** version only.
- No new required environment variables for Phase 2.
- Migration `20260917100000_cms_media_blob` adds `CmsMedia.bytes` so CMS uploads persist in Postgres (no S3 required). Coolify entrypoint already runs `migrate deploy`.
- No new required environment variables. Object storage vars remain unused.
- After deploy: open **Admin → Website → Homepage**, select the Hero, **Choose image**, upload or pick from the library, save draft, then publish. Public pages load images from `/api/cms-media/:id`.

## Image size / Coolify “exporting layers”

The runner image only includes Prisma CLI + `@prisma/client`, not the full Vite/Radix `node_modules` tree. A previous Coolify deploy compiled successfully then failed at `#28 exporting layers` (exit 255) because that layer was too large for the helper container.

If export still fails: free disk on the Coolify host (`docker system df` / `docker builder prune`) and raise the application build timeout (the compile itself is several minutes because `bun install` is slow on first pull).
- Invitations are created with `emailDeferred: true` until an email provider is configured — do not expect outbound mail.

