import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "../lib/supabase";
import { LoginPage } from "../pages/LoginPage";
import { MfaEnforcementGate } from "./MfaEnforcementGate";
import { PlatformAdminGate } from "./PlatformAdminGate";

interface Props {
  children: ReactNode;
}

/**
 * Resolves the staff session and hands control to MfaEnforcementGate, which
 * redirects to the wizard at /onboarding/mfa when the user has no factor
 * and otherwise lets the request through. AAL2 step-up for individual
 * destructive actions is handled by MfaStepUpModal mounted at the shell.
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

  return (
    <PlatformAdminGate>
      <MfaEnforcementGate>{children}</MfaEnforcementGate>
    </PlatformAdminGate>
  );
}
