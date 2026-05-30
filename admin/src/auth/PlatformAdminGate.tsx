import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ApiError } from "../lib/apiClient";
import { fetchAdminSession } from "../api/adminSessionApi";
import { getSupabaseClient } from "../lib/supabase";

const wrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "60vh",
  padding: 24,
};

const cardStyle: CSSProperties = {
  maxWidth: 480,
  textAlign: "center",
  border: "1px solid rgba(0,0,0,.12)",
  borderRadius: 8,
  padding: 24,
};

type GateState = "loading" | "ready" | "forbidden" | "error";

export function PlatformAdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchAdminSession();
        if (!cancelled) setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setState("forbidden");
          return;
        }
        const message = err instanceof Error ? err.message : "Could not verify platform-admin access.";
        setDetail(message);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return <div className="muted">Checking platform-admin access…</div>;
  }

  if (state === "forbidden") {
    return (
      <div role="alert" style={wrapStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 8px" }}>Not a platform admin</h2>
          <p className="muted" style={{ margin: "0 0 16px" }}>
            This account is signed in to autoflow-dev but does not have platform-admin access on
            dev-api. Use the same credentials as dev.app.helloautoflow.com, then ask an operator to
            grant <code>is_platform_admin</code> or add your user ID to{" "}
            <code>AUTOFLOW_STAFF_USER_IDS</code> on autoflow-api-dev.
          </p>
          <button
            type="button"
            onClick={() => void getSupabaseClient().auth.signOut()}
            className="primary"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div role="alert" style={wrapStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 8px" }}>Can&rsquo;t verify admin access</h2>
          <p className="muted" style={{ margin: "0 0 16px", fontSize: 12 }}>
            {detail}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
