# Codex independent cross-stack audit - 2026-05-18

Scope checked:

- Backend mounts in `src/app.ts` and router files under `src/**/Routes.ts` / `src/**/routes.ts`.
- Dashboard routes from `dashboard/src/router.tsx`, pages in `dashboard/src/pages`, components in `dashboard/src/components`, and helpers in `dashboard/src/api`.
- Canonical migrations in `migrations/*.sql`.
- I did not read `HEL-139` or `docs/audit/2026-05-18-claude-review.md`.

## High

### Profile settings calls an unmounted backend router

Root cause: `ProfileSettings` loads and saves `/api/user/profile`, and `src/user/profileRoutes.ts` defines `/profile`, but `src/app.ts` never mounts `profileRoutes` under `/api/user`. The settings page will 404 for both profile load and save.

Pointers:

- `dashboard/src/pages/ProfileSettings.tsx:55`
- `dashboard/src/pages/ProfileSettings.tsx:100`
- `src/user/profileRoutes.ts:25`

### Mission State calls a control-plane endpoint that does not exist

Root cause: both the route loader and page refresh path call `/api/control-plane/teams/:id/mission-state`, but `controlPlaneRoutes` only exposes `/teams/:id`, `/teams/:id/spend`, and lifecycle mutation routes. The page has a real loader contract wired to a backend path that is not implemented.

Pointers:

- `dashboard/src/router.tsx:137`
- `dashboard/src/pages/MissionState.tsx:619`
- `src/controlPlane/controlPlaneRoutes.ts:390`
- `src/controlPlane/controlPlaneRoutes.ts:410`

### Run Monitor's AI debugger posts to a missing API

Root cause: `debugStep` posts to `${BASE}/debug/step`, which resolves to `/api/debug/step`, and `RunMonitor` calls it from the "Debug with AI" action. No backend route in `src/app.ts` or mounted router exposes `/api/debug/step`.

Pointers:

- `dashboard/src/api/client.ts:1103`
- `dashboard/src/api/client.ts:1109`
- `dashboard/src/pages/RunMonitor.tsx:491`

### Landing page waitlist form posts to the wrong path

Root cause: the backend mounts landing public routes at `/api/public/landing` and defines `POST /waitlist-signup` inside that router, but the landing page posts to `/api/waitlist-signup`. The waitlist CTA will hit a missing route.

Pointers:

- `dashboard/src/pages/LandingPage.tsx:132`
- `src/app.ts:376`
- `src/landing/publicApiRoutes.ts:201`

### Memory dashboard ignores the canonical `memory_entries` table

Root cause: the dashboard Memory page calls the `/api/memory` helper set, and `memoryRoutes` delegates all writes, reads, searches, stats, and deletes to `src/engine/memoryStore.ts`. That store is an in-process `Map`, while `migrations/002_workflow_runtime_persistence.sql` creates a canonical `memory_entries` table that the CRUD path never uses.

Pointers:

- `dashboard/src/pages/Memory.tsx:235`
- `dashboard/src/api/client.ts:1421`
- `src/memory/memoryRoutes.ts:61`
- `src/engine/memoryStore.ts:61`
- `migrations/002_workflow_runtime_persistence.sql:45`

### Approval notification listing and sweeping ignore persisted notifications

Root cause: `persistNotification` writes to `approval_notifications` when Postgres is enabled, but `approvalNotificationStore.list()` always reads only the in-memory `memoryStore`. The global `/api/approvals/notifications` endpoint and the notification coordinator both call `list()`, so production persisted notifications can be invisible to the dashboard and never swept.

Pointers:

- `migrations/005_approval_notifications.sql:3`
- `src/engine/approvalNotificationStore.ts:58`
- `src/engine/approvalNotificationStore.ts:142`
- `src/engine/approvalNotificationCoordinator.ts:30`
- `src/app.ts:976`

## Medium

### Runtime retention targets a table that migrations do not create

