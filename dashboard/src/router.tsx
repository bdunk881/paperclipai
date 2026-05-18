import { useCallback, useState } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useFetcher,
  useLoaderData,
  useParams,
  type ActionFunctionArgs,
  type RouteObject,
} from "react-router-dom";
import {
  createTicket,
  getTicket,
  listTickets,
  type TicketPriority,
} from "./api/tickets";
import { getSupabaseStoredSession } from "./auth/supabaseAuth";
import Layout from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import AgentActivity from "./pages/AgentActivity";
import AgentTeamDetail from "./pages/AgentTeamDetail";
import AgentJobDescription from "./pages/AgentJobDescription";
import AgentStandingTasks from "./pages/AgentStandingTasks";
import AgentDetail from "./pages/AgentDetail";
import ApiKeys from "./pages/ApiKeys";
import Approvals from "./pages/Approvals";
import AuthCallback from "./pages/AuthCallback";
import Escalations from "./pages/Escalations";
import BudgetDashboard from "./pages/BudgetDashboard";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import Hire from "./pages/Hire";
import HiringPlanReview from "./pages/HiringPlanReview";
import WorkspaceMemory from "./pages/WorkspaceMemory";
import Dashboard from "./pages/Dashboard";
import LandingPage from "./pages/LandingPage";
import LLMProviders from "./pages/LLMProviders";
import Login from "./pages/Login";
import MCPIntegrations from "./pages/MCPIntegrations";
import McpServers from "./pages/McpServers";
import Memory from "./pages/Memory";
import MissionState from "./pages/MissionState";
import NotificationsSettings from "./pages/NotificationsSettings";
import OrgStructure from "./pages/OrgStructure";
import Pricing from "./pages/Pricing";
import ProfileSettings from "./pages/ProfileSettings";
import SecuritySettings from "./pages/SecuritySettings";
import Settings from "./pages/Settings";
import SocialAuthCallback from "./pages/SocialAuthCallback";
import TicketActorView from "./pages/TicketActorView";
import TicketDetail from "./pages/TicketDetail";
import TicketSlaDashboard from "./pages/TicketSlaDashboard";
import TicketSlaSettings from "./pages/TicketSlaSettings";
import TicketTeamView from "./pages/TicketTeamView";
import Tickets from "./pages/Tickets";
import Templates from "./pages/Templates";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import {
  buildCreateTicketPayload,
  type CreateTicketRouteActionData,
  type CreateTicketRouteActionPayload,
  type TicketDetailRouteData,
  type TicketsRouteData,
} from "./routes/ticketRouteData";

