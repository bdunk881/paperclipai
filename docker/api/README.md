# `docker/api/` — TS Express backend image

Production image for `src/app.ts` (the AutoFlow Node/Express backend). Deployed to Fly.io as `autoflow-api-{dev,staging,production}` per the [P2.5 — Backend consolidation](https://linear.app/helloautoflow/project/p25-backend-consolidation-ts-express-on-fly-a2f0e7006ec9) project.

Built and pushed by `.github/workflows/deploy-fly-api-{dev,staging,production}.yml` (added under HEL-83 / HEL-95 / HEL-96). The legacy Python image at `docker/backend/` is being retired in HEL-97.

## Layout

```
docker/api/
  ├── Dockerfile               # multi-stage build: deps → tsc → slim runtime
  ├── Dockerfile.dockerignore  # build-context exclusions, scoped to this Dockerfile
  ├── entrypoint.sh            # Infisical wrapper (mirrors docker/backend/entrypoint.sh)
  └── README.md                # this file
```

The `Dockerfile.dockerignore` lives next to its Dockerfile (instead of in repo root) so it doesn't starve sibling images (`docker/frontend/Dockerfile`, `docker/backend/Dockerfile`) of their source. BuildKit picks it up automatically — see the [Docker docs on filename and location](https://docs.docker.com/build/concepts/context/#filename-and-location).

## Build args

| Arg | Purpose | Default |
|---|---|---|
| `NODE_VERSION` | Node major to build/run against | `22` |
| `BUILD_SHA` | Git SHA stamped into image labels | `unknown` |
| `BUILD_DATE` | RFC3339 build timestamp | `unknown` |

## Runtime env

Required when running on Fly (the entrypoint enforces these):

| Var | Purpose |
|---|---|
| `INFISICAL_TOKEN` | Service-token auth for the Infisical CLI |
| `INFISICAL_PROJECT_ID` | The `autoflow` Infisical project ID |
| `INFISICAL_ENV` | One of `dev`, `staging`, `prod` (defaults to `prod`) |

The `infisical run` wrapper then injects every secret in that env into the child process. Anything the Express server reads from `process.env` (DATABASE_URL, JWT_SECRET, STRIPE_*, LLM provider keys, etc.) flows in through this layer — no Fly machine-level `fly secrets set` calls beyond `INFISICAL_TOKEN` itself.

Outside Fly (no `FLY_APP_NAME` / `FLY_MACHINE_ID` and no `INFISICAL_TOKEN`), the entrypoint just `exec`s the CMD directly — useful for local Docker testing where you'd inject env vars some other way.

`PORT` defaults to `8080` (Fly's expected internal port). `NODE_ENV=production` is set in the runtime stage.

## Build locally

```sh
docker build \
  -f docker/api/Dockerfile \
  --build-arg BUILD_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t autoflow-api:local \
  .
```

## Smoke test locally

```sh
# Run without Infisical — env vars passed directly. Needs at minimum a Postgres
# URL that resolves from inside the container. Use --network=host on Linux or
# host.docker.internal on macOS/Windows.

docker run --rm \
  -p 8080:8080 \
  -e DATABASE_URL="postgres://..." \
  -e JWT_SECRET="..." \
  autoflow-api:local

# In another shell:
curl -i http://localhost:8080/api/health
# → HTTP/1.1 200 OK, body { "status": "ok" }
```

## Image size targets

The runtime stage uses `node:22-slim` (Debian-based) plus the Infisical CLI. Target image size: **under 500 MB**. If you push past that, audit `node_modules/` for accidental dev deps slipping past `--omit=dev`, or any added system packages.

## Differences from `docker/backend/Dockerfile` (FastAPI, being retired)

| Aspect | FastAPI image (legacy) | TS Express image (this) |
|---|---|---|
| Runtime | `python:3.12-slim` + uvicorn | `node:22-slim` + Node runtime |
| Build | `pip install -r requirements.txt` | `npm ci` + `tsc` (multi-stage) |
| Healthcheck | Python `urllib.request` against `/health` | Node `http.get` against `/api/health` |
| Entrypoint | `infisical run` → uvicorn | `infisical run` → `node dist/index.js` |
| Internal port | 8080 | 8080 |
| Surface | ~11 routes (knowledge + OAuth relays) | ~59 routes (missions, agents, runs, billing, integrations, …) |

The two images are deployment-symmetric — Fly workflows can stay the same shape — but only one runs in production after the cleanup pass (HEL-97).
