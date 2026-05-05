# ALT-2323 Phase 3 backend audit

## Summary

- `backend/` is a standalone FastAPI compatibility service.
- `src/` is the main Node/Express API and remains a separate runtime decision for Phase 3b.
- The pre-existing `docker/backend/Dockerfile` was building the Node service, which did not match the Phase 3a FastAPI-to-Fly.io scope.

## Evidence

- [backend/main.py](../backend/main.py) defines the FastAPI app with `/health` plus `/api/knowledge/*` routes.
- [backend/tests/test_knowledge_api.py](../backend/tests/test_knowledge_api.py) exercises the FastAPI contract directly with `TestClient`.
- [src/app.ts](../src/app.ts) mounts the broader Node API surface, including billing, integrations, workflows, memory, tickets, notifications, and knowledge routes.
- [src/index.ts](../src/index.ts) is the Node server entrypoint.

## Decision

For Phase 3a, `docker/backend/Dockerfile` and `fly.toml` now target the FastAPI service in `backend/`.

Phase 3b remains open and should treat the Node API as a separate service decision:

- if the migration branch keeps the Node API, it needs an explicit deployment target and artifact of its own
- if the migration branch replaces that API surface, the current Node-only routes need a retirement plan before cutover

## Next actions

- Deploy the FastAPI image from `docker/backend/Dockerfile` to Fly.io using `fly.toml`
- Run smoke checks against `/health` and the knowledge endpoints
- Decide whether `src/` moves to Cloudflare Workers or remains on a separate runtime
