import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "../lib/supabase";
import { LoginPage } from "../pages/LoginPage";
import { MfaGate } from "./MfaGate";

interface Props {
  children: ReactNode;
}

/**
 * Resolves the staff session, ensures the JWT has `aal2` (MFA), and only
 * then renders the rest of the app. Staff who lack MFA see only the
 * MfaGate enrollment page.
 */
export function AuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supa = getSupabaseClient();
    supa.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const sub = supa.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.data.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="muted">Checking session…</div>;
  if (!session) return <LoginPage />;

  return <MfaGate>{children}</MfaGate>;
}
