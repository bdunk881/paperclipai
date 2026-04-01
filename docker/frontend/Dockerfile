# syntax=docker/dockerfile:1

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
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
FROM nginx:1.27-alpine AS runtime
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
