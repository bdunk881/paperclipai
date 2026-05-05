import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import {
  readQaPreviewToken,
  sanitizeQaPreviewRedirect,
  writeStoredAuthSession,
} from "./auth/authStorage";
import { sessionFromAppToken } from "./auth/nativeAuthClient";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import Templates from "./pages/Templates";
import RunMonitor from "./pages/RunMonitor";
import RunHistory from "./pages/RunHistory";
import AgentTeamDetail from "./pages/AgentTeamDetail";
import LandingPage from "./pages/LandingPage";
import LLMProviders from "./pages/LLMProviders";
import Settings from "./pages/Settings";
import ProfileSettings from "./pages/ProfileSettings";
import SecuritySettings from "./pages/SecuritySettings";
import NotificationsSettings from "./pages/NotificationsSettings";
import ApiKeys from "./pages/ApiKeys";
import Pricing from "./pages/Pricing";
import Approvals from "./pages/Approvals";
import Memory from "./pages/Memory";
import Integrations from "./pages/Integrations";
import MCPIntegrations from "./pages/MCPIntegrations";
import McpServers from "./pages/McpServers";
import ExecutionLogs from "./pages/ExecutionLogs";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import AuthCallback from "./pages/AuthCallback";
import SocialAuthCallback from "./pages/SocialAuthCallback";
import AgentCatalog from "./pages/AgentCatalog";
import AgentDetail from "./pages/AgentDetail";
import AgentDeploy from "./pages/AgentDeploy";
import MyAgents from "./pages/MyAgents";
import AgentActivity from "./pages/AgentActivity";
import OrgStructure from "./pages/OrgStructure";
import BudgetDashboard from "./pages/BudgetDashboard";
import MissionState from "./pages/MissionState";
import StaffingPlanReview from "./pages/StaffingPlanReview";
import Tickets from "./pages/Tickets";
import TicketDetail from "./pages/TicketDetail";
import TicketTeamView from "./pages/TicketTeamView";
import TicketActorView from "./pages/TicketActorView";
import TicketSlaDashboard from "./pages/TicketSlaDashboard";
import TicketSlaSettings from "./pages/TicketSlaSettings";
import ConnectorHealth from "./pages/ConnectorHealth";
import { WorkspaceProvider } from "./context/WorkspaceContext";

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

async function maybeActivateQaPreviewAccess(): Promise<void> {
  const token = readQaPreviewToken(window.location.search);
  if (!token) return;

  const res = await fetch("/api/qa-preview-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  const redirectTarget = sanitizeQaPreviewRedirect(
    new URLSearchParams(window.location.search).get("qaPreviewRedirect")
  );

  if (!res.ok) {
    const failureSearch = new URLSearchParams();
    failureSearch.set("qaPreviewError", "invalid");
    const loginUrl = `/login?${failureSearch.toString()}`;
    window.history.replaceState({}, "", loginUrl);
    return;
  }

  const data = (await res.json()) as {
    accessToken?: string;
    user?: { id: string; email: string; name: string; tenantId?: string };
  };

  if (!data.user || !data.accessToken) {
    window.history.replaceState({}, "", "/login?qaPreviewError=invalid");
    return;
  }

  writeStoredAuthSession(sessionFromAppToken(data.accessToken));

  const nextPath =
    redirectTarget ?? `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", nextPath);
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    maybeActivateQaPreviewAccess()
      .catch((err) => console.error("[auth] QA preview activation error:", err))
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) return null;
  return (
    <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred. Please refresh the page.</p>} showDialog>
      <AuthProvider>
        <WorkspaceProvider>
          <BrowserRouter>
            <SentryRoutes>
              <Route path="/waitlist" element={<LandingPage />} />
              <Route path="/checkout/success" element={<CheckoutSuccess />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/social-callback" element={<SocialAuthCallback />} />
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <Login />
                  </PublicRoute>
                }
              />
              <Route
                path="/signup"
                element={<Navigate to="/login?mode=signup" replace />}
              />
              <Route
                path="/reset-password"
                element={<Navigate to="/login?mode=reset" replace />}
              />
              <Route
                path="/"
                element={
                  <PrivateRoute>
                    <Layout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="builder" element={<WorkflowBuilder />} />
                <Route path="builder/:templateId" element={<WorkflowBuilder />} />
                <Route path="templates" element={<Templates />} />
                <Route path="templates/:templateId" element={<WorkflowBuilder />} />
                <Route path="agents/team/:teamId" element={<AgentTeamDetail />} />
                <Route path="monitor" element={<RunMonitor />} />
                <Route path="history" element={<RunHistory />} />
                <Route path="agents" element={<AgentCatalog />} />
                <Route path="agents/:templateId" element={<AgentDetail />} />
                <Route path="agents/deploy/:templateId" element={<AgentDeploy />} />
                <Route path="agents/my" element={<MyAgents />} />
                <Route path="agents/activity" element={<AgentActivity />} />
                <Route path="mission-state" element={<MissionState />} />
                <Route path="workspace/staffing-plan" element={<StaffingPlanReview />} />
                <Route path="workspace/org-structure" element={<OrgStructure />} />
                <Route path="workspace/budget-dashboard" element={<BudgetDashboard />} />
                <Route path="tickets" element={<Tickets />} />
                <Route path="tickets/sla" element={<TicketSlaDashboard />} />
                <Route path="tickets/team" element={<TicketTeamView />} />
                <Route path="tickets/actors/:actorType/:actorId" element={<TicketActorView />} />
                <Route path="tickets/:ticketId" element={<TicketDetail />} />
                <Route path="settings" element={<Settings />} />
                <Route path="settings/ticketing-sla" element={<TicketSlaSettings />} />
                <Route path="settings/integrations" element={<Integrations />} />
                <Route path="settings/llm-providers" element={<LLMProviders />} />
                <Route path="settings/profile" element={<ProfileSettings />} />
                <Route path="settings/security" element={<SecuritySettings />} />
                <Route path="settings/notifications" element={<NotificationsSettings />} />
                <Route path="settings/api-keys" element={<ApiKeys />} />
                <Route path="settings/mcp-servers" element={<McpServers />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="approvals" element={<Approvals />} />
                <Route path="memory" element={<Memory />} />
                <Route path="integrations" element={<Integrations />} />
                <Route path="integrations/health" element={<ConnectorHealth />} />
                <Route path="integrations/mcp" element={<MCPIntegrations />} />
                <Route path="logs" element={<ExecutionLogs />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </SentryRoutes>
          </BrowserRouter>
        </WorkspaceProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}
