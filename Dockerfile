# Multi-stage production image for Coolify / Docker (Node runtime).
# Bun installs/builds; Node runs Nitro node-server after migrate + bootstrap.

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

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Prisma engines on Alpine need OpenSSL
RUN apk add --no-cache openssl libc6-compat

# Nitro output + bundled bootstrap
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

# Prisma Client + CLI (migrate deploy) — same locked versions as build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

RUN chmod +x ./scripts/docker-entrypoint.sh ./node_modules/.bin/prisma

EXPOSE 3000

# migrate deploy → RBAC/admin bootstrap → Nitro server (fail-fast)
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
