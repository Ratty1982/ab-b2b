# Multi-stage production image for Coolify / Docker (Node runtime).
# Bun installs/builds; Node runs Nitro after migrate + bootstrap.
#
# The runner must NOT receive the full production node_modules tree
# (Vite, Radix, Playwright, etc.). Coolify failed at "exporting layers"
# with that payload. Runtime only needs Prisma CLI + generated client:
# Nitro already bundled the application into .output.

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

# Minimal runtime deps — aligned with bun.lock resolved Prisma 6.19.3
FROM oven/bun:1.2-alpine AS runtime-deps
WORKDIR /app
COPY bunfig.toml ./
COPY prisma ./prisma
RUN bun add prisma@6.19.3 @prisma/client@6.19.3
RUN bunx prisma generate

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

# Do NOT copy node_modules/.bin/prisma as a single file — Docker dereferences
# the symlink and Prisma then looks for WASM next to .bin/ (ENOENT).
RUN chmod +x ./scripts/docker-entrypoint.sh \
  && test -f ./node_modules/prisma/build/index.js \
  && test -f ./node_modules/prisma/build/prisma_schema_build_bg.wasm \
  && test -e ./node_modules/.bin/prisma \
  && test -d ./node_modules/@prisma/client \
  && test -d ./node_modules/.prisma/client

EXPOSE 3000

# migrate deploy → RBAC/admin bootstrap → Nitro server (fail-fast)
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
