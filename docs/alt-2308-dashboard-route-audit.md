# ALT-2308 Dashboard Route Audit

Phase 0 audit for the current dashboard SPA before the `react-router-dom` to RR7 SPA-mode migration in ALT-2302.

## Router baseline

- Entry point: `dashboard/src/main.tsx` bootstraps `<App />` after MSAL init.
- Router runtime: `dashboard/src/App.tsx` uses `<BrowserRouter>` with `<Routes>` and `<Route>` from `react-router-dom`.
- Error instrumentation: routes are wrapped by `Sentry.withSentryReactRouterV6Routing(Routes)`.
- Data APIs: there are no route loaders, actions, `useLoaderData`, `useFetcher`, TanStack Query, or SWR usages in `dashboard/src`.
- Current fetch model: all route data is loaded inside components with `useEffect`, imperative API helpers, direct `fetch`, or polling/stream setup.

## Layout and auth structure

- Providers: all routes render inside `<AuthProvider>` and `<WorkspaceProvider>`.
- Private shell: the `/` branch is wrapped in `<PrivateRoute>` and renders `dashboard/src/components/Layout.tsx`.
- Public shell: `/waitlist`, `/checkout/success`, `/auth/callback`, `/auth/social-callback`, `/login`, `/signup`, and `/reset-password` render outside `<Layout>`.
- Auth guard: `PrivateRoute` checks `useAuth().user` and redirects unauthenticated users to `/login`.
- Public redirect guard: `PublicRoute` redirects authenticated users from `/login` to `/`.
- Layout behavior: `<Layout>` provides the global nav, workspace switcher, profile/theme controls, and `<Outlet />`. It suppresses shell chrome for `/builder?...popout=1`.

## Route inventory

