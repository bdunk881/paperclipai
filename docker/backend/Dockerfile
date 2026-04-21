# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_DATE=${BUILD_DATE}

RUN npm run build \
 && npm prune --omit=dev

FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

RUN addgroup -S appuser && adduser -S appuser -G appuser

WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null || exit 1

USER appuser
EXPOSE 3000
ENV NODE_ENV=production \
    PORT=3000

CMD ["node", "dist/index.js"]
