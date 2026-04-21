# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

RUN addgroup -S appuser && adduser -S appuser -G appuser

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production \
    PORT=8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8000/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

USER appuser
EXPOSE 8000

CMD ["node", "dist/index.js"]
