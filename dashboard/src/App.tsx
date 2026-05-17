import { useEffect, useState } from "react";
import * as Sentry from "@sentry/react";
import {
  readQaPreviewToken,
  sanitizeQaPreviewRedirect,
  writeStoredAuthUser,
} from "./auth/authStorage";
import { sessionFromAccessToken } from "./auth/tokenSession";
import { AuthProvider } from "./context/AuthContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { AppRouter } from "./router";
import { ToastProvider } from "./components/ToastProvider";

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
    window.history.replaceState({}, "", `/login?${failureSearch.toString()}`);
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

  writeStoredAuthUser(sessionFromAccessToken(data.accessToken, "preview").user);

  const nextPath = redirectTarget ?? `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", nextPath);
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    maybeActivateQaPreviewAccess()
      .catch((error) => console.error("[auth] QA preview activation error:", error))
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) return null;

  return (
    <Sentry.ErrorBoundary fallback={<p>An unexpected error occurred. Please refresh the page.</p>} showDialog>
      <AuthProvider>
        <WorkspaceProvider>
          {/* UX-7: single toast surface for the entire app. Wraps the
              router so every page (and every modal launched from a
              page) can call useToast() and have its messages stack
              bottom-right without each page wiring its own inline
              fade-out state. */}
          <ToastProvider>
            <AppRouter />
          </ToastProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
}
