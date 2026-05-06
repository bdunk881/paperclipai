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

  const user = sessionUser(storedSession, storedUser);

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

  return (
    <AuthContext.Provider value={{ user, accessMode, logout, getAccessToken, requireAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
