# Error hygiene inventory (HEL-437)

Tracks places where **raw upstream or internal error strings** may reach end users. Raw detail belongs in server logs and Sentry only; customer copy should use `src/errors/userFacingError.ts` (API) and `dashboard/src/lib/userFacingError.ts` (defense in depth).

**Reference implementation (done in HEL-437):** `/hire` mission plan generation — `POST /api/missions/:missionId/generate-plan`, `Hire.tsx`, `HiringPlanReview.tsx` regenerate flow.

## API response shape (target)

```json
{
  "error": "Customer-safe sentence.",
  "code": "upstream_quota | upstream_auth | upstream_unavailable | plan_parse | timeout | generic",
  "reference": "8-char hex for support correlation"
}
```

## Dashboard — high priority (customer loop)

| Surface | Files | Pattern | Sub-issue |
|--------|-------|---------|-----------|
| Hire / plan generation | `Hire.tsx`, `HiringPlanReview.tsx`, `missionsApi.ts`, `missionRoutes.ts` | Was `err.message` with provider + parser detail | **HEL-437** (this ticket) |
| Hiring plan confirm | `HiringPlanReview.tsx`, `missionsApi.parseJsonOrError`, `hiringPlanRoutes.ts` | Concatenates `detail` with Postgres `pg_code`, constraints | [HEL-445](https://linear.app/helloautoflow/issue/HEL-445) |
| Workflow builder + copilot | `WorkflowBuilder.tsx`, `app.ts` `/api/workflows/generate` | `LLM call failed: …` | [HEL-446](https://linear.app/helloautoflow/issue/HEL-446) |
| LLM providers / credentials | `LLMProviders.tsx`, `Settings.tsx`, `llmConfigRoutes.ts` | Raw provider errors | [HEL-448](https://linear.app/helloautoflow/issue/HEL-448) |
| Connectors + health | `Connections.tsx`, `ConnectorHealth.tsx`, `src/integrations/*/routes.ts` | `error.message` from connector clients | [HEL-447](https://linear.app/helloautoflow/issue/HEL-447) |
| Billing / credits | `Billing.tsx`, `CreditsPanel.tsx`, `BuyCreditPackModal.tsx` | Stripe / hybrid-call messages | [HEL-444](https://linear.app/helloautoflow/issue/HEL-444) |
| Org structure / agents | `OrgStructure.tsx`, `AgentDetail.tsx`, `BudgetDashboard.tsx` | React Query `error.message` | [HEL-452](https://linear.app/helloautoflow/issue/HEL-452) |
| Tickets / approvals / activity | `Tickets.tsx`, `Approvals.tsx`, `AgentActivity.tsx` | Query error passthrough | [HEL-450](https://linear.app/helloautoflow/issue/HEL-450) |
| Auth (dashboard) | `Login.tsx` (passkey fallback), `AuthCallback.tsx`, `MfaEnforcementGate.tsx` | Partially mapped via `mapSupabaseAuthError`; gaps remain | [HEL-449](https://linear.app/helloautoflow/issue/HEL-449) |
| Route error boundary | `RouteErrorBoundary.tsx` | Shows raw `error.message` in mono panel | [HEL-451](https://linear.app/helloautoflow/issue/HEL-451) |
| Pro / debug tools | `StepDebugger.tsx`, `ToolCallSandbox.tsx` | Intentionally technical — gate behind admin/debug flag later | backlog |

## Dashboard — medium priority

| Surface | Files | Notes |
|--------|-------|-------|
| Mission detail / modals | `MissionDetail.tsx`, `StopMissionModal.tsx`, `CompleteMissionModal.tsx` | Generic `err.message` |
| MCP / security / workspaces | `MCPIntegrations.tsx`, `SecuritySettings.tsx`, `workspaces.ts` | API `readApiError` passthrough |
| Job description wizard | `JobDescriptionWizardModal.tsx`, `jobDescriptionWizard.ts` | Same LLM error pattern as generate-plan |
| Landing waitlist | `LandingPage.tsx` | Raw message fallback |
| trackedFetch timeouts | `trackedFetch.ts` | Technical `Request timed out after Ns: METHOD /path` |

## Backend — high priority

| Surface | Files | Notes |
|--------|-------|-------|
| Mission generate-plan | `missionRoutes.ts` | **Sanitized in HEL-437** |
| Workflow generate / run | `app.ts` | `LLM call failed: ${msg}` |
| Hiring plan confirm | `hiringPlanRoutes.ts` | `composeDetailMessage` adds PG internals to `detail` |
| Password auth | `passwordAuthRoutes.ts` | Returns Supabase `error.message` verbatim |
| Knowledge upload | `knowledge/routes.ts` | Parser errors in `error` field |
| Integration routes | `src/integrations/*/routes.ts` | `ConnectorError.message` to JSON |
| MFA routes | `mfaRoutes.ts`, `mfaService.ts` | Mixed — some mapped, some raw |
| Final 500 handler | `app.ts` | Non-production exposes `err.message` (dev-only) |

## Admin console

| Surface | Files | Notes |
|--------|-------|-------|
| Customer 360 / infra tabs | `Customer360.tsx`, `ActivityTab.tsx`, `BillingTab.tsx`, … | `(error as Error).message` |
| Credits pool | `CreditsPoolPage.tsx` | `ApiError.message` |
| Agent ask modal / queues | `AskAgentModal.tsx`, `JobInspectorModal.tsx` | Raw catch messages |
| MFA (admin) | `MfaEnforcementGate.tsx`, `MfaStepUpModal.tsx` | Same as dashboard auth gap |

## Existing sanitization (keep / extend)

| Helper | Location | Scope |
|--------|----------|-------|
| `mapSupabaseAuthError` | `dashboard/src/auth/supabaseAuth.ts` | Auth flows (unknown codes pass through) |
| `friendlyError` | `landing/app/signup/page.tsx` | Sign-up only |
| `humanizeTopologyError` | `dashboard/src/pages/workflowStepSetup.ts` | 3 workflow topology strings |
| `buildHiringPlanUserError` | `src/errors/userFacingError.ts` | Hiring plan LLM + parse (HEL-437) |
| Production 500 guard | `src/app.ts` | Unhandled errors → generic in production |

## Follow-up Linear sub-issues

Filed under parent **HEL-437** (Functionality Audit project):

- [HEL-445](https://linear.app/helloautoflow/issue/HEL-445) — Hiring plan confirm: Postgres `detail`
- [HEL-446](https://linear.app/helloautoflow/issue/HEL-446) — Workflow generate/copilot
- [HEL-448](https://linear.app/helloautoflow/issue/HEL-448) — LLM providers / credentials
- [HEL-447](https://linear.app/helloautoflow/issue/HEL-447) — Connector health + integration routes
- [HEL-444](https://linear.app/helloautoflow/issue/HEL-444) — Billing / credits surfaces
- [HEL-452](https://linear.app/helloautoflow/issue/HEL-452) — Org structure / agent / budget queries
- [HEL-450](https://linear.app/helloautoflow/issue/HEL-450) — Tickets / approvals / activity feeds
- [HEL-449](https://linear.app/helloautoflow/issue/HEL-449) — Auth error pass-through gaps
- [HEL-451](https://linear.app/helloautoflow/issue/HEL-451) — Route error boundary presentation
