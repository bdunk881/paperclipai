import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  initializeMock,
  handleRedirectPromiseMock,
  addEventCallbackMock,
  getAllAccountsMock,
  setActiveAccountMock,
} = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; email: string; name: string } },
  initializeMock: vi.fn(() => Promise.resolve()),
  handleRedirectPromiseMock: vi.fn(() => Promise.resolve(null)),
  addEventCallbackMock: vi.fn(),
  getAllAccountsMock: vi.fn(() => []),
  setActiveAccountMock: vi.fn(),
}));

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn(() => ({
    initialize: initializeMock,
    handleRedirectPromise: handleRedirectPromiseMock,
    addEventCallback: addEventCallbackMock,
    getAllAccounts: getAllAccountsMock,
    setActiveAccount: setActiveAccountMock,
  })),
  EventType: { LOGIN_SUCCESS: "LOGIN_SUCCESS" },
}));

vi.mock("@azure/msal-react", () => ({
  MsalProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: authState.user,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
  }),
}));

vi.mock("./components/Layout", () => ({
  default: () => (
    <div>
      <span>Layout Shell</span>
      <Outlet />
    </div>
  ),
}));

vi.mock("./pages/Login", () => ({ default: () => <div>Login Page</div> }));
vi.mock("./pages/Signup", () => ({ default: () => <div>Signup Page</div> }));
vi.mock("./pages/Dashboard", () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock("./pages/WorkflowBuilder", () => ({ default: () => <div>Workflow Builder Page</div> }));
vi.mock("./pages/RunMonitor", () => ({ default: () => <div>Run Monitor Page</div> }));
vi.mock("./pages/RunHistory", () => ({ default: () => <div>Run History Page</div> }));
vi.mock("./pages/LandingPage", () => ({ default: () => <div>Landing Page</div> }));
vi.mock("./pages/LLMProviders", () => ({ default: () => <div>LLM Providers Page</div> }));
vi.mock("./pages/Settings", () => ({ default: () => <div>Settings Page</div> }));
vi.mock("./pages/ProfileSettings", () => ({ default: () => <div>Profile Settings Page</div> }));
vi.mock("./pages/SecuritySettings", () => ({ default: () => <div>Security Settings Page</div> }));
vi.mock("./pages/NotificationsSettings", () => ({ default: () => <div>Notifications Settings Page</div> }));
vi.mock("./pages/ApiKeys", () => ({ default: () => <div>API Keys Page</div> }));
vi.mock("./pages/Pricing", () => ({ default: () => <div>Pricing Page</div> }));
vi.mock("./pages/Approvals", () => ({ default: () => <div>Approvals Page</div> }));
vi.mock("./pages/Memory", () => ({ default: () => <div>Memory Page</div> }));
vi.mock("./pages/Integrations", () => ({ default: () => <div>Integrations Page</div> }));
vi.mock("./pages/MCPIntegrations", () => ({ default: () => <div>MCP Integrations Page</div> }));
vi.mock("./pages/McpServers", () => ({ default: () => <div>MCP Servers Page</div> }));
vi.mock("./pages/ExecutionLogs", () => ({ default: () => <div>Execution Logs Page</div> }));
vi.mock("./pages/CheckoutSuccess", () => ({ default: () => <div>Checkout Success Page</div> }));
vi.mock("./pages/AuthCallback", () => ({ default: () => <div>Auth Callback Page</div> }));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    authState.user = null;
    initializeMock.mockClear();
    handleRedirectPromiseMock.mockClear();
    addEventCallbackMock.mockClear();
    getAllAccountsMock.mockClear();
    setActiveAccountMock.mockClear();
    window.history.replaceState({}, "", "/");
  });

  it("renders public routes without authentication", async () => {
    window.history.replaceState({}, "", "/waitlist");
    render(<App />);

    expect(await screen.findByText("Landing Page")).toBeInTheDocument();
  });

  it("redirects private routes to login when unauthenticated", async () => {
    window.history.replaceState({}, "", "/logs");
    render(<App />);

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Execution Logs Page")).not.toBeInTheDocument();
  });

  it("redirects authenticated users away from login to the dashboard", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/login");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("renders nested authenticated routes", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/settings/api-keys");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("API Keys Page")).toBeInTheDocument();
  });

  it("renders the live integrations setup route for authenticated users", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/integrations");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Integrations Page")).toBeInTheDocument();
  });

  it("redirects unknown routes back through the authenticated root", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/does-not-exist");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Page")).toBeInTheDocument();
  });
});
