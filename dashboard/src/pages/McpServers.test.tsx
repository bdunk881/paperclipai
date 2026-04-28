import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import McpServers from "./McpServers";
import { ApiError, apiDelete, apiGet, apiPost } from "../api/settingsClient";

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
  requireAccessToken: vi.fn(),
};

vi.mock("../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../context/AuthContext")>(
    "../context/AuthContext"
  );
  return {
    ...actual,
    useAuth: () => mockedAuthContext,
  };
});

vi.mock("../api/settingsClient", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

const apiGetMock = vi.mocked(apiGet);
const apiPostMock = vi.mocked(apiPost);
const apiDeleteMock = vi.mocked(apiDelete);

function renderPage() {
  render(
    <MemoryRouter>
      <McpServers />
    </MemoryRouter>
  );
}

describe("McpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthContext.requireAccessToken.mockResolvedValue("token-123");
    apiGetMock.mockResolvedValue({ servers: [] });
    apiPostMock.mockResolvedValue({ ok: true, message: "Connection verified" });
    apiDeleteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and closes the guidance panel", async () => {
    renderPage();

    expect(await screen.findByText("No integrations registered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(screen.getByText("Connect integrations quickly")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Connect integrations quickly")).toBeNull();
  });

  it("adds an integration and renders the auth badge", async () => {
    apiPostMock.mockResolvedValueOnce({
      id: "server-1",
      userId: "test-user",
      name: "Linear MCP",
      url: "https://mcp.example.com",
      authHeaderKey: "Authorization",
      hasAuth: true,
      createdAt: "2026-04-22T00:00:00Z",
    });

    renderPage();

    expect(await screen.findByText("No integrations registered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add integration/i }));
    fireEvent.change(screen.getByPlaceholderText("My Integration"), { target: { value: "Linear MCP" } });
    fireEvent.change(screen.getByPlaceholderText("https://mcp.example.com"), {
      target: { value: "https://mcp.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Authorization"), {
      target: { value: "Authorization" },
    });
    fireEvent.change(screen.getByPlaceholderText("Bearer sk-..."), {
      target: { value: "Bearer secret" },
    });

    const form = screen.getByRole("heading", { name: /new integration/i }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText("Linear MCP")).toBeInTheDocument();
    expect(screen.getByText("Auth configured")).toBeInTheDocument();
    expect(screen.queryByText("New Integration")).toBeNull();
    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/mcp/servers",
      {
        name: "Linear MCP",
        url: "https://mcp.example.com",
        authHeaderKey: "Authorization",
        authHeaderValue: "Bearer secret",
      },
      mockedAuthContext.user,
      "token-123"
    );
  });

  it("tests, discovers, and deletes an integration", async () => {
    apiGetMock
      .mockResolvedValueOnce({
        servers: [
          {
            id: "server-1",
            userId: "test-user",
            name: "Linear MCP",
            url: "https://mcp.example.com",
            hasAuth: true,
            createdAt: "2026-04-22T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        tools: [
          { name: "linear.searchIssues", description: "Search issues" },
          { name: "linear.createIssue", description: "Create issues" },
        ],
      });
    apiPostMock.mockResolvedValueOnce({ ok: true, message: "Connection verified" });

    renderPage();

    expect(await screen.findByText("Linear MCP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(await screen.findByText(/connection verified/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discover tools/i }));
    expect(await screen.findByText("2 tools available")).toBeInTheDocument();
    expect(screen.getByText("linear.searchIssues")).toBeInTheDocument();
    expect(screen.getByText("linear.createIssue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete linear mcp/i }));

    await waitFor(() => {
      expect(screen.queryByText("Linear MCP")).toBeNull();
    });
    expect(apiDeleteMock).toHaveBeenCalledWith(
      "/api/mcp/servers/server-1",
      mockedAuthContext.user,
      "token-123"
    );
  });

  it("shows auth-specific load failures", async () => {
    apiGetMock.mockRejectedValueOnce(new ApiError("unauthorized", 401));

    renderPage();
    expect(await screen.findByText(/sign in to manage integrations\./i)).toBeInTheDocument();
  });

  it("shows generic load failures", async () => {
    apiGetMock.mockRejectedValueOnce(new Error("network down"));

    renderPage();
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });

  it("shows discover-tools errors inline", async () => {
    apiGetMock
      .mockResolvedValueOnce({
        servers: [
          {
            id: "server-1",
            userId: "test-user",
            name: "Linear MCP",
            url: "https://mcp.example.com",
            hasAuth: false,
            createdAt: "2026-04-22T00:00:00Z",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("tools unavailable"));

    renderPage();

    expect(await screen.findByText("Linear MCP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discover tools/i }));

    expect(await screen.findByText(/could not discover tools/i)).toBeInTheDocument();
  });
});
