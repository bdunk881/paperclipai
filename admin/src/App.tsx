import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./auth/AuthGate";
import { SearchPage } from "./pages/SearchPage";
import { Customer360 } from "./pages/Customer360";
import { AuditLogPage } from "./pages/AuditLogPage";
import { PendingActionsPage } from "./pages/PendingActionsPage";
import { CreditsPoolPage } from "./pages/CreditsPoolPage";
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
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
