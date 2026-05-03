import React, { createContext, useContext } from "react";
import { Sentry } from "../sentry";
import {
  AUTH_STORAGE_EVENT,
  StoredAuthSession,
  StoredAuthUser,
  clearStoredAuthSession,
  getInMemoryRefreshToken,
  readStoredAuthSession,
  readStoredAuthUser,
  setInMemoryRefreshToken,
  writeStoredAuthSession,
} from "../auth/authStorage";
import { isSessionExpiring, refreshNativeAuthSession, sessionFromTokenResponse } from "../auth/nativeAuthClient";

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

  React.useEffect(() => {
    const syncAuthState = () => {
      setStoredSession(readStoredAuthSession());
      setStoredUser(readStoredAuthUser());
    };

    // Re-read storage on mount so sessions written during initial route
    // handling are not missed before listeners are attached.
    syncAuthState();

    window.addEventListener("storage", syncAuthState);
    window.addEventListener(AUTH_STORAGE_EVENT, syncAuthState);

    return () => {
      window.removeEventListener("storage", syncAuthState);
      window.removeEventListener(AUTH_STORAGE_EVENT, syncAuthState);
    };
  }, []);

  const user = sessionUser(storedSession, storedUser);

  React.useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email, username: user.name });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  const accessMode: AuthAccessMode = storedSession
    ? "authenticated"
    : storedUser
      ? "preview"
      : "anonymous";

  const logout = React.useCallback(() => {
    clearStoredAuthSession();
    setStoredSession(null);
    setStoredUser(null);
  }, []);

  const getAccessToken = React.useCallback(async (): Promise<string | null> => {
    const latestSession = readStoredAuthSession();

    if (!latestSession) {
      return null;
    }

    if (!isSessionExpiring(latestSession)) {
      return latestSession.accessToken;
    }

    const refreshToken = latestSession.refreshToken ?? getInMemoryRefreshToken();
    if (!refreshToken) {
      clearStoredAuthSession();
      setInMemoryRefreshToken(undefined);
      setStoredSession(null);
      setStoredUser(null);
      return null;
    }

    try {
      const refreshed = sessionFromTokenResponse(await refreshNativeAuthSession(refreshToken));
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
