import React, { createContext, useContext } from "react";
import {
  useMsal,
  useIsAuthenticated,
  useAccount,
} from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  ClientConfigurationError,
  AccountInfo,
} from "@azure/msal-browser";
import { loginRequest, signupRequest } from "../auth/msalConfig";
import {
  StoredAuthUser,
  AUTH_STORAGE_EVENT,
  clearStoredAuthUser,
  readStoredAuthUser,
} from "../auth/authStorage";

export interface User {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
}

interface AuthContextValue {
  user: User | null;
  login: () => Promise<void>;
  signup: () => Promise<void>;
  logout: () => void;
  getAccessToken: () => Promise<string | null>;
  requireAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function accountToUser(account: AccountInfo): User {
  return {
    id: account.homeAccountId,
    email:
      (account.idTokenClaims as Record<string, string> | undefined)?.email ??
      account.username,
    name: account.name ?? account.username,
    tenantId: account.tenantId,
  };
}

function storedUserToUser(user: StoredAuthUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    tenantId: user.tenantId,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = useAccount(accounts[0] ?? null);
  const [storedUser, setStoredUser] = React.useState<StoredAuthUser | null>(() => readStoredAuthUser());
  const resolvedAccount = account ?? accounts[0] ?? instance.getActiveAccount?.() ?? null;

  React.useEffect(() => {
    const syncStoredUser = () => setStoredUser(readStoredAuthUser());

    window.addEventListener("storage", syncStoredUser);
    window.addEventListener(AUTH_STORAGE_EVENT, syncStoredUser);

    return () => {
      window.removeEventListener("storage", syncStoredUser);
      window.removeEventListener(AUTH_STORAGE_EVENT, syncStoredUser);
    };
  }, []);

  const user = isAuthenticated || resolvedAccount
    ? resolvedAccount
      ? accountToUser(resolvedAccount)
      : storedUser
        ? storedUserToUser(storedUser)
        : null
    : storedUser
      ? storedUserToUser(storedUser)
      : null;

  const login = async () => {
    await instance.loginRedirect(loginRequest);
  };

  const signup = async () => {
    await instance.loginRedirect(signupRequest);
  };

  const logout = () => {
    clearStoredAuthUser();
    if (!isAuthenticated || !resolvedAccount) {
      return;
    }
    instance.logoutRedirect({ postLogoutRedirectUri: "/login" });
  };

  // Silently acquire a fresh access token; falls back to interactive redirect.
  const getAccessToken = async (): Promise<string | null> => {
    if (!resolvedAccount) return null;
    try {
      const result = await instance.acquireTokenSilent({
        ...loginRequest,
        account: resolvedAccount,
      });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        await instance.acquireTokenRedirect({ ...loginRequest, account: resolvedAccount });
        return null;
      }
      // Authority mismatch (e.g. cached tokens from old ciamlogin.com authority
      // after switching to branded auth.helloautoflow.com domain) — clear stale
      // MSAL cache and redirect to fresh login under the current authority.
      if (
        err instanceof ClientConfigurationError ||
        (err instanceof Error && "errorCode" in err && (err as { errorCode: string }).errorCode === "authority_mismatch")
      ) {
        clearStoredAuthUser();
        Object.keys(localStorage)
          .filter((key) => key.startsWith("msal."))
          .forEach((key) => localStorage.removeItem(key));
        await instance.loginRedirect(loginRequest);
        return null;
      }
      return null;
    }
  };

  const requireAccessToken = async (): Promise<string> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Authentication session expired. Sign in again to continue.");
    }
    return accessToken;
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, getAccessToken, requireAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
