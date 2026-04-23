# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Install only runtime dependencies in the final image.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefer-offline

COPY --from=builder /app/dist ./dist

RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- "http://localhost:${PORT}/health" >/dev/null || exit 1

USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
