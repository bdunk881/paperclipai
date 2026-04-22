# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_DATE=${BUILD_DATE}

RUN npm run build \
    && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

WORKDIR /app

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ENV NODE_ENV=production \
    PORT=3000 \
    BUILD_SHA=${BUILD_SHA} \
    BUILD_DATE=${BUILD_DATE}

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1))"

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
