# Temporary maintenance image for the pre-launch imported-sales reset.
# This is not the Coolify application image and it is not started by deploy.
# Build from the repository root:
#   docker build -f docker/imported-sales-reset-runner.Dockerfile -t ab-imported-sales-reset-runner .
#
# The image entrypoint is a dry-run until the operator passes --execute.
FROM oven/bun:1.2.23-alpine AS bundle
WORKDIR /src
COPY tsconfig.json ./
COPY scripts/imported-sales-reset.ts ./scripts/imported-sales-reset.ts
COPY src ./src
RUN bun build ./scripts/imported-sales-reset.ts \
  --outfile /out/imported-sales-reset.mjs \
  --target node \
  --external @prisma/client

FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
COPY --from=bundle /out/imported-sales-reset.mjs ./imported-sales-reset.mjs
RUN npm install --omit=dev @prisma/client@6.19.3 prisma@6.19.3 \
  && DATABASE_URL="postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public" \
    ./node_modules/.bin/prisma generate \
  && npm uninstall prisma \
  && npm cache clean --force
ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/imported-sales-reset.mjs"]
