import React, { createContext, useContext, useState, useCallback } from "react";

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("autoflow_user");
    return stored ? JSON.parse(stored) : null;
  });

  const login = useCallback(async (email: string, _password: string) => {
    // TODO: replace with real POST /api/auth/login
    await new Promise((r) => setTimeout(r, 600));
    const u: User = { id: "usr-1", email, name: email.split("@")[0] };
    localStorage.setItem("autoflow_user", JSON.stringify(u));
    setUser(u);
  }, []);

  const signup = useCallback(
    async (name: string, email: string, _password: string) => {
      // TODO: replace with real POST /api/auth/signup
      await new Promise((r) => setTimeout(r, 800));
      const u: User = { id: "usr-" + Date.now(), email, name };
      localStorage.setItem("autoflow_user", JSON.stringify(u));
      setUser(u);
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem("autoflow_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
