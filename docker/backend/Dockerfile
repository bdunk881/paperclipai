# syntax=docker/dockerfile:1

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM python:3.12-slim AS deps
WORKDIR /app
COPY backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r requirements.txt

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /app
COPY --from=deps /install /usr/local
COPY backend/ ./

ARG BUILD_SHA=unknown
ARG BUILD_DATE=unknown
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_DATE=${BUILD_DATE}

# Run any compile steps (e.g., compile translations, generate protobuf)
RUN python -m compileall -q .

# ─── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/bdunk881/paperclipai"

# Non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app
COPY --from=builder /usr/local /usr/local
COPY --from=builder /app .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

USER appuser
EXPOSE 8000
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
