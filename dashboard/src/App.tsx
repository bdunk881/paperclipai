import { useEffect, useState } from "react";
import {
  readQaPreviewToken,
  sanitizeQaPreviewRedirect,
  writeStoredAuthSession,
} from "./auth/authStorage";
import { sessionFromAppToken } from "./auth/nativeAuthClient";
import { AppRouter } from "./router";
import { AuthProvider } from "./context/AuthContext";

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

  writeStoredAuthSession(sessionFromAppToken(data.accessToken));

  const nextPath =
    redirectTarget ?? `${window.location.pathname}${window.location.hash}`;
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
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
