import React, { createContext, useContext } from "react";
import {
  useMsal,
  useIsAuthenticated,
  useAccount,
} from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
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

  React.useEffect(() => {
    const syncStoredUser = () => setStoredUser(readStoredAuthUser());

    window.addEventListener("storage", syncStoredUser);
    window.addEventListener(AUTH_STORAGE_EVENT, syncStoredUser);

    return () => {
      window.removeEventListener("storage", syncStoredUser);
      window.removeEventListener(AUTH_STORAGE_EVENT, syncStoredUser);
    };
  }, []);

  const user = isAuthenticated && account ? accountToUser(account) : storedUser ? storedUserToUser(storedUser) : null;

  const login = async () => {
    await instance.loginRedirect(loginRequest);
  };

  const signup = async () => {
    await instance.loginRedirect(signupRequest);
  };

  const logout = () => {
    clearStoredAuthUser();
    if (!isAuthenticated || !account) {
      return;
    }
    instance.logoutRedirect({ postLogoutRedirectUri: "/login" });
  };

  // Silently acquire a fresh access token; falls back to interactive redirect.
  const getAccessToken = async (): Promise<string | null> => {
    if (!account) return null;
    try {
      const result = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        await instance.acquireTokenRedirect({ ...loginRequest, account });
      }
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
