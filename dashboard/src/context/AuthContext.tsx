import React, { createContext, useContext } from "react";
import {
  AUTH_STORAGE_EVENT,
  StoredAuthSession,
  StoredAuthUser,
  clearStoredAuthSession,
  readStoredAuthSession,
  readStoredAuthUser,
  writeStoredAuthSession,
} from "../auth/authStorage";
import {
  getSupabaseClient,
  getSupabaseStoredSession,
  sessionFromSupabaseSession,
  signOutSupabase,
} from "../auth/supabaseAuth";

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
  const [storedSession, setStoredSession] = React.useState<StoredAuthSession | null>(() => readStoredAuthSession());
  const [storedUser, setStoredUser] = React.useState<StoredAuthUser | null>(() => readStoredAuthUser());

  const syncAuthState = React.useCallback(() => {
    setStoredSession(readStoredAuthSession());
    setStoredUser(readStoredAuthUser());
  }, []);

  React.useEffect(() => {
    syncAuthState();

    window.addEventListener("storage", syncAuthState);
    window.addEventListener(AUTH_STORAGE_EVENT, syncAuthState);

    return () => {
      window.removeEventListener("storage", syncAuthState);
      window.removeEventListener(AUTH_STORAGE_EVENT, syncAuthState);
    };
  }, [syncAuthState]);

  React.useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    let active = true;

    void getSupabaseStoredSession()
      .then((session) => {
        if (!active || !session) {
          return;
        }

        writeStoredAuthSession(session);
        syncAuthState();
      })
      .catch(() => {
        // Preserve non-Supabase sessions such as QA preview access.
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        writeStoredAuthSession(sessionFromSupabaseSession(session));
      } else if (readStoredAuthSession()?.authProvider === "supabase") {
        clearStoredAuthSession();
      }

      syncAuthState();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [syncAuthState]);

  const user = sessionUser(storedSession, storedUser);
  const accessMode: AuthAccessMode = storedSession
    ? "authenticated"
    : storedUser
      ? "preview"
      : "anonymous";

  const logout = React.useCallback(() => {
    if (readStoredAuthSession()?.authProvider === "supabase") {
      void signOutSupabase().catch(() => {
        // Local cleanup still runs below.
      });
    }

    clearStoredAuthSession();
    setStoredSession(null);
    setStoredUser(null);
  }, []);

  const getAccessToken = React.useCallback(async (): Promise<string | null> => {
    const latestSession = readStoredAuthSession();
    if (!latestSession) {
      return null;
    }

    if (latestSession.authProvider !== "supabase") {
      if (latestSession.expiresAt > Date.now() + 60_000) {
        return latestSession.accessToken;
      }

      clearStoredAuthSession();
      setStoredSession(null);
      setStoredUser(null);
      return null;
    }

    try {
      const refreshed = await getSupabaseStoredSession();
      if (!refreshed) {
        clearStoredAuthSession();
        setStoredSession(null);
        setStoredUser(null);
        return null;
      }

      writeStoredAuthSession(refreshed);
      setStoredSession(refreshed);
      setStoredUser(refreshed.user);
      return refreshed.accessToken;
    } catch {
      clearStoredAuthSession();
      setStoredSession(null);
      setStoredUser(null);
      return null;
    }
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
