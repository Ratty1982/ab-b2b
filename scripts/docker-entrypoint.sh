#!/bin/sh
# Production container entrypoint (Coolify / Docker).
# Fail-fast: any migration or bootstrap failure prevents the server starting.
set -eu

echo "[ab:entrypoint] Starting Automotive Brands production bootstrap…"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ab:entrypoint] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "[ab:entrypoint] ERROR: AUTH_SECRET is not set" >&2
  exit 1
fi

PRISMA_BIN="./node_modules/.bin/prisma"
if [ ! -x "$PRISMA_BIN" ]; then
  echo "[ab:entrypoint] ERROR: Prisma CLI missing at $PRISMA_BIN" >&2
  exit 1
fi

echo "[ab:entrypoint] Applying migrations (prisma migrate deploy)…"
attempt=1
max_attempts=30
until "$PRISMA_BIN" migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[ab:entrypoint] ERROR: prisma migrate deploy failed after ${max_attempts} attempts" >&2
    exit 1
  fi
  echo "[ab:entrypoint] Database not ready (attempt ${attempt}/${max_attempts}); retrying in 2s…"
  attempt=$((attempt + 1))
  sleep 2
done
echo "[ab:entrypoint] Migrations applied."

echo "[ab:entrypoint] Running production RBAC / system bootstrap…"
node .output/bootstrap/run-production.mjs
echo "[ab:entrypoint] System bootstrap complete."

echo "[ab:entrypoint] Starting Nitro server…"
exec node .output/server/index.mjs