Root cause: `cleanupRuntimePersistenceHistory` deletes from `workflow_approval_requests`, but the migration creates `approval_requests`. If `WORKFLOW_RUNTIME_RETENTION_DAYS` is enabled, the cleanup sweep will fail on the non-existent table before later cleanup statements run.

Pointers:

- `src/db/runtimeRetention.ts:36`
- `migrations/002_workflow_runtime_persistence.sql:68`

### Routines page is wired to a stubbed backend endpoint

Root cause: `Routines` presents "Real schedules and next-run timing from the routines API", but `src/app.ts` implements `GET /api/routines` inline as `res.json({ routines: [] })`. There is no persisted routine source behind the page.

Pointers:

- `dashboard/src/pages/Routines.tsx:43`
- `dashboard/src/pages/Routines.tsx:87`
- `src/app.ts:397`

### Dashboard-facing backend routers have no dashboard consumers

Root cause: several authenticated routers serve real dashboard-shaped responses but have no matching non-test `dashboard/src` calls or imported helpers. These look like orphan backend surfaces rather than service-only webhooks.

Pointers:

- `src/app.ts:400` - `/api/knowledge`
- `src/app.ts:426` - `/api/reporting`
- `src/app.ts:428` - `/api/ticket-sync`
- `src/app.ts:430` - `/api/approval-policies`

### `llm_configs` migration is orphaned after LLM config storage moved

Root cause: `migrations/005_llm_configs.sql` creates `llm_configs`, but `llmConfigStore` now uses `CentralCredentialStore` with service `llm-config`, which persists through the shared credential registry and `connector_credentials`. No non-test source path references `llm_configs`.

Pointers:

- `migrations/005_llm_configs.sql:3`
- `src/llmConfig/llmConfigStore.ts:111`
- `src/integrations/shared/credentialRegistry.ts:239`

## Low

### Settings pages are explicitly decorative

Root cause: the Settings navigation includes pages that admit their backend contracts are missing. `ApiKeys` is "Coming soon" and says lifecycle endpoints are unavailable; `SecuritySettings` blocks password changes and session data because no backend security/session endpoint exists.

Pointers:

- `dashboard/src/pages/ApiKeys.tsx:14`
- `dashboard/src/pages/ApiKeys.tsx:22`
- `dashboard/src/pages/SecuritySettings.tsx:35`
- `dashboard/src/pages/SecuritySettings.tsx:62`
- `dashboard/src/pages/SecuritySettings.tsx:141`

### Mission and deployment UI still advertises missing backend contract pieces

Root cause: Mission State includes copy for unavailable current phase, dependency count, and timeline data, and Workflow Builder tells users start/stop lifecycle controls are not exposed. These are visible gaps between UI surfaces and backend contracts.

Pointers:

- `dashboard/src/pages/MissionState.tsx:331`
- `dashboard/src/pages/MissionState.tsx:366`
- `dashboard/src/pages/MissionState.tsx:436`
- `dashboard/src/pages/MissionState.tsx:538`
- `dashboard/src/pages/WorkflowBuilder.tsx:2849`

### Dead dashboard helper modules and helper functions remain in `dashboard/src/api`

Root cause: `dashboard/src/api/controlPlane.ts` duplicates control-plane helpers that pages import from `client.ts` instead, Proposal Builder helpers exist without a page or backend `/api/proposals` router, and agent/routine creation helpers are exported but not invoked by any page or component.

Pointers:

- `dashboard/src/api/controlPlane.ts:128`
- `dashboard/src/api/client.ts:1285`
- `dashboard/src/api/client.ts:1302`
- `dashboard/src/api/client.ts:1324`
- `dashboard/src/api/agentApi.ts:172`
- `dashboard/src/api/agentApi.ts:249`

### Initial sales schema tables have no application CRUD path

Root cause: `icp_profiles` and `email_sends` are canonical migration tables, but non-test backend source does not issue exact `FROM`, `INTO`, or `UPDATE` references for them. They are only present in migration DDL and constraints.

Pointers:

- `migrations/001_autoflow_schema.sql:37`
- `migrations/001_autoflow_schema.sql:82`
