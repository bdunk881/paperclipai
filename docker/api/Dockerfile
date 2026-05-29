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

# HEL-322: pin a distinct cache id so this install doesn't share /root/.npm
# with the runtime stage's `npm ci`. The two stages run in parallel (runtime
# only depends on `build` at its later COPY --from=build), and a shared cache
# mount (default sharing=shared) let them corrupt each other's cacache —
# intermittent EEXIST/ENOENT in the deps stage.
RUN --mount=type=cache,target=/root/.npm,id=npm-cache-deps \
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
ARG TARGETARCH

# Infisical CLI is installed from a pinned GitHub release instead of the
# artifacts-cli setup script so Docker builds fail if the package digest drifts.
ARG INFISICAL_VERSION=0.43.88
ARG INFISICAL_LINUX_AMD64_SHA256=5c7b1ef15a2406d14127874b766054d2ee15304d776b1d239bf2d9fbd745aef9
ARG INFISICAL_LINUX_ARM64_SHA256=f0916aa3f16cf4ff235f9fede13b1d41b96f65162766e0c85b39beb40b2af87c

LABEL org.opencontainers.image.title="autoflow-api" \
      org.opencontainers.image.description="AutoFlow TS Express backend (src/app.ts)" \
      org.opencontainers.image.source="https://github.com/bdunk881/paperclipai" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Install Infisical CLI (used by entrypoint when INFISICAL_TOKEN is set).
# Version and SHA-256 are pinned above; update both from the Infisical CLI
# GitHub release assets when intentionally upgrading.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && infisical_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "$infisical_arch" in \
        amd64) infisical_sha256="${INFISICAL_LINUX_AMD64_SHA256}" ;; \
        arm64) infisical_sha256="${INFISICAL_LINUX_ARM64_SHA256}" ;; \
        *) echo "Unsupported Infisical CLI architecture: ${infisical_arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/infisical.deb "https://github.com/Infisical/cli/releases/download/v${INFISICAL_VERSION}/infisical_${INFISICAL_VERSION}_linux_${infisical_arch}.deb" \
    && echo "${infisical_sha256}  /tmp/infisical.deb" | sha256sum -c - \
    && apt-get install -y --no-install-recommends /tmp/infisical.deb \
    && test "$(infisical --version)" = "infisical version ${INFISICAL_VERSION}" \
    && rm -f /tmp/infisical.deb \
    && rm -rf /var/lib/apt/lists/*

# Production deps only (drops jest, ts-node, @types/*, etc.)
COPY package.json package-lock.json* ./
# HEL-322: distinct cache id (see deps stage). No `npm cache clean --force` —
# a type=cache mount is never part of the image layer, so cleaning it saves
# zero image size and only clobbers the shared cache mid-build.
RUN --mount=type=cache,target=/root/.npm,id=npm-cache-runtime \
    npm ci --omit=dev --no-audit --no-fund

# Compiled output
COPY --from=build /app/dist ./dist

# SQL migrations — ensureSqlMigrationsApplied() resolves
# path.resolve(__dirname, "..", "..", "migrations") → /app/migrations
COPY migrations ./migrations

# Agent Skills — src/skills/skillsLoader.ts resolves
# path.resolve(__dirname, "..", "..", "skills") which under /app/dist/
# becomes /app/skills. Without this COPY, the loader silently returns
# an empty map and no skill content reaches the model.
COPY skills ./skills

# Entrypoint wrapper
COPY docker/api/entrypoint.sh /usr/local/bin/autoflow-api-entrypoint
RUN chmod +x /usr/local/bin/autoflow-api-entrypoint

# Healthcheck — uses Node's built-in http module so we don't have to install curl
# in the runtime image. Route is /health (src/app.ts), not /api/health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "const http=require('http'); http.get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/health',timeout:5000}, r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE 8080

ENTRYPOINT ["autoflow-api-entrypoint"]
# DASH-29: --require ./dist/instrument.js loads Sentry's SDK before
# anything else. Belt-and-suspenders alongside the `import "./instrument"`
# first-line statement in src/index.ts. fly.api.dev.toml overrides this
# CMD via [processes]; staging + production use this Dockerfile default.
CMD ["node", "--require", "./dist/instrument.js", "dist/index.js"]
