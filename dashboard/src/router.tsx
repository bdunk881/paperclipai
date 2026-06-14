import { useState } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLoaderData,
  useParams,
  type ActionFunctionArgs,
  type RouteObject,
} from "react-router-dom";
import { listAgents } from "./api/agentApi";
import {
  createTicket,
  getTicket,
  hydrateTicketActorProfiles,
  type TicketPriority,
} from "./api/tickets";
import { readStoredAuthUser } from "./auth/authStorage";
import { getSupabaseStoredSession } from "./auth/supabaseAuth";
import Layout from "./components/Layout";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { useAuth } from "./context/AuthContext";
import AgentTeamDetail from "./pages/AgentTeamDetail";
import AgentJobDescription from "./pages/AgentJobDescription";
import AgentStandingTasks from "./pages/AgentStandingTasks";
import AgentDetail from "./pages/AgentDetail";
import RunDetail from "./pages/RunDetail";
import AgentOAuthCallback from "./pages/AgentOAuthCallback";
import ApiKeys from "./pages/ApiKeys";
import Approvals from "./pages/Approvals";
import Assignments from "./pages/Assignments";
import AuthCallback from "./pages/AuthCallback";
import AuthConfirm from "./pages/AuthConfirm";
import EnvVars from "./pages/EnvVars";
import Evals from "./pages/Evals";
import EvalDetail from "./pages/EvalDetail";
import BudgetDashboard from "./pages/BudgetDashboard";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import AutoTopupSetupSuccess from "./pages/AutoTopupSetupSuccess";
import CreditPackSuccess from "./pages/CreditPackSuccess";
import Hire from "./pages/Hire";
import HiringPlanReview from "./pages/HiringPlanReview";
import Dashboard from "./pages/Dashboard";
import LandingPage from "./pages/LandingPage";
import Connections from "./pages/Connections";
import LLMProviders from "./pages/LLMProviders";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ConnectorHealth from "./pages/ConnectorHealth";
import McpServers from "./pages/McpServers";
import Memory from "./pages/Memory";
import SkillsTriage from "./pages/SkillsTriage";
import MissionState from "./pages/MissionState";
import MissionDetail from "./pages/MissionDetail";
import NotificationsSettings from "./pages/NotificationsSettings";
import OrgStructure from "./pages/OrgStructure";
import Pricing from "./pages/Pricing";
import PublicForm from "./pages/PublicForm";
import ProfileSettings from "./pages/ProfileSettings";
import SecuritySettings from "./pages/SecuritySettings";
import MfaEnrollmentWizard from "./pages/MfaEnrollmentWizard";
import { MfaEnforcementGate } from "./auth/MfaEnforcementGate";
import Settings from "./pages/Settings";
// HEL-213 PR I: user-avatar dropdown pages.
import Account from "./pages/Account";
import Members from "./pages/Members";
import Billing from "./pages/Billing";
import SocialAuthCallback from "./pages/SocialAuthCallback";
import TicketActorView from "./pages/TicketActorView";
import TicketDetail from "./pages/TicketDetail";
import TicketSlaSettings from "./pages/TicketSlaSettings";
import Routines from "./pages/Routines";
import PromptRoutineNew from "./pages/PromptRoutineNew";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import WorkflowBuilderSetupCoachDemo from "./pages/WorkflowBuilderSetupCoachDemo";
import {
  buildCreateTicketPayload,
  type CreateTicketRouteActionData,
  type CreateTicketRouteActionPayload,
  type TicketDetailRouteData,
} from "./routes/ticketRouteData";
import {
  activityLoader,
  approvalsLoader,
  budgetDashboardLoader,
  homeLoader,
  orgStructureLoader,
  ticketsLoader,
} from "./router/loaders";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <MfaEnforcementGate>{children}</MfaEnforcementGate>;
}

// Auth-only gate without MFA enforcement — used for the enrollment wizard
// itself so a user with no factors can reach it without redirect-looping.
function AuthOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

async function readCurrentAccessSession() {
  try {
    return await getSupabaseStoredSession();
  } catch {
    return null;
  }
}

async function hydrateActorsFromAccessToken(accessToken?: string): Promise<void> {
  if (!accessToken) return;

  const storedUser = readStoredAuthUser();
  const agents = await listAgents(accessToken).catch(() => []);
  hydrateTicketActorProfiles({
    agents,
    user: storedUser ? { id: storedUser.id, name: storedUser.name } : null,
  });
}

