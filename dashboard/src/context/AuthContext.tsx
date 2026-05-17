import React, { createContext, useContext } from "react";
import { type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { Sentry } from "../sentry";
import {
  AUTH_STORAGE_EVENT,
  StoredAuthSession,
  StoredAuthUser,
  clearStoredAuthUser,
  readStoredAuthUser,
  writeStoredAuthUser,
} from "../auth/authStorage";
import {
  getSupabaseClient,
  getSupabaseStoredSession,
  sessionFromSupabaseSession,
  signOutSupabase,
} from "../auth/supabaseAuth";
import { clearStoredActiveWorkspaceId } from "../workspaces/workspaceStorage";

export interface User {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
}

export type AuthAccessMode = "authenticated" | "preview" | "anonymous";

interface AuthContextValue {
  user: User | null;
  accessMode: AuthAccessMode;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
  requireAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromStoredUser(user: StoredAuthUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tenantId: user.tenantId,
  };
}

function sessionUser(session: StoredAuthSession | null, storedUser: StoredAuthUser | null): User | null {
  if (session?.user) {
    return userFromStoredUser(session.user);
  }

  if (storedUser) {
    return userFromStoredUser(storedUser);
  }

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [storedSession, setStoredSession] = React.useState<StoredAuthSession | null>(null);
  const [storedUser, setStoredUser] = React.useState<StoredAuthUser | null>(() => readStoredAuthUser());

  const syncStoredUser = React.useCallback(() => {
    setStoredUser(readStoredAuthUser());
  }, []);

  React.useEffect(() => {
    syncStoredUser();

    window.addEventListener("storage", syncStoredUser);
    window.addEventListener(AUTH_STORAGE_EVENT, syncStoredUser);

    return () => {
      window.removeEventListener("storage", syncStoredUser);
      window.removeEventListener(AUTH_STORAGE_EVENT, syncStoredUser);
    };
  }, [syncStoredUser]);

  // Stabilize the user reference: sessionUser() builds a fresh object on
  // every call, so without useMemo every parent render hands consumers a
  // new `user` ref. That's a request-storm trap — any consumer effect
  // with `[..., user]` in its deps re-fires on every render, and at
  // least one such effect (in MCPIntegrations) used to feed back into
  // a setState that triggered the next render, looping until
  // express-rate-limit emitted a 429 and trackedFetch's global cooldown
  // locked the whole dashboard out for up to 60s. Key the memo on the
  // primitive identity fields so structurally-equal users stay ref-equal.
  //
  // Inputs are flat by construction (sessionUser only reads id/email/
  // name/tenantId), so reading those four keys is enough to detect a
  // real identity change without holding the parent objects.
  const userId = storedSession?.user?.id ?? storedUser?.id ?? null;
  const userEmail = storedSession?.user?.email ?? storedUser?.email ?? null;
  const userName = storedSession?.user?.name ?? storedUser?.name ?? null;
  const userTenantId =
    storedSession?.user?.tenantId ?? storedUser?.tenantId ?? null;
  const user = React.useMemo(
    () => sessionUser(storedSession, storedUser),
    // The four primitives above fully determine sessionUser's output;
    // storedSession/storedUser themselves are intentionally NOT deps
    // because their references churn on every refresh even when the
    // user identity is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, userEmail, userName, userTenantId],
  );

  React.useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email, username: user.name });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  React.useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let active = true;

    void getSupabaseStoredSession()
      .then((session) => {
        if (!active) {
          return;
        }

        setStoredSession(session);
        if (session?.user) {
          writeStoredAuthUser(session.user);
        }
      })
      .catch(() => {
        // Preserve preview-mode user state when Supabase is unavailable.
      });

    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!active) {
        return;
      }

      const nextSession = session ? sessionFromSupabaseSession(session) : null;
      setStoredSession(nextSession);

      if (nextSession?.user) {
        writeStoredAuthUser(nextSession.user);
      } else {
        clearStoredAuthUser();
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const accessMode: AuthAccessMode = storedSession
    ? "authenticated"
    : storedUser
      ? "preview"
      : "anonymous";

  const logout = React.useCallback(() => {
    if (storedSession?.authProvider === "supabase") {
      void signOutSupabase().catch(() => {
        // Local cleanup still runs below.
      });
    }

    clearStoredAuthUser();
    clearStoredActiveWorkspaceId();
    setStoredSession(null);
    setStoredUser(null);
  }, [storedSession]);

  const getAccessToken = React.useCallback(async (): Promise<string | null> => {
    const refreshed = await getSupabaseStoredSession().catch(() => null);
    setStoredSession(refreshed);

    if (refreshed?.user) {
      writeStoredAuthUser(refreshed.user);
      return refreshed.accessToken;
    }

    return null;
  }, []);

  const requireAccessToken = React.useCallback(async (): Promise<string> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Authentication session expired. Sign in again to continue.");
    }
    return accessToken;
  }, [getAccessToken]);

  // Memoize the context value so consumers see a stable object reference
  // when its constituent parts haven't changed. Otherwise every parent
  // render hands every consumer a fresh value, which (combined with the
  // user ref instability fix above) used to feed the integrations-page
  // request storm.
  const value = React.useMemo<AuthContextValue>(
    () => ({ user, accessMode, logout, getAccessToken, requireAccessToken }),
    [user, accessMode, logout, getAccessToken, requireAccessToken],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
