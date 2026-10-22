#!/bin/sh
# Run the reset with Node, outside the Coolify application container.
# Dry-run when no arguments are passed. Does not run on container startup.
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
./scripts/build-imported-sales-reset-runner.sh
# npm sets this for every script, including this intentional manual runner.
unset npm_lifecycle_event npm_lifecycle_script
exec node ./scripts/maintenance/imported-sales-reset.mjs "$@"
