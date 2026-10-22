#!/bin/sh
# Bundle the reset CLI for Node. The Coolify application image does not run this.
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
mkdir -p scripts/maintenance
bun build ./scripts/imported-sales-reset.ts \
  --outfile scripts/maintenance/imported-sales-reset.mjs \
  --target node \
  --external @prisma/client
echo "Built scripts/maintenance/imported-sales-reset.mjs"