| Path | Component | Layout / guard | Current data + mutations | RR7 SPA migration note |
| --- | --- | --- | --- | --- |
| `/waitlist` | `LandingPage` | Public, no layout | No initial load. Form posts to `/api/waitlist-signup`. | Keep as public route. Good `action` candidate if/when this surface moves into RR7 forms. |
| `/checkout/success` | `CheckoutSuccess` | Public, no layout | Static success view. | Stays as-is. |
| `/auth/callback` | `AuthCallback` | Public, no layout | `useEffect` handles auth callback, persists session, navigates. | Keep client-side; not a loader/action candidate. |
| `/auth/social-callback` | `SocialAuthCallback` | Public, no layout | `useEffect` handles social auth callback, persists session, navigates. | Keep client-side; not a loader/action candidate. |
| `/login` | `Login` | PublicRoute, no layout | No route preload. Interactive login/signup/reset flows are handled in component/auth client code. | Likely stays component-driven because it depends on SDK/browser redirects. |
| `/signup` | redirect | Public, no layout | Redirects to `/login?mode=signup`. | Convert to RR7 redirect helper if desired. |
| `/reset-password` | redirect | Public, no layout | Redirects to `/login?mode=reset`. | Convert to RR7 redirect helper if desired. |
| `/` | `Dashboard` | `Layout` + `PrivateRoute` | `useEffect` + `Promise.all` for runs, approvals, agents, budgets, heartbeats, observability snapshots; starts SSE/poll fallback; ticket creation mutation from sidebar. | Strong loader candidate for initial dashboard snapshot. Ticket creation can become an `action`; live stream/polling remains component-level. |
| `/builder` | `WorkflowBuilder` | `Layout` + `PrivateRoute` | `useEffect` loads templates, LLM configs, and active template state. Mutations: `createTemplate`, `generateWorkflow`, `startRun`, `startRunWithFile`, `deployWorkflowAsTeam`. | Strong loader candidate for template/LLM bootstrap. Mutations map well to RR7 actions/fetchers, but graph editing stays client-side. |
| `/builder/:templateId` | `WorkflowBuilder` | `Layout` + `PrivateRoute` | Same as `/builder`, plus param-driven template fetch. | Strong loader candidate keyed by `templateId`. |
| `/templates` | `Templates` | `Layout` + `PrivateRoute` | `useEffect` calls `listTemplates`. | Straightforward loader candidate. |
| `/templates/:templateId` | `WorkflowBuilder` | `Layout` + `PrivateRoute` | Same data and mutations as builder detail. | Same migration shape as `/builder/:templateId`. |
| `/agents/team/:teamId` | `AgentTeamDetail` | `Layout` + `PrivateRoute` | `useEffect` fetches team detail via `getControlPlaneTeam`; also reads URL search params. | Good loader candidate. |
| `/monitor` | `RunMonitor` | `Layout` + `PrivateRoute` | `useEffect` loads runs and team metadata. Mutation: `debugStep`. | Loader candidate for initial run/team data; `debugStep` can move to action/fetcher. |
| `/history` | `RunHistory` | `Layout` + `PrivateRoute` | `useEffect` fetches runs and templates. | Good loader candidate. |
| `/agents` | `AgentCatalog` | `Layout` + `PrivateRoute` | `useEffect` fetches agent catalog templates. | Good loader candidate. |
| `/agents/:templateId` | `AgentDetail` | `Layout` + `PrivateRoute` | `useEffect` fetches a single catalog template from route params. | Good loader candidate. |
| `/agents/deploy/:templateId` | `AgentDeploy` | `Layout` + `PrivateRoute` | `useEffect` fetches template details. Form-driven deploy mutation calls `deployWorkflowAsTeam`; also uses direct `fetch` against configured API origin. | Loader + action candidate. Direct `fetch` path should be normalized during migration. |
| `/agents/my` | `MyAgents` | `Layout` + `PrivateRoute` | `useEffect` loads agents, budgets, heartbeat state, and token usage. | Good loader candidate. |
| `/agents/activity` | `AgentActivity` | `Layout` + `PrivateRoute` | `useEffect` loads agents, runs, and heartbeat snapshots. | Good loader candidate. |
| `/agents/routines` | `Routines` | `Layout` + `PrivateRoute` | `useEffect` loads agents and routines. | Good loader candidate. |
| `/mission-state` | `MissionState` | `Layout` + `PrivateRoute` | `useEffect` calls `apiGet` through `settingsClient` for mission/team state and derives multiple cards client-side. | Good loader candidate; derived presentation logic can remain in component. |
| `/workspace/staffing-plan` | `StaffingPlanReview` | `Layout` + `PrivateRoute` | `useEffect` loads role templates. Mutations: `generateTeamAssemblyPlan`, `provisionCompanyWorkspace`. | Loader + action candidate. |
| `/workspace/org-structure` | `OrgStructure` | `Layout` + `PrivateRoute` | `useEffect` fetches agents. | Good loader candidate. |
| `/workspace/budget-dashboard` | `BudgetDashboard` | `Layout` + `PrivateRoute` | `useEffect` fetches agents and budget snapshots. | Good loader candidate. |
| `/tickets` | `Tickets` | `Layout` + `PrivateRoute` | `useEffect` loads tickets and agent directory, registers actor profiles, syncs filters from query string. Mutation: `createTicket`. | Strong loader candidate with search-param input. Ticket creation is a clean action candidate. |
| `/tickets/sla` | `TicketSlaDashboard` | `Layout` + `PrivateRoute` | `useEffect` fetches SLA dashboard data plus actor profile metadata. | Good loader candidate. |
| `/tickets/team` | `TicketTeamView` | `Layout` + `PrivateRoute` | `useEffect` loads team ticket queue and actor profiles. | Good loader candidate. |
| `/tickets/actors/:actorType/:actorId` | `TicketActorView` | `Layout` + `PrivateRoute` | `useEffect` loads actor profile and queue data from params. | Good loader candidate. |
| `/tickets/:ticketId` | `TicketDetail` | `Layout` + `PrivateRoute` | `useEffect` loads ticket aggregate, memory entries, and agent directory; also polls every 30s. Mutations: `transitionTicket`, `addTicketUpdate`, close-request flows. | Strong loader candidate for initial aggregate. Polling and mention UX stay component-side; mutations map well to actions/fetchers. |
| `/settings` | `Settings` | `Layout` + `PrivateRoute` | Static settings index. | Stays as-is. |
| `/settings/ticketing-sla` | `TicketSlaSettings` | `Layout` + `PrivateRoute` | `useEffect` fetches SLA settings and actor metadata. Mutation: `updateTicketSlaSettings`. | Loader + action candidate. |
| `/settings/integrations` | `Integrations` | `Layout` + `PrivateRoute` | `useEffect` loads connector statuses by issuing direct authenticated `fetch` calls. Mutations: OAuth connect POST, API-key connect POST, disconnect DELETE. | Good loader candidate for status inventory. Connect/disconnect flows can use actions, but OAuth redirect initiation likely remains imperative. |
| `/settings/llm-providers` | `LLMProviders` | `Layout` + `PrivateRoute` | `useEffect` loads configs. Mutations: create, set default, delete config. | Loader + action candidate. |
| `/settings/profile` | `ProfileSettings` | `Layout` + `PrivateRoute` | `useEffect` loads profile state. Mutation: `apiPatch`. | Loader + action candidate. |
| `/settings/security` | `SecuritySettings` | `Layout` + `PrivateRoute` | Static form UI; no current backend load. | Stays mostly component-driven until a real backend contract exists. |
| `/settings/notifications` | `NotificationsSettings` | `Layout` + `PrivateRoute` | `useEffect` loads preferences, transports, and options. Mutations: update preference, update transport, send test notification. | Loader + action/fetcher candidate. |
| `/settings/api-keys` | `ApiKeys` | `Layout` + `PrivateRoute` | Static screen today. | Stays as-is until data contract exists. |
| `/settings/mcp-servers` | `McpServers` | `Layout` + `PrivateRoute` | `useEffect` loads server registry. Mutations: add server, delete server, test server, discover tools. | Loader + action/fetcher candidate. |
| `/pricing` | `Pricing` | `Layout` + `PrivateRoute` | No initial fetch. Checkout action posts to billing endpoint. | Action candidate; loader likely unnecessary. |
| `/approvals` | `Approvals` | `Layout` + `PrivateRoute` | `useEffect` loads approvals, notifications, teams, and HITL state. Mutations: resolve approval, create checkpoint/comment/request, update schedule. | Strong loader candidate with several action/fetcher candidates. |
| `/memory` | `Memory` | `Layout` + `PrivateRoute` | `useEffect` loads stats and entries. Mutations: search, write, delete memory entries. | Loader candidate for initial stats/list; search/write/delete fit actions or fetchers. |
| `/integrations` | `Integrations` | `Layout` + `PrivateRoute` | Same implementation as `/settings/integrations`. | Same migration shape as settings alias. Consider consolidating to one canonical path during RR7 work. |
| `/integrations/health` | `ConnectorHealth` | `Layout` + `PrivateRoute` | `useEffect` fetches connector health summary. | Good loader candidate. |
| `/integrations/mcp` | `MCPIntegrations` | `Layout` + `PrivateRoute` | `useEffect` loads registered integrations and live connector status via `apiGet` and direct client logic. | Good loader candidate. |
| `/logs` | `ExecutionLogs` | `Layout` + `PrivateRoute` | `useEffect` fetches observability payload; export uses direct fetch URL generation. | Loader candidate for initial dataset; export remains action/button flow. |
| `*` | redirect | Router fallback | Redirects every unknown path to `/`. | Use RR7 catchall redirect. |

