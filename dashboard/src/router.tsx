import { useCallback, useState } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type RouteObject,
} from "react-router-dom";
import {
  createTicket,
  getTicket,
  listTickets,
  type TicketPriority,
} from "./api/tickets";
import { readStoredAuthSession } from "./auth/authStorage";
import Layout from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import AgentActivity from "./pages/AgentActivity";
import AgentCatalog from "./pages/AgentCatalog";
import AgentDeploy from "./pages/AgentDeploy";
import AgentDetail from "./pages/AgentDetail";
import AgentTeamDetail from "./pages/AgentTeamDetail";
import ApiKeys from "./pages/ApiKeys";
import Approvals from "./pages/Approvals";
import AuthCallback from "./pages/AuthCallback";
import BudgetDashboard from "./pages/BudgetDashboard";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import ConnectorHealth from "./pages/ConnectorHealth";
import Dashboard from "./pages/Dashboard";
import ExecutionLogs from "./pages/ExecutionLogs";
import Integrations from "./pages/Integrations";
import LandingPage from "./pages/LandingPage";
import LLMProviders from "./pages/LLMProviders";
import Login from "./pages/Login";
import MCPIntegrations from "./pages/MCPIntegrations";
import McpServers from "./pages/McpServers";
import Memory from "./pages/Memory";
import MissionState from "./pages/MissionState";
import MyAgents from "./pages/MyAgents";
import NotificationsSettings from "./pages/NotificationsSettings";
import OrgStructure from "./pages/OrgStructure";
import Pricing from "./pages/Pricing";
import ProfileSettings from "./pages/ProfileSettings";
import Routines from "./pages/Routines";
import RunHistory from "./pages/RunHistory";
import RunMonitor from "./pages/RunMonitor";
import SecuritySettings from "./pages/SecuritySettings";
import Settings from "./pages/Settings";
import SocialAuthCallback from "./pages/SocialAuthCallback";
import StaffingPlanReview from "./pages/StaffingPlanReview";
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

async function ticketsLoader(): Promise<TicketsRouteData> {
  return listTickets({}, readStoredAuthSession()?.accessToken);
}

async function ticketDetailLoader({
  params,
}: {
  params: { ticketId?: string };
}): Promise<TicketDetailRouteData> {
  if (!params.ticketId) {
    throw new Error("Ticket ID is required.");
  }

  return getTicket(params.ticketId, readStoredAuthSession()?.accessToken);
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
    const created = await createTicket(
      buildCreateTicketPayload(payload),
      readStoredAuthSession()?.accessToken
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
      formData.set("attachmentNames", JSON.stringify(payload.attachmentNames));
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
      { path: "builder", element: <WorkflowBuilder /> },
      { path: "builder/:templateId", element: <WorkflowBuilder /> },
      { path: "templates", element: <Templates /> },
      { path: "templates/:templateId", element: <WorkflowBuilder /> },
      { path: "agents", element: <AgentCatalog /> },
      { path: "agents/:templateId", element: <AgentDetail /> },
      { path: "agents/deploy/:templateId", element: <AgentDeploy /> },
      { path: "agents/activity", element: <AgentActivity /> },
      { path: "agents/my", element: <MyAgents /> },
      { path: "agents/routines", element: <Routines /> },
      { path: "agents/team/:teamId", element: <AgentTeamDetail /> },
      { path: "approvals", element: <Approvals /> },
      { path: "integrations", element: <Integrations /> },
      { path: "integrations/health", element: <ConnectorHealth /> },
      { path: "integrations/mcp", element: <MCPIntegrations /> },
      { path: "logs", element: <ExecutionLogs /> },
      { path: "memory", element: <Memory /> },
      { path: "mission-state", element: <MissionState /> },
      { path: "monitor", element: <RunMonitor /> },
      { path: "history", element: <RunHistory /> },
      { path: "pricing", element: <Pricing /> },
      { path: "settings", element: <Settings /> },
      { path: "settings/api-keys", element: <ApiKeys /> },
      { path: "settings/integrations", element: <Integrations /> },
      { path: "settings/llm-providers", element: <LLMProviders /> },
      { path: "settings/mcp-servers", element: <McpServers /> },
      { path: "settings/notifications", element: <NotificationsSettings /> },
      { path: "settings/profile", element: <ProfileSettings /> },
      { path: "settings/security", element: <SecuritySettings /> },
      { path: "settings/ticketing-sla", element: <TicketSlaSettings /> },
      { path: "tickets", loader: ticketsLoader, action: ticketsAction, element: <TicketsRoute /> },
      { path: "tickets/:ticketId", loader: ticketDetailLoader, element: <TicketDetailRoute /> },
      { path: "tickets/actors/:actorType/:actorId", element: <TicketActorView /> },
      { path: "tickets/sla", element: <TicketSlaDashboard /> },
      { path: "tickets/team", element: <TicketTeamView /> },
      { path: "workspace/budget-dashboard", element: <BudgetDashboard /> },
      { path: "workspace/org-structure", element: <OrgStructure /> },
      { path: "workspace/staffing-plan", element: <StaffingPlanReview /> },
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
    title: readString(formData.get("title")),
    description: readString(formData.get("description")),
    priority: (readString(formData.get("priority")) || "medium") as TicketPriority,
    primaryActorKey: readString(formData.get("primaryActorKey")),
    collaboratorKeys: readStringArray(formData.get("collaboratorKeys")),
    dueDate: readString(formData.get("dueDate")),
    tags: readString(formData.get("tags")),
    attachmentNames: readStringArray(formData.get("attachmentNames")),
    externalSyncRequested: readString(formData.get("externalSyncRequested")) === "true",
  };
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
