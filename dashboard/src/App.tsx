import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PublicClientApplication, EventType, AuthenticationResult } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "./auth/msalConfig";
import { AuthProvider, useAuth } from "./context/AuthContext";

const msalInstance = new PublicClientApplication(msalConfig);
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import RunMonitor from "./pages/RunMonitor";
import RunHistory from "./pages/RunHistory";
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
import MCPIntegrations from "./pages/MCPIntegrations";
import McpServers from "./pages/McpServers";
import ExecutionLogs from "./pages/ExecutionLogs";
import CheckoutSuccess from "./pages/CheckoutSuccess";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <>{children}</>;
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
            <Route path="monitor" element={<RunMonitor />} />
            <Route path="history" element={<RunHistory />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/llm-providers" element={<LLMProviders />} />
            <Route path="settings/profile" element={<ProfileSettings />} />
            <Route path="settings/security" element={<SecuritySettings />} />
            <Route path="settings/notifications" element={<NotificationsSettings />} />
            <Route path="settings/api-keys" element={<ApiKeys />} />
            <Route path="settings/mcp-servers" element={<McpServers />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="memory" element={<Memory />} />
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
