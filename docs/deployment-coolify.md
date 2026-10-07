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

Outbound SMTP is **not** configured via Coolify. Use **Admin → Settings → Email**
(SiteGround host/port/user/password). `AUTH_SECRET` encrypts the stored SMTP password.
Do not set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, or `SMTP_PASSWORD`.

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

## Image size / Coolify exit 255 during export or unpack

Coolify’s helper container has killed `docker exec … bash /artifacts/build.sh` with **exit 255** after the Vite compile succeeded:

- historically during `#28 exporting layers` (image too large)
- 22 Sep 2026 during `#31 unpacking` after a **~240 second** wall clock (07:52:06 → 07:56:06)
- 29 Sep 2026 during `#31 exporting manifest list` for SHA `5ddac27` after **~229s** (07:47:18 → 07:51:07). Application build had already finished (`✓ built`, bootstrap bundled, runner `COPY` steps done); the helper died while Docker was finishing the image export.

**This is not an application compile failure.** Raise the Coolify Docker build timeout before retrying.

### Bun version / lockfiles (authoritative)

| Item | Value |
|------|--------|
| Docker Bun image | **`oven/bun:1.2.23-alpine`** (pinned; do not use floating `1.2-alpine` alone) |
| Root `bun.lock` | `lockfileVersion: 1` — generate / refresh with Bun **1.2.x** (currently verified with 1.2.23) |
| `docker/runtime-bun.lock` | Slim production set from `docker/runtime-package.json`; must also be `lockfileVersion: 1` |

Bun **≥1.4** writes `lockfileVersion: 2`, which Coolify’s Bun **1.2.23** rejects with `Unknown lockfile version`. Never regenerate `docker/runtime-bun.lock` with a newer host Bun.

Regenerate the runtime lockfile:

```bash
# must be Bun 1.2.23
curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.23"
./scripts/generate-runtime-lockfile.sh
```

Keep `--frozen-lockfile` in the Dockerfile. Do not delete lockfiles to “make deploy work”.

The Docker **deps** stage runs `bun install --frozen-lockfile --production --ignore-scripts` so Playwright/eslint/vitest are not downloaded. `vite`, `nitro`, and `@vitejs/plugin-react` are production dependencies so the image can still compile. Runtime packages come from locked `docker/runtime-package.json` + `docker/runtime-bun.lock` (Prisma + sharp + `imapflow` + `mailparser`). Bun install cache is mounted via BuildKit (`id=ab-bun-cache`) to keep redeploys under the helper wall clock.

**Coolify setting (required on the host):** Application → Advanced / Build → **Docker build timeout** ≥ **15 minutes** (900s). A ~4-minute cap will keep killing first-pull / cold-cache builds even when the Dockerfile and app build are healthy.

If export/unpack still fails after the timeout is raised: on the Coolify server run `docker system df` / `docker builder prune` to free disk, then redeploy.

- Activation emails go through Admin → Settings → Email (TransactionalEmailService). Do not expect Coolify `SMTP_*` env vars.

## Phase 5 / 5A Autopart stock

- Additive migrations including `20260922140000_stock_in_app_scheduler`. Do **not** reset inventory.
- **Production source is EMAIL / IMAP.** Deploy does **not** import 231PO3NEW by itself until a London window is due (or staff poll live).
- After deploy: set IMAP env (`AUTOPART_STOCK_IMAP_*`, never `VITE_*`). The **in-application scheduler is on by default**. No Coolify Scheduled Task is required.
- Optional recovery: `POST https://<app>/api/internal/stock-sync` with `x-autopart-cron-secret` matching `AUTOPART_STOCK_CRON_SECRET`.
- Set `AUTOPART_STOCK_ENABLE_SCHEDULER=false` only if you must stop automatic imports.

Stock **imports** at **09:15, 12:15, 15:15, 18:15 Europe/London**. See [docs/autopart-stock-sync.md](autopart-stock-sync.md).


