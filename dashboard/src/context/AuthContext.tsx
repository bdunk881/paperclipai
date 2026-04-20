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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = useAccount(accounts[0] ?? null);

  const user = isAuthenticated && account ? accountToUser(account) : null;

  const login = async () => {
    await instance.loginRedirect(loginRequest);
  };

  const signup = async () => {
    await instance.loginRedirect(signupRequest);
  };

  const logout = () => {
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

// The auth hook intentionally lives alongside its provider for a single import surface.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