// Mirror withTypedLoaderErrors in ./router/loaders.ts: convert rate-limit
// errors thrown by API helpers into a thrown Response so RouteErrorBoundary
// can recognize them via isRouteErrorResponse.
async function withTypedLoaderErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && /rate.?limit|too many requests|\b429\b/i.test(err.message)) {
      throw new Response(err.message, { status: 429, statusText: "Too Many Requests" });
    }
    throw err;
  }
}

async function ticketDetailLoader({
  params,
}: {
  params: { ticketId?: string };
}): Promise<TicketDetailRouteData> {
  return withTypedLoaderErrors(async () => {
    if (!params.ticketId) {
      throw new Response("Ticket ID is required.", { status: 404 });
    }

    const session = await readCurrentAccessSession();
    const accessToken = session?.accessToken;
    const [aggregate] = await Promise.all([
      getTicket(params.ticketId, accessToken),
      hydrateActorsFromAccessToken(accessToken),
    ]);
    return aggregate;
  });
}

async function ticketsAction({ request }: ActionFunctionArgs): Promise<CreateTicketRouteActionData> {
  const formData = await request.formData();
  const payload = readCreateTicketActionPayload(formData);

  if (!payload.title.trim()) {
    return { ok: false, error: "Title is required." };
  }

  if (!payload.primaryActorKey) {
    return { ok: false, error: "Choose a primary assignee." };
  }

  try {
    const session = await readCurrentAccessSession();
    const created = await createTicket(
      buildCreateTicketPayload(payload),
      session?.accessToken
    );
    return {
      ok: true,
      aggregate: created,
      source: created.source,
      integrationWarnings: created.integrationWarnings,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create ticket.",
    };
  }
}

function TicketDetailRoute() {
  const initialData = useLoaderData() as TicketDetailRouteData;
  return <TicketDetail initialData={initialData} />;
}

