import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy from "./AgentDeploy";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

describe("AgentDeploy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ connections: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("shows deploy progress after submit", async () => {
    render(
      <MemoryRouter initialEntries={["/agents/deploy/sales-prospecting"]}>
        <Routes>
          <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
          <Route path="/agents/my" element={<div>My agents page</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /deploy agent/i }));

    expect(screen.getByText(/deploying agent/i)).toBeInTheDocument();
    expect(screen.getByText(/deploying\.\.\./i)).toBeInTheDocument();

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/integrations\/agent-catalog\/connections$/),
        expect.any(Object)
      )
    );
  });
});
