# Multi-stage production image for Coolify / Docker (Node runtime).
# Bun installs/builds; Node runs Nitro after migrate + bootstrap.
#
# Important: copy a COMPLETE production node_modules tree into the runner.
# Do NOT copy node_modules/.bin/prisma as a single file — Docker dereferences
# the symlink and Prisma then looks for WASM next to .bin/ (ENOENT).

FROM oven/bun:1.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

FROM oven/bun:1.2-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bunx prisma generate
RUN bun run build
# Bundle production bootstrap (Prisma client stays external — provided at runtime)
RUN bun build ./prisma/bootstrap/run-production.ts \
  --outfile .output/bootstrap/run-production.mjs \
  --target node \
  --external @prisma/client

# Fresh production dependency tree with correct package-relative layout + Prisma generate
FROM oven/bun:1.2-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY prisma ./prisma
ENV NODE_ENV=production
RUN bun install --frozen-lockfile --production
RUN bunx prisma generate

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Prisma engines on Alpine need OpenSSL
RUN apk add --no-cache openssl libc6-compat

# App artefacts
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=build /app/scripts/wait-for-db.mjs ./scripts/wait-for-db.mjs

# Complete production node_modules (prisma CLI + client + transitive deps + .bin symlinks)
COPY --from=prod-deps /app/node_modules ./node_modules

RUN chmod +x ./scripts/docker-entrypoint.sh \
  && test -f ./node_modules/prisma/build/index.js \
  && test -f ./node_modules/prisma/build/prisma_schema_build_bg.wasm \
  && test -e ./node_modules/.bin/prisma

EXPOSE 3000

# migrate deploy → RBAC/admin bootstrap → Nitro server (fail-fast)
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
