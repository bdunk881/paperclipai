import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { MfaStepUpModal } from "./auth/MfaStepUpModal";
import { SearchPage } from "./pages/SearchPage";
import { Customer360 } from "./pages/Customer360";
import { AuditLogPage } from "./pages/AuditLogPage";
import { PendingActionsPage } from "./pages/PendingActionsPage";
import { CreditsPoolPage } from "./pages/CreditsPoolPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AgentWebhooksPage } from "./pages/settings/AgentWebhooksPage";
import { InfraOverviewPage } from "./pages/InfraOverview";
import { InfraComputePage } from "./pages/InfraCompute";
import { InfraEdgePage } from "./pages/InfraEdge";
import { InfraDataPage } from "./pages/InfraData";
import MfaEnrollmentWizard from "./pages/MfaEnrollmentWizard";
import { getSupabaseClient } from "./lib/supabase";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

function Shell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>AutoFlow Admin Console</h1>
        <nav className="nav">
          <Link to="/">Search</Link>
          <Link to="/pending-actions">Pending</Link>
          <Link to="/credits-pool">Credits pool</Link>
          <Link to="/audit">Audit</Link>
          <Link to="/infra/overview">Infra</Link>
          <Link to="/settings">Settings</Link>
          <button
            onClick={() => getSupabaseClient().auth.signOut()}
            style={{ background: "transparent", color: "#ffffff", borderColor: "rgba(255,255,255,.3)" }}
          >
            Sign out
          </button>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/customer/:userId" element={<Customer360 />} />
          <Route path="/pending-actions" element={<PendingActionsPage />} />
          <Route path="/credits-pool" element={<CreditsPoolPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/agent-webhooks" element={<AgentWebhooksPage />} />
          <Route path="/infra" element={<Navigate to="/infra/overview" replace />} />
          <Route path="/infra/overview" element={<InfraOverviewPage />} />
          <Route path="/infra/compute" element={<InfraComputePage />} />
          <Route path="/infra/edge" element={<InfraEdgePage />} />
          <Route path="/infra/data" element={<InfraDataPage />} />
          <Route path="/onboarding/mfa" element={<MfaEnrollmentWizard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <MfaStepUpModal />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <Shell />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
