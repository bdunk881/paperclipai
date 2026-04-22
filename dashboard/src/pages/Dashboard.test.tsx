import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dashboard from "./Dashboard";

const getAccessToken = vi.fn();
const listRuns = vi.fn();
const listTemplates = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken,
  }),
}));

vi.mock("../api/client", () => ({
  listRuns,
  listTemplates,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue("dashboard-token");
    listRuns.mockResolvedValue([]);
    listTemplates.mockResolvedValue([]);
  });

  it("loads runs with the active bearer token", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listRuns).toHaveBeenCalledWith(undefined, "dashboard-token");
    });
  });
});