function PrivateRoute({ children }: { children: React.ReactNode }) {
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

async function ticketsLoader(): Promise<TicketsRouteData> {
  const session = await readCurrentAccessSession();
  return listTickets({}, session?.accessToken);
}

async function ticketDetailLoader({
  params,
}: {
  params: { ticketId?: string };
}): Promise<TicketDetailRouteData> {
  if (!params.ticketId) {
    throw new Error("Ticket ID is required.");
  }

  const session = await readCurrentAccessSession();
  return getTicket(params.ticketId, session?.accessToken);
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

function TicketsRoute() {
  const initialData = useLoaderData() as TicketsRouteData;
  const fetcher = useFetcher<CreateTicketRouteActionData>();

  const submit = useCallback(
    (payload: CreateTicketRouteActionPayload) => {
      const formData = new FormData();
      formData.set("title", payload.title);
      formData.set("description", payload.description);
      formData.set("priority", payload.priority);
      formData.set("primaryActorKey", payload.primaryActorKey);
      formData.set("collaboratorKeys", JSON.stringify(payload.collaboratorKeys));
      formData.set("dueDate", payload.dueDate);
      formData.set("tags", payload.tags);
      formData.set("workspaceId", payload.workspaceId ?? "");
      formData.set("externalSyncRequested", String(payload.externalSyncRequested));
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher]
  );

  return (
    <Tickets
      initialData={initialData}
      routeAction={{
        data: fetcher.data,
        state: fetcher.state,
        submit,
      }}
    />
  );
}

function TicketDetailRoute() {
  const initialData = useLoaderData() as TicketDetailRouteData;
  return <TicketDetail initialData={initialData} />;
}

const routes: RouteObject[] = [
  { path: "/waitlist", element: <LandingPage /> },
  { path: "/checkout/success", element: <CheckoutSuccess /> },
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/auth/social-callback", element: <SocialAuthCallback /> },
  {
    path: "/login",
    element: (
      <PublicRoute>
        <Login />
      </PublicRoute>
    ),
  },
  { path: "/signup", element: <Navigate to="/login?mode=signup" replace /> },
  { path: "/reset-password", element: <Navigate to="/login?mode=reset" replace /> },
  {
    path: "/",
    element: (
      <PrivateRoute>
        <Layout />
      </PrivateRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },

      // Build pillar
      { path: "builder", element: <WorkflowBuilder /> },
      { path: "builder/:templateId", element: <WorkflowBuilder /> },
      { path: "templates", element: <Templates /> },
      { path: "templates/:templateId", element: <WorkflowBuilder /> },

      // Run pillar
      { path: "agents/activity", element: <AgentActivity /> },
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
      { path: "approvals", element: <Approvals /> },
      // DASH-46: Ask-the-CEO surface. Backend was live since HEL-92 but
      // no page consumed it (HEL-139 C3 + HEL-140 H3).
      { path: "escalations", element: <Escalations /> },
      { path: "mission-state", element: <MissionState /> },

      // Workforce pillar
      // HEL-23: Hire page — mission intake.
      { path: "hire", element: <Hire /> },
      // HEL-105: side-by-side review page for a drafted hiring plan.
      { path: "hire/plan/:missionId/:planId", element: <HiringPlanReview /> },
      { path: "workspace/budget-dashboard", element: <BudgetDashboard /> },
      { path: "workspace/org-structure", element: <OrgStructure /> },

      // Connect pillar
      { path: "integrations/mcp", element: <MCPIntegrations /> },
      { path: "memory", element: <Memory /> },
      // HEL-90/92: Workspace memory (instructions + knowledge + episodes)
      { path: "settings/memory", element: <WorkspaceMemory /> },

      // Settings + per-tab sub-routes (still v2-chromed since #772)
      { path: "settings", element: <Settings /> },
      { path: "settings/api-keys", element: <ApiKeys /> },
      { path: "settings/llm-providers", element: <LLMProviders /> },
      { path: "settings/mcp-servers", element: <McpServers /> },
      { path: "settings/notifications", element: <NotificationsSettings /> },
      { path: "settings/profile", element: <ProfileSettings /> },
      { path: "settings/security", element: <SecuritySettings /> },
      { path: "settings/mission-assignment-sla", element: <TicketSlaSettings /> },

      // Mission assignments subsystem (HITL) — formerly "Tickets". Reachable
      // from Approvals. The pages cross-link each other; old /tickets* URLs
      // redirect into here so bookmarks / shared links keep working.
      { path: "mission-assignments", loader: ticketsLoader, action: ticketsAction, element: <TicketsRoute /> },
      { path: "mission-assignments/:ticketId", loader: ticketDetailLoader, element: <TicketDetailRoute /> },
      { path: "mission-assignments/actors/:actorType/:actorId", element: <TicketActorView /> },
      { path: "mission-assignments/sla", element: <TicketSlaDashboard /> },
      { path: "mission-assignments/team", element: <TicketTeamView /> },

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
      { path: "agents", element: <Navigate to="/templates" replace /> },
      { path: "agents/my", element: <Navigate to="/workspace/org-structure" replace /> },
      { path: "agents/routines", element: <Navigate to="/templates" replace /> },
      // UX-5 note: the old catch-all `agents/:templateId` → /templates
      // redirect used to mask real agent IDs (so OrgStructure's
      // "View agent" links dead-ended). Removed; `agents/:agentId`
      // above now resolves to the AgentDetail hub. v1 deploy-template
      // URL keeps its redirect since `deploy/...` is structurally
      // distinct from a UUID.
      { path: "agents/deploy/:templateId", element: <Navigate to="/templates" replace /> },
      { path: "integrations", element: <Navigate to="/integrations/mcp" replace /> },
      { path: "integrations/health", element: <Navigate to="/integrations/mcp" replace /> },
      { path: "settings/integrations", element: <Navigate to="/integrations/mcp" replace /> },
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
