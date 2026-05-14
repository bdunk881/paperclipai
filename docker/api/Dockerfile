# syntax=docker/dockerfile:1
#
# AutoFlow TS Express backend (src/app.ts) — production image.
#
# Multi-stage build:
#   1. `deps`    — install all deps for the TypeScript compile
#   2. `build`   — run tsc → dist/
#   3. `runtime` — slim Node with prod deps + Infisical CLI for secrets injection
#
# Entrypoint wrapper (docker/api/entrypoint.sh) loads secrets from Infisical
# when INFISICAL_TOKEN is set (matches the FastAPI pattern in
# docker/backend/Dockerfile so Fly deploy workflows can stay symmetrical).

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# Stage 1 — install ALL deps for tsc
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — compile TypeScript → dist/
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY package.json ./

RUN npx tsc

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="autoflow-api" \
      org.opencontainers.image.description="AutoFlow TS Express backend (src/app.ts)" \
      org.opencontainers.image.source="https://github.com/bdunk881/paperclipai" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Install Infisical CLI (used by entrypoint when INFISICAL_TOKEN is set).
# Matches the install pattern in docker/backend/Dockerfile so Fly machines
# can pull dev/staging/prod secrets the same way regardless of runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
    && apt-get update \
    && apt-get install -y --no-install-recommends infisical \
    && rm -rf /var/lib/apt/lists/*

# Production deps only (drops jest, ts-node, @types/*, etc.)
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Compiled output
COPY --from=build /app/dist ./dist

# SQL migrations — ensureSqlMigrationsApplied() resolves
# path.resolve(__dirname, "..", "..", "migrations") → /app/migrations
COPY migrations ./migrations

# Entrypoint wrapper
COPY docker/api/entrypoint.sh /usr/local/bin/autoflow-api-entrypoint
RUN chmod +x /usr/local/bin/autoflow-api-entrypoint

# Healthcheck — uses Node's built-in http module so we don't have to install curl
# in the runtime image. Route is /health (src/app.ts), not /api/health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "const http=require('http'); http.get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health',timeout:5000}, r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE 8080

ENTRYPOINT ["autoflow-api-entrypoint"]
CMD ["node", "dist/index.js"]
