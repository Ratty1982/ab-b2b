# Multi-stage production image for Coolify / Docker (Node runtime).
# Bun is used for installs; Node runs the Nitro node-server output.

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

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Nitro node-server output
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

# Run migrations on start if desired via Coolify pre-deploy; default just starts the app.
CMD ["node", ".output/server/index.mjs"]
