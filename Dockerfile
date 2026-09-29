# syntax=docker/dockerfile:1.7
# Multi-stage production image for Coolify / Docker (Node runtime).
# Bun installs/builds; Node runs Nitro after migrate + bootstrap.
#
# Coolify's helper has previously killed `docker exec` with exit 255 after
# ~240s (during "exporting layers" / unpack / manifest list). Keep the install
# tree small and use BuildKit cache mounts so cold-ish rebuilds stay under the
# helper wall clock. Also raise the Coolify Docker build timeout to ≥15 minutes.
#
# The runner must NOT receive the full Vite/Radix/Playwright tree.
# Runtime: Prisma CLI + generated client + sharp + IMAP acquisition libs.
# Nitro already bundled the application into .output.

# Pin exact Bun patch (not floating `1.2-alpine`). Host Bun ≥1.4 writes
# lockfileVersion 2 which 1.2.x rejects — regenerate docker/runtime-bun.lock
# with this same version (see scripts/generate-runtime-lockfile.sh).
FROM oven/bun:1.2.23-alpine AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY prisma ./prisma
ENV NODE_ENV=production
# vite, nitro, and @vitejs/plugin-react live in dependencies so this still builds.
RUN --mount=type=cache,id=ab-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.2.23-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# Use the lockfile Prisma CLI — `bunx prisma` can fetch a different version and
# WASM-panic on generate (Coolify: psl/parser-database inline.rs OOB).
RUN node ./node_modules/prisma/build/index.js generate
RUN bun run build
# Bundle production bootstrap (Prisma client stays external — provided at runtime)
RUN bun build ./prisma/bootstrap/run-production.ts \
  --outfile .output/bootstrap/run-production.mjs \
  --target node \
  --external @prisma/client

# Minimal runtime packages — locked separately so Coolify does not re-resolve
# `bun add` on every deploy (that alone was ~50s and rewrote a lockfile).
FROM oven/bun:1.2.23-alpine AS runtime-deps
WORKDIR /app
COPY bunfig.toml ./
COPY docker/runtime-package.json ./package.json
COPY docker/runtime-bun.lock ./bun.lock
COPY prisma ./prisma
RUN --mount=type=cache,id=ab-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Prisma engines on Alpine need OpenSSL
RUN apk add --no-cache openssl libc6-compat

COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=build /app/scripts/wait-for-db.mjs ./scripts/wait-for-db.mjs
COPY --from=runtime-deps /app/node_modules ./node_modules
# Overlay the client generated from the lockfile install (build stage).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Do NOT copy node_modules/.bin/prisma as a single file — Docker dereferences
# the symlink and Prisma then looks for WASM next to .bin/ (ENOENT).
RUN chmod +x ./scripts/docker-entrypoint.sh \
  && test -f ./node_modules/prisma/build/index.js \
  && test -f ./node_modules/prisma/build/prisma_schema_build_bg.wasm \
  && test -e ./node_modules/.bin/prisma \
  && test -d ./node_modules/@prisma/client \
  && test -d ./node_modules/.prisma/client \
  && test -d ./node_modules/imapflow \
  && test -d ./node_modules/mailparser

EXPOSE 3000

# migrate deploy → RBAC/admin bootstrap → Nitro server (fail-fast)
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