## Shared data-fetching patterns

- Every routed page that loads remote data does it in `useEffect`.
- Most pages call thin wrappers from `dashboard/src/api/client.ts`, `agentApi.ts`, `agentCatalog.ts`, `tickets.ts`, `ticketingSla.ts`, `settingsClient.ts`, or `notifications.ts`.
- A few pages bypass API helpers and use direct `fetch`:
  - `LandingPage` waitlist submit
  - `Pricing` checkout session start
  - `Integrations` connector connect/disconnect flows
  - `ExecutionLogs` export URL usage
  - `AgentDeploy` includes direct fetch against configured API origin
- Live or repeated refresh behavior exists today in:
  - `Dashboard` via observability stream with polling fallback
  - `TicketDetail` via 30-second polling

## Top-level mutations

- Auth/session flows: `AuthCallback`, `SocialAuthCallback`, `Login`
- Waitlist + billing: `LandingPage`, `Pricing`, `CheckoutSuccess`
- Workflow authoring and execution: `WorkflowBuilder`, `AgentDeploy`, `RunMonitor`, `StaffingPlanReview`
- Ticketing: `Dashboard`, `Tickets`, `TicketDetail`, `TicketSlaSettings`
- Ops/admin: `Approvals`, `Memory`, `Integrations`, `McpServers`, `LLMProviders`, `NotificationsSettings`, `ProfileSettings`

## Auth guard notes

- The only route-level access control is the `PrivateRoute` / `PublicRoute` wrapper pair in `dashboard/src/App.tsx`.
- Token retrieval is deferred to page-level code through `useAuth().getAccessToken()` or `requireAccessToken()`.
- There is no loader-time auth enforcement yet because there are no loaders.
- `maybeActivateQaPreviewAccess()` runs before router render and can write an auth session based on the current URL.

## RR7 migration notes

- The migration can start by converting the existing route tree in `App.tsx` to RR7 route objects without changing page internals.
- Highest-value loader candidates:
  - `Dashboard`
  - `WorkflowBuilder`
  - `Tickets`
  - `TicketDetail`
  - `Approvals`
  - `Integrations`
- Highest-value action candidates:
  - `Tickets` create flow
  - `TicketDetail` transitions and updates
  - `WorkflowBuilder` save/run/deploy flows
  - `Integrations` connect/disconnect flows
  - `McpServers` add/delete/test/discover flows
  - `LLMProviders`, `NotificationsSettings`, `ProfileSettings`, `TicketSlaSettings`
- Low-risk stays-as-is:
  - Static screens (`Settings`, `ApiKeys`, `SecuritySettings`, `CheckoutSuccess`)
  - Auth callback pages that must keep browser-driven side effects
  - Real-time stream/poll logic after the initial route payload resolves
- Cleanup opportunities during Phase 4a:
  - Collapse duplicated `Integrations` routing (`/settings/integrations` and `/integrations`) behind one canonical path.
  - Move query-param-backed filtering on ticket screens into loader inputs so URL state and data state stay aligned.
  - Centralize direct `fetch` callsites behind RR7 actions or shared API helpers before adding optimistic UI.
