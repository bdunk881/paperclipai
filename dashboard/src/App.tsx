import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PublicClientApplication, EventType, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "./auth/msalConfig";
import { AuthProvider, useAuth } from "./context/AuthContext";
import {
  readQaPreviewToken,
  sanitizeQaPreviewRedirect,
  writeStoredAuthUser,
} from "./auth/authStorage";

const msalInstance = new PublicClientApplication(msalConfig);
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import WorkflowBuilder from "./pages/WorkflowBuilder";
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
import AgentCatalog from "./pages/AgentCatalog";
import AgentDetail from "./pages/AgentDetail";
import AgentDeploy from "./pages/AgentDeploy";
import MyAgents from "./pages/MyAgents";
import AgentActivity from "./pages/AgentActivity";
import Routines from "./pages/Routines";
import OrgStructure from "./pages/OrgStructure";
import BudgetDashboard from "./pages/BudgetDashboard";

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
    user?: { id: string; email: string; name: string; tenantId?: string };
  };

  if (!data.user) {
    window.history.replaceState({}, "", "/login?qaPreviewError=invalid");
    return;
  }

  writeStoredAuthUser(data.user);

  const nextPath =
    redirectTarget ?? `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", nextPath);
}

export default function App() {
  const [msalReady, setMsalReady] = useState(false);

  useEffect(() => {
    msalInstance
      .initialize()
      .then(() => msalInstance.handleRedirectPromise())
      .then((response) => {
        if (response?.account) {
          msalInstance.setActiveAccount(response.account);
        } else {
          const accounts = msalInstance.getAllAccounts();
          if (accounts.length > 0) {
            msalInstance.setActiveAccount(accounts[0]);
          }
        }
      })
      .then(() => maybeActivateQaPreviewAccess())
      .catch((err) => console.error("[MSAL] Initialization error:", err))
      .finally(() => setMsalReady(true));

    msalInstance.addEventCallback((event) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS &&
        (event.payload as AuthenticationResult)?.account
      ) {
        msalInstance.setActiveAccount(
          (event.payload as AuthenticationResult).account,
        );
      }
    });
  }, []);

  if (!msalReady) return null;
  return (
    <MsalProvider instance={msalInstance}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/waitlist" element={<LandingPage />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
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
            element={
              <PublicRoute>
                <Signup />
              </PublicRoute>
            }
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
            <Route path="agents/team/:teamId" element={<AgentTeamDetail />} />
            <Route path="monitor" element={<RunMonitor />} />
            <Route path="history" element={<RunHistory />} />
            <Route path="agents" element={<AgentCatalog />} />
            <Route path="agents/:templateId" element={<AgentDetail />} />
            <Route path="agents/deploy/:templateId" element={<AgentDeploy />} />
            <Route path="agents/my" element={<MyAgents />} />
            <Route path="agents/activity" element={<AgentActivity />} />
            <Route path="agents/routines" element={<Routines />} />
            <Route path="workspace/org-structure" element={<OrgStructure />} />
            <Route path="workspace/budget-dashboard" element={<BudgetDashboard />} />
            <Route path="settings" element={<Settings />} />
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
            <Route path="integrations/mcp" element={<MCPIntegrations />} />
            <Route path="logs" element={<ExecutionLogs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </MsalProvider>
  );
}