const routes: RouteObject[] = [
  { path: "/waitlist", element: <LandingPage />, errorElement: <RouteErrorBoundary /> },
  {
    // HEL-397: guard the post-checkout page. It was public, so any visitor
    // saw "Your subscription is active" regardless of whether they paid.
    // The legitimate post-Stripe redirect lands here with a live session.
    path: "/checkout/success",
    element: (
      <PrivateRoute>
        <CheckoutSuccess />
      </PrivateRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/billing/credits/success",
    element: (
      <PrivateRoute>
        <CreditPackSuccess />
      </PrivateRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/billing/credits/auto-topup/success",
    element: (
      <PrivateRoute>
        <AutoTopupSetupSuccess />
      </PrivateRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  { path: "/auth/callback", element: <AuthCallback />, errorElement: <RouteErrorBoundary /> },
  { path: "/auth/confirm", element: <AuthConfirm />, errorElement: <RouteErrorBoundary /> },
  { path: "/auth/social-callback", element: <SocialAuthCallback />, errorElement: <RouteErrorBoundary /> },
  // HEL-497: agent-catalog OAuth popup redirect target. Backend redirects to
  // ${DASHBOARD_APP_URL}/agents/oauth/callback (agent-catalog/routes.ts). Kept
  // standalone (no PrivateRoute/Layout/MFA gate) so the popup renders, posts
  // the result to window.opener, and closes — gating it could redirect to
  // /login or /onboarding/mfa and break the postMessage handshake.
  { path: "/agents/oauth/callback", element: <AgentOAuthCallback />, errorElement: <RouteErrorBoundary /> },
  {
    path: "/login",
    element: (
      <PublicRoute>
        <Login />
      </PublicRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  { path: "/signup", element: <Navigate to="/login?mode=signup" replace /> },
  { path: "/reset-password", element: <ResetPassword />, errorElement: <RouteErrorBoundary /> },
  // HEL-775: public hosted form for a form_trigger workflow. Unauthenticated by
  // design (the workflow UUID is the bearer secret; the backend only resolves
  // workflows whose head is a form_trigger) — no PrivateRoute/Layout/MFA gate.
  { path: "/forms/:workflowId", element: <PublicForm />, errorElement: <RouteErrorBoundary /> },
  {
    path: "/onboarding/mfa",
    element: (
      <AuthOnlyRoute>
        <MfaEnrollmentWizard />
      </AuthOnlyRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/",
    element: (
      <PrivateRoute>
        <Layout />
      </PrivateRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, loader: homeLoader, element: <Dashboard /> },

      // Build pillar
      { path: "builder", element: <WorkflowBuilder /> },
      ...(import.meta.env.DEV
        ? [{ path: "builder/demo/setup-coach", element: <WorkflowBuilderSetupCoachDemo /> }]
        : []),
      { path: "builder/:templateId", element: <WorkflowBuilder /> },
      // HEL-208 / PR E: Templates renamed → Routines. Studio is reached
      // exclusively via row click → `/builder/:templateId`; the old
      // `/templates/:templateId` Studio-landing shortcut has been removed
      // alongside it. `/templates` still redirects below for stale links.
      { path: "routines", element: <Routines /> },
      { path: "routines/new-prompt", element: <PromptRoutineNew /> },
      // HEL-787: Evals — run a workflow over a dataset + measure (on the
      // HEL-776 eval API). List + create, then a per-row results view.
      { path: "evals", element: <Evals /> },
      { path: "evals/:evalId", element: <EvalDetail /> },

      // Run pillar
      // HEL-204 PR A: /agents/activity merged into Assignments → Activity tab.
      // Loader still pre-warms the observability cache so the tab renders
      // instantly when the redirect lands.
      { path: "agents/activity", loader: activityLoader, element: <Navigate to="/assignments?tab=activity" replace /> },
      // HEL-562: run detail / step timeline — makes a run's paper trail visible.
      { path: "runs/:runId", element: <RunDetail /> },
      { path: "agents/team/:teamId", element: <AgentTeamDetail /> },
      // Wave 3: per-agent Job Description editor + LLM-assisted wizard.
      // Linked from AgentTeamDetail and OrgStructure (via the agent card).
      { path: "agents/:agentId/job", element: <AgentJobDescription /> },
      // Wave 4: per-agent Standing Tasks (routines) management. Lists
      // scheduled work attached to the agent and lets the owner toggle
      // enabled / edit cron.
      { path: "agents/:agentId/standing-tasks", element: <AgentStandingTasks /> },
      // UX-5: per-agent detail hub. Owner sees presence + action toolbar
      // + job description preview + standing tasks summary + quick facts.
      // Must come BEFORE the catch-all `agents/:templateId` redirect
      // below or it'd get masked.
      { path: "agents/:agentId", element: <AgentDetail /> },
      { path: "approvals", loader: approvalsLoader, element: <Approvals /> },
      // HEL-204 PR A: Escalations merged into Approvals as a Queue sub-tab.
      // Old /escalations bookmarks land on the unified queue.
      { path: "escalations", element: <Navigate to="/approvals?tab=queue" replace /> },
      // HEL-204 PR A: Approval policies moved off Settings into the
      // Approvals → Policies sub-tab.
      { path: "settings/approvals", element: <Navigate to="/approvals?tab=policies" replace /> },
      { path: "mission-state", element: <MissionState /> },

      // Workforce pillar
      // HEL-23: Hire page — mission intake.
      { path: "hire", element: <Hire /> },
      // HEL-105: side-by-side review page for a drafted hiring plan.
      { path: "hire/plan/:missionId/:planId", element: <HiringPlanReview /> },
      { path: "missions/:missionId", element: <MissionDetail /> },
      { path: "workspace/budget-dashboard", loader: budgetDashboardLoader, element: <BudgetDashboard /> },
      { path: "workspace/org-structure", loader: orgStructureLoader, element: <OrgStructure /> },
      { path: "team", element: <Navigate to="/workspace/org-structure" replace /> },

      // Connect pillar
      // HEL-205: unified Connections hub with sub-tabs. The legacy direct
      // routes below still resolve (for deep-links from external surfaces),
      // and `/integrations`, `/settings/llm`, `/settings/mcp` redirect into
      // the hub with the right tab pre-selected.
      { path: "connections", element: <Connections /> },
      // HEL-751: the legacy MCPIntegrations marketplace is retired (replaced by
      // the Composio connections tab). Keep the path as a redirect so old
      // bookmarks / deep-links (e.g. ConnectorHealth reconnect) land in the hub.
      {
        path: "integrations/mcp",
        element: <Navigate to="/connections?tab=integrations" replace />,
      },
      // HEL-206 (PR C): encrypted env vars surface. Lives as a standalone
      // route until PR B (HEL-205) lands the Connections hub with tabs.
      { path: "env-vars", element: <EnvVars /> },
      // HEL-179: operator-visible health surface for every workspace connector
      // (status pills + Reconnect CTA on auth_failed). Backed by the existing
      // `GET /api/connectors/health` route + `getConnectorHealth()` typed
      // client that have been wired for months but never had a UI.
      { path: "integrations/health", element: <ConnectorHealth /> },
      { path: "memory", element: <Memory /> },
      // HEL-207: Workspace memory + the legacy /workspace/memory path are
      // both folded into /memory; the scope picker on Memory.tsx supersedes
      // the separate Workspace Memory page (deleted in PR D).
      { path: "settings/memory", element: <Navigate to="/memory" replace /> },
      { path: "workspace/memory", element: <Navigate to="/memory" replace /> },

      // HEL-213 PR I: user-avatar dropdown surfaces Account/Members/Billing
      // as their own top-level routes. The previous /settings/* sub-pages
      // that these absorb (general, security, profile, billing) redirect
      // to /account or /billing so bookmarks land somewhere useful.
      { path: "account", element: <Account /> },
      { path: "members", element: <Members /> },
      { path: "billing", element: <Billing /> },

      // Settings + per-tab sub-routes (still v2-chromed since #772). The
      // legacy /settings tab strip lives on /settings/tabs because /settings
      // itself now redirects to /account; the absorbed tabs (general,
      // security, profile, billing) also redirect. /settings/legacy-profile
      // + /settings/legacy-security keep the per-page editors mounted so the
      // imports stay used until Account.tsx reaches parity.
      { path: "settings", element: <Navigate to="/account" replace /> },
      { path: "settings/general", element: <Navigate to="/account" replace /> },
      { path: "settings/profile", element: <Navigate to="/account" replace /> },
      { path: "settings/security", element: <Navigate to="/account" replace /> },
      { path: "settings/billing", element: <Navigate to="/billing" replace /> },
      { path: "settings/tabs", element: <Settings /> },
      { path: "settings/legacy-profile", element: <ProfileSettings /> },
      { path: "settings/legacy-security", element: <SecuritySettings /> },
      { path: "settings/api-keys", element: <ApiKeys /> },
      { path: "settings/llm-providers", element: <LLMProviders /> },
      { path: "settings/mcp-servers", element: <McpServers /> },
      { path: "settings/skills", element: <SkillsTriage /> },
      { path: "settings/notifications", element: <NotificationsSettings /> },
      { path: "settings/mission-assignment-sla", element: <TicketSlaSettings /> },

      // HEL-204 PR A: unified Assignments hub with sub-tabs
      // (Queue · By mission · SLA · Activity · By team). Replaces the
      // tab-less /mission-assignments queue plus /agents/activity and
      // /settings/mission-assignment-sla surfaces. The ticket-detail and
      // actor routes still live under /mission-assignments for now since
      // those are detail panels rather than hub sub-tabs.
      { path: "assignments", loader: ticketsLoader, action: ticketsAction, element: <Assignments /> },

      // Mission assignments subsystem (HITL) — formerly "Tickets". Reachable
      // from Approvals. The pages cross-link each other; old /tickets* URLs
      // redirect into here so bookmarks / shared links keep working.
      { path: "mission-assignments", element: <Navigate to="/assignments" replace /> },
      { path: "mission-assignments/:ticketId", loader: ticketDetailLoader, element: <TicketDetailRoute /> },
      { path: "mission-assignments/actors/:actorType/:actorId", element: <TicketActorView /> },
      { path: "mission-assignments/sla", element: <Navigate to="/assignments?tab=sla" replace /> },
      { path: "mission-assignments/team", element: <Navigate to="/assignments?tab=team" replace /> },

      // Backwards-compat redirects for old /tickets* URLs.
      { path: "tickets", element: <Navigate to="/mission-assignments" replace /> },
      { path: "tickets/sla", element: <Navigate to="/mission-assignments/sla" replace /> },
      { path: "tickets/team", element: <Navigate to="/mission-assignments/team" replace /> },
      { path: "tickets/:ticketId", element: <RedirectTicketDetail /> },
      { path: "tickets/actors/:actorType/:actorId", element: <RedirectTicketActor /> },
      { path: "settings/ticketing-sla", element: <Navigate to="/settings/mission-assignment-sla" replace /> },

      { path: "pricing", element: <Pricing /> },

      // ---------------------------------------------------------------------
      // Redirects for old v1 routes that the v2 nav doesn't surface anymore.
      // Keeps stale bookmarks / share-links landing somewhere useful instead
      // of on half-converted v1 pages.
      // ---------------------------------------------------------------------
      // HEL-208 / PR E: legacy `/templates*` paths redirect to the
      // renamed Routines hub.
      { path: "templates", element: <Navigate to="/routines" replace /> },
      { path: "templates/:templateId", element: <RedirectTemplateToBuilder /> },
      { path: "agents", element: <Navigate to="/routines" replace /> },
      { path: "agents/my", element: <Navigate to="/workspace/org-structure" replace /> },
      { path: "agents/routines", element: <Navigate to="/routines" replace /> },
      // UX-5 note: the old catch-all `agents/:templateId` → /templates
      // redirect used to mask real agent IDs (so OrgStructure's
      // "View agent" links dead-ended). Removed; `agents/:agentId`
      // above now resolves to the AgentDetail hub. v1 deploy-template
      // URL keeps its redirect since `deploy/...` is structurally
      // distinct from a UUID.
      { path: "agents/deploy/:templateId", element: <Navigate to="/routines" replace /> },
      // HEL-205: route the legacy entry points into the new Connections hub
      // with the right tab pre-selected. Old direct routes above still
      // resolve for any external deep-links that bypass the hub.
      { path: "integrations", element: <Navigate to="/connections?tab=integrations" replace /> },
      { path: "settings/llm", element: <Navigate to="/connections?tab=models" replace /> },
      { path: "settings/mcp", element: <Navigate to="/connections?tab=mcp" replace /> },
      // HEL-179: `/integrations/health` redirect retired — real page mounted above.
      { path: "settings/integrations", element: <Navigate to="/connections?tab=integrations" replace /> },
      { path: "logs", element: <Navigate to="/agents/activity" replace /> },
      { path: "monitor", element: <Navigate to="/" replace /> },
      { path: "history", element: <Navigate to="/agents/activity" replace /> },
      { path: "workspace/staffing-plan", element: <Navigate to="/mission-state" replace /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
];

function createDashboardRouter() {
  return createBrowserRouter(routes);
}

export function AppRouter() {
  const [router] = useState(createDashboardRouter);
  return <RouterProvider router={router} />;
}

function readCreateTicketActionPayload(formData: FormData): CreateTicketRouteActionPayload {
  return {
    workspaceId: readString(formData.get("workspaceId")) || undefined,
    title: readString(formData.get("title")),
    description: readString(formData.get("description")),
    priority: (readString(formData.get("priority")) || "medium") as TicketPriority,
    primaryActorKey: readString(formData.get("primaryActorKey")),
    collaboratorKeys: readStringArray(formData.get("collaboratorKeys")),
    dueDate: readString(formData.get("dueDate")),
    tags: readString(formData.get("tags")),
    externalSyncRequested: readString(formData.get("externalSyncRequested")) === "true",
  };
}

/**
 * Backwards-compat redirect: old /tickets/:ticketId URL maps to the
 * new /mission-assignments/:ticketId route, preserving the dynamic
 * segment. The Navigate component can't interpolate URL params on its
 * own, so we read them with useParams and build the target manually.
 */
function RedirectTicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();
  return <Navigate to={`/mission-assignments/${ticketId ?? ""}`} replace />;
}

function RedirectTicketActor() {
  const { actorType, actorId } = useParams<{ actorType: string; actorId: string }>();
  return (
    <Navigate
      to={`/mission-assignments/actors/${actorType ?? ""}/${actorId ?? ""}`}
      replace
    />
  );
}

/**
 * HEL-208 / PR E: old `/templates/:templateId` deep-link used to drop the
 * user straight onto the Studio canvas. Studio is now only reachable via
 * the Routines hub row click, so redirect into `/builder/:templateId`
 * (which is the same destination, just under its real path).
 */
function RedirectTemplateToBuilder() {
  const { templateId } = useParams<{ templateId: string }>();
  return <Navigate to={`/builder/${templateId ?? ""}`} replace />;
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

// deploy-trigger: 2026-05-24T23:36:52Z — force clean rebuild
