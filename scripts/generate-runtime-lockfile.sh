#!/usr/bin/env bash
# Regenerate docker/runtime-bun.lock with the SAME Bun version Coolify uses.
# Docker stages pin oven/bun:1.2.23-alpine — do not generate with Bun ≥1.4
# (lockfileVersion 2 is rejected by 1.2.x as "Unknown lockfile version").
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN_VERSION="${BUN_VERSION:-1.2.23}"
OUT_DIR="${TMPDIR:-/tmp}/ab-runtime-lockgen-$$"

cleanup() { rm -rf "$OUT_DIR"; }
trap cleanup EXIT

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required" >&2
  exit 1
fi

current="$(bun --version)"
if [[ "$current" != "$BUN_VERSION" ]]; then
  echo "error: bun $current is active; need $BUN_VERSION to match Docker (oven/bun:${BUN_VERSION}-alpine)." >&2
  echo "Install with: curl -fsSL https://bun.sh/install | bash -s \"bun-v${BUN_VERSION}\"" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$ROOT/docker/runtime-package.json" "$OUT_DIR/package.json"
cat >"$OUT_DIR/bunfig.toml" <<'EOF'
[install]
saveTextLockfile = true
EOF

cd "$OUT_DIR"
bun install --lockfile-only --save-text-lockfile
# Prove the frozen path Coolify runs
rm -rf node_modules
cp "$ROOT/bunfig.toml" "$OUT_DIR/bunfig.toml"
bun install --frozen-lockfile --production --ignore-scripts
test -f node_modules/prisma/build/index.js
test -f node_modules/prisma/build/prisma_schema_build_bg.wasm
test -e node_modules/.bin/prisma
test -d node_modules/@prisma/client
test -d node_modules/imapflow
test -d node_modules/mailparser
test -d node_modules/sharp

cp "$OUT_DIR/bun.lock" "$ROOT/docker/runtime-bun.lock"
echo "Wrote docker/runtime-bun.lock (Bun $current, lockfileVersion $(rg -o '\"lockfileVersion\": [0-9]+' "$ROOT/docker/runtime-bun.lock"))"
