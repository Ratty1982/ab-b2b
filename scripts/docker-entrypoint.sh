#!/bin/sh
# Production container entrypoint (Coolify / Docker).
# Fail-fast: migration/bootstrap CLI failures prevent the server starting.
# DB readiness retries ONLY for transient connectivity — never for Prisma install errors.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ab:entrypoint] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "[ab:entrypoint] ERROR: AUTH_SECRET is not set" >&2
  exit 1
fi

# Invoke the package entrypoint — never a flattened/copied .bin wrapper.
# Prisma 6 resolves WASM/engine assets relative to node_modules/prisma/build/.
PRISMA_CLI="node ./node_modules/prisma/build/index.js"
if [ ! -f "./node_modules/prisma/build/index.js" ]; then
  echo "[ab:entrypoint] ERROR: Prisma CLI package missing at ./node_modules/prisma/build/index.js" >&2
  exit 1
fi
if [ ! -f "./node_modules/prisma/build/prisma_schema_build_bg.wasm" ]; then
  echo "[ab:entrypoint] ERROR: Prisma WASM asset missing (prisma_schema_build_bg.wasm)" >&2
  exit 1
fi

echo "[ab:entrypoint] Starting Automotive Brands production bootstrap…"

echo "[ab:entrypoint] Waiting for database connectivity…"
node ./scripts/wait-for-db.mjs

echo "[ab:entrypoint] Applying migrations (prisma migrate deploy)…"
# No retry loop here: schema/CLI/migration failures are deterministic and must fail the deploy.
if ! $PRISMA_CLI migrate deploy; then
  echo "[ab:entrypoint] ERROR: prisma migrate deploy failed" >&2
  exit 1
fi
echo "[ab:entrypoint] Migrations applied."

echo "[ab:entrypoint] Running production RBAC / system bootstrap…"
node .output/bootstrap/run-production.mjs
echo "[ab:entrypoint] System bootstrap complete."

echo "[ab:entrypoint] Starting Nitro server…"
exec node .output/server/index.mjs
