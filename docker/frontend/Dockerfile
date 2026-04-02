# syntax=docker/dockerfile:1

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
# Digest pinned 2026-04-02 — update via: docker pull node:20-alpine && docker inspect node:20-alpine --format='{{index .RepoDigests 0}}'
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS deps
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dashboard/ ./

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_BUILD_SHA=${BUILD_SHA}

RUN npm run build

# ─── Stage 3: Runtime (nginx) ─────────────────────────────────────────────────
# Digest pinned 2026-04-02 — update via: docker pull nginx:1.27-alpine && docker inspect nginx:1.27-alpine --format='{{index .RepoDigests 0}}'
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

# Copy built assets and nginx config
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Allow nginx to run as non-root
RUN chown -R appuser:appgroup /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx /var/run /var/log/nginx && \
    sed -i 's/user  nginx;/# user directive removed for non-root/' /etc/nginx/nginx.conf && \
    sed -i 's|pid        /var/run/nginx.pid;|pid        /tmp/nginx.pid;|' /etc/nginx/nginx.conf

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:80/health || exit 1

USER appuser
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
