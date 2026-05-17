import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  loginMock,
  signupMock,
  logoutMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; email: string; name: string } },
  loginMock: vi.fn(),
  signupMock: vi.fn(),
  logoutMock: vi.fn(),
  getAccessTokenMock: vi.fn(() => Promise.resolve("test-access-token")),
}));

vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: authState.user,
    accessMode: authState.user ? "authenticated" : "anonymous",
    login: loginMock,
    signup: signupMock,
    logout: logoutMock,
    getAccessToken: getAccessTokenMock,
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
vi.mock("./pages/Templates", () => ({ default: () => <div>Templates Page</div> }));
vi.mock("./pages/LandingPage", () => ({ default: () => <div>Landing Page</div> }));
vi.mock("./pages/LLMProviders", () => ({ default: () => <div>LLM Providers Page</div> }));
vi.mock("./pages/MissionState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pages/MissionState")>();
  return {
    ...actual,
    default: () => <div>Mission State Page</div>,
  };
});
vi.mock("./pages/Settings", () => ({ default: () => <div>Settings Page</div> }));
vi.mock("./pages/ProfileSettings", () => ({ default: () => <div>Profile Settings Page</div> }));
vi.mock("./pages/SecuritySettings", () => ({ default: () => <div>Security Settings Page</div> }));
vi.mock("./pages/NotificationsSettings", () => ({ default: () => <div>Notifications Settings Page</div> }));
vi.mock("./pages/ApiKeys", () => ({ default: () => <div>API Keys Page</div> }));
vi.mock("./pages/Pricing", () => ({ default: () => <div>Pricing Page</div> }));
vi.mock("./pages/Approvals", () => ({ default: () => <div>Approvals Page</div> }));
vi.mock("./pages/Tickets", () => ({ default: () => <div>Tickets Page</div> }));
vi.mock("./pages/TicketDetail", () => ({ default: () => <div>Ticket Detail Page</div> }));
vi.mock("./pages/TicketTeamView", () => ({ default: () => <div>Ticket Team View Page</div> }));
vi.mock("./pages/TicketActorView", () => ({ default: () => <div>Ticket Actor View Page</div> }));
vi.mock("./pages/Memory", () => ({ default: () => <div>Memory Page</div> }));
vi.mock("./pages/MCPIntegrations", () => ({ default: () => <div>MCP Integrations Page</div> }));
vi.mock("./pages/McpServers", () => ({ default: () => <div>MCP Servers Page</div> }));
vi.mock("./pages/CheckoutSuccess", () => ({ default: () => <div>Checkout Success Page</div> }));
vi.mock("./pages/AuthCallback", () => ({ default: () => <div>Auth Callback Page</div> }));
vi.mock("./pages/SocialAuthCallback", () => ({ default: () => <div>Social Auth Callback Page</div> }));
vi.mock("./pages/Tickets", () => ({ default: () => <div>Tickets Page</div> }));
vi.mock("./pages/TicketDetail", () => ({ default: () => <div>Ticket Detail Page</div> }));
vi.mock("./pages/TicketTeamView", () => ({ default: () => <div>Ticket Team Page</div> }));
vi.mock("./pages/TicketActorView", () => ({ default: () => <div>Ticket Actor Page</div> }));
vi.mock("./pages/TicketSlaDashboard", () => ({ default: () => <div>Ticket SLA Dashboard Page</div> }));
vi.mock("./pages/TicketSlaSettings", () => ({ default: () => <div>Ticket SLA Settings Page</div> }));

// Stub ticket API loaders so routes with loaders resolve immediately in tests
vi.mock("./api/tickets", () => ({
  listTickets: vi.fn().mockResolvedValue([]),
  getTicket: vi.fn().mockResolvedValue(null),
  createTicket: vi.fn().mockResolvedValue({}),
}));

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn().mockResolvedValue([]),
    listCompanyRoleTemplates: vi.fn().mockResolvedValue({ roleTemplates: [] }),
  };
});

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    authState.user = null;
    loginMock.mockClear();
    signupMock.mockClear();
    logoutMock.mockClear();
    getAccessTokenMock.mockClear();
    window.history.replaceState({}, "", "/");
  });

  it("renders public routes without authentication", async () => {
    window.history.replaceState({}, "", "/waitlist");
    render(<App />);

    expect(await screen.findByText("Landing Page")).toBeInTheDocument();
  });

  it("renders the social auth callback route without authentication", async () => {
    window.history.replaceState({}, "", "/auth/social-callback");
    render(<App />);

    expect(await screen.findByText("Social Auth Callback Page")).toBeInTheDocument();
  });

  it("redirects private routes to login when unauthenticated", async () => {
    window.history.replaceState({}, "", "/approvals");
    render(<App />);

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Approvals Page")).not.toBeInTheDocument();
  });

  it("redirects authenticated users away from login to the dashboard", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/login");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Dashboard Page")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("renders nested authenticated routes", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/settings/api-keys");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("API Keys Page")).toBeInTheDocument();
  });

  it("redirects the legacy /monitor URL to the dashboard home", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/monitor");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Dashboard Page")).toBeInTheDocument();
  });

  it("renders the templates route for authenticated users", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/templates");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Templates Page")).toBeInTheDocument();
  });

  it("redirects the legacy /workspace/staffing-plan URL to Missions", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/workspace/staffing-plan");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Mission State Page")).toBeInTheDocument();
  });

  it("renders the mission state route for authenticated users", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/mission-state");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Mission State Page")).toBeInTheDocument();
  });

  it("renders the SLA dashboard route for authenticated users", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/tickets/sla");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Ticket SLA Dashboard Page")).toBeInTheDocument();
  });

  it("renders the SLA settings route for authenticated users", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/settings/ticketing-sla");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(screen.getByText("Ticket SLA Settings Page")).toBeInTheDocument();
  });

  it("renders mission-assignments routes behind authentication (legacy /tickets redirects)", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/tickets");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    // /tickets now redirects to /mission-assignments; the Tickets component
    // is mounted at the new path, so the same mocked label should render.
    expect(await screen.findByText("Tickets Page")).toBeInTheDocument();
  });

  it("renders mission-assignment team view for authenticated users (legacy /tickets/team redirects)", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/tickets/team");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Ticket Team Page")).toBeInTheDocument();
  });

  it("redirects unknown routes back through the authenticated root", async () => {
    authState.user = { id: "user-1", email: "user@example.com", name: "User" };
    window.history.replaceState({}, "", "/does-not-exist");

    render(<App />);

    expect(await screen.findByText("Layout Shell")).toBeInTheDocument();
    expect(await screen.findByText("Dashboard Page")).toBeInTheDocument();
  });
});
